import { DurableObject } from 'cloudflare:workers';
import { Env, corsHeaders } from './types';

// SSE connection metadata
interface SSEConnection {
  userId: string;
  connectedAt: number;
  lastHeartbeat: number;
}

// Message for broadcast
interface BroadcastMessage {
  type: 'message' | 'presence' | 'contact' | 'typing' | 'heartbeat';
  data: any;
  targetUserIds?: string[];
}

/**
 * SSE Chat Room Durable Object
 * 
 * Простая и надежная реализация:
 * - Хранит активные SSE соединения
 * - Пушит сообщения подключенным клиентам
 * - Автоматически чистит мертвые соединения
 */
export class ChatRoom extends DurableObject {
  private connections: Map<string, { userId: string; writer: WritableStreamDefaultWriter; lastActivity: number }> = new Map();
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // SSE subscribe endpoint
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      return this.handleSubscribe(request);
    }
    
    // Broadcast endpoint (called from main worker)
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request);
    }
    
    // Unsubscribe endpoint
    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      return this.handleUnsubscribe(request);
    }
    
    // Get online users
    if (url.pathname === '/online') {
      return this.getOnlineUsers();
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        connections: this.connections.size,
        users: [...new Set([...this.connections.values()].map(c => c.userId))]
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    
    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handle SSE subscription
   */
  async handleSubscribe(request: Request): Promise<Response> {
    const body = await request.json() as { userId: string; sessionId: string };
    const { userId, sessionId } = body;
    
    if (!userId || !sessionId) {
      return new Response(JSON.stringify({ error: 'userId and sessionId required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Clean up dead connections first
    this.cleanupDeadConnections();
    
    // Check if user already has a connection with this session
    const existing = this.connections.get(sessionId);
    if (existing) {
      try {
        await existing.writer.close();
      } catch (e) {}
      this.connections.delete(sessionId);
    }

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    
    // Store connection
    this.connections.set(sessionId, {
      userId,
      writer,
      lastActivity: Date.now()
    });
    
    // Send initial connected event
    await this.sendEvent(writer, 'connected', { sessionId, userId });
    
    // Start heartbeat in background
    this.startHeartbeat(sessionId, writer).catch(() => {
      this.connections.delete(sessionId);
    });
    
    console.log(`[ChatRoom] User ${userId} subscribed. Total: ${this.connections.size}`);
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders()
      }
    });
  }

  /**
   * Handle broadcast request from main worker
   */
  async handleBroadcast(request: Request): Promise<Response> {
    const body = await request.json() as BroadcastMessage;
    const { type, data, targetUserIds } = body;
    
    let sentCount = 0;
    const deadSessions: string[] = [];
    
    for (const [sessionId, conn] of this.connections) {
      if (targetUserIds && !targetUserIds.includes(conn.userId)) {
        continue;
      }
      
      try {
        await this.sendEvent(conn.writer, type, data);
        sentCount++;
      } catch (e) {
        deadSessions.push(sessionId);
      }
    }
    
    for (const sessionId of deadSessions) {
      this.connections.delete(sessionId);
    }
    
    return new Response(JSON.stringify({ success: true, sent: sentCount }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  /**
   * Handle unsubscribe
   */
  async handleUnsubscribe(request: Request): Promise<Response> {
    const body = await request.json() as { sessionId: string };
    const { sessionId } = body;
    
    const conn = this.connections.get(sessionId);
    if (conn) {
      try {
        await conn.writer.close();
      } catch (e) {}
      this.connections.delete(sessionId);
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  /**
   * Get online users
   */
  async getOnlineUsers(): Promise<Response> {
    const users = [...new Set([...this.connections.values()].map(c => c.userId))];
    return new Response(JSON.stringify({ users, count: users.length }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  /**
   * Send SSE event
   */
  private async sendEvent(writer: WritableStreamDefaultWriter, type: string, data: any): Promise<void> {
    const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    await writer.write(new TextEncoder().encode(event));
  }

  /**
   * Start heartbeat
   */
  private async startHeartbeat(sessionId: string, writer: WritableStreamDefaultWriter): Promise<void> {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      const conn = this.connections.get(sessionId);
      if (!conn) break;
      
      try {
        await this.sendEvent(writer, 'heartbeat', { timestamp: Date.now() });
        conn.lastActivity = Date.now();
      } catch (e) {
        this.connections.delete(sessionId);
        break;
      }
    }
  }

  /**
   * Clean up dead connections
   */
  private cleanupDeadConnections(): void {
    const now = Date.now();
    const timeout = 120000;
    
    for (const [sessionId, conn] of this.connections) {
      if (now - conn.lastActivity > timeout) {
        try {
          conn.writer.close();
        } catch (e) {}
        this.connections.delete(sessionId);
      }
    }
  }
}

/**
 * CallRoom Durable Object - WebRTC signaling (WebSocket for calls)
 */
export class CallRoom extends DurableObject {
  private participants: Map<string, WebSocket> = new Map();
  private callState: 'idle' | 'ringing' | 'connected' = 'idle';

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    return new Response('Not Found', { status: 404 });
  }

  async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const callId = url.searchParams.get('callId');
    
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    
    server.accept();
    this.participants.set(userId, server);
    
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        msg.senderId = userId;
        
        switch (msg.type) {
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            const targetWs = this.participants.get(msg.targetId);
            if (targetWs?.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify(msg));
            }
            break;
            
          case 'call-start':
            this.callState = 'ringing';
            for (const [id, ws] of this.participants) {
              if (id !== userId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'incoming-call',
                  callerId: userId,
                  callId,
                  callType: msg.callType,
                  signal: msg.signal,
                  callerName: msg.callerName,
                }));
              }
            }
            break;
            
          case 'call-answer':
            this.callState = 'connected';
            const callerWs = this.participants.get(msg.targetId);
            if (callerWs?.readyState === WebSocket.OPEN) {
              callerWs.send(JSON.stringify({
                type: 'call-answered',
                answererId: userId,
                signal: msg.signal,
              }));
            }
            break;
            
          case 'call-reject':
          case 'call-end':
            this.callState = 'idle';
            for (const [id, ws] of this.participants) {
              if (id !== userId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: msg.type === 'call-reject' ? 'call-rejected' : 'call-ended',
                  senderId: userId,
                }));
              }
            }
            break;
        }
      } catch (e) {
        console.error('Failed to handle call message:', e);
      }
    });
    
    server.addEventListener('close', () => {
      this.participants.delete(userId);
      for (const [id, ws] of this.participants) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'call-ended', senderId: userId }));
        }
      }
    });
    
    return new Response(null, { status: 101, webSocket: client });
  }
}
