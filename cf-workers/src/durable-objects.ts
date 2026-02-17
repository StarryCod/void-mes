import { DurableObject } from 'cloudflare:workers';
import { Env, corsHeaders } from './types';

interface WebSocketWithMetadata {
  websocket: WebSocket;
  userId: string;
  joinedAt: number;
  lastActivity: number;
}

interface ChatMessage {
  type: 'message' | 'typing' | 'read' | 'presence' | 'contact' | 'call' | 'ping' | 'pong' | 'ack';
  action: string;
  data: any;
  senderId?: string;
  targetId?: string;
  messageId?: string;
  timestamp?: number;
}

// Connection timeout - close if no activity for this long
const CONNECTION_TIMEOUT = 120000; // 2 minutes

// ChatRoom Durable Object - handles WebSocket connections for a specific room
export class ChatRoom extends DurableObject {
  private sessions: Map<WebSocket, WebSocketWithMetadata> = new Map();
  private lastActivity: number = Date.now();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Set up WebSocket hibernation support
    state.setWebSocketAutoResponseThreshold(30000); // Auto-respond to pings
  }

  // Clean up stale connections - called on each request
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = now - CONNECTION_TIMEOUT;
    
    for (const [ws, meta] of this.sessions) {
      // Check if connection is stale or closed
      if (ws.readyState !== WebSocket.OPEN || meta.lastActivity < staleThreshold) {
        console.log('[ChatRoom] Cleaning up stale connection for user:', meta.userId);
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Connection timeout');
          }
        } catch (e) {
          // Ignore close errors
        }
        this.sessions.delete(ws);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Clean up stale connections on each request
    this.cleanupStaleConnections();
    
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    // Handle HTTP requests for room state
    if (url.pathname === '/users') {
      const users = Array.from(this.sessions.values()).map(s => ({
        userId: s.userId,
        joinedAt: s.joinedAt,
      }));
      return new Response(JSON.stringify(users), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const body = await request.json() as ChatMessage;
      await this.broadcast(body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        connections: this.sessions.size,
        users: Array.from(this.sessions.values()).map(s => ({
          userId: s.userId,
          lastActivity: s.lastActivity
        }))
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }

  async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    
    server.accept();
    
    const metadata: WebSocketWithMetadata = {
      websocket: server,
      userId,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
    };
    
    this.sessions.set(server, metadata);
    this.lastActivity = Date.now();

    // Send connection confirmation
    server.send(JSON.stringify({
      type: 'connected',
      userId,
      timestamp: Date.now()
    }));
    
    // Notify others that user joined
    await this.broadcast({
      type: 'presence',
      action: 'online',
      data: { userId },
      timestamp: Date.now(),
    }, server);
    
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ChatMessage;
        msg.senderId = userId;
        msg.timestamp = Date.now();
        
        // Update last activity
        const meta = this.sessions.get(server);
        if (meta) {
          meta.lastActivity = Date.now();
        }
        
        await this.handleMessage(server, msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });
    
    server.addEventListener('close', async () => {
      this.sessions.delete(server);
      
      // Notify others that user left
      await this.broadcast({
        type: 'presence',
        action: 'offline',
        data: { userId },
        timestamp: Date.now(),
      });
    });
    
    server.addEventListener('error', (e) => {
      console.error('WebSocket error:', e);
      this.sessions.delete(server);
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleMessage(sender: WebSocket, msg: ChatMessage): Promise<void> {
    this.lastActivity = Date.now();
    
    switch (msg.type) {
      case 'message':
        // Handle both 'send' and 'new' actions
        if (msg.action === 'send' || msg.action === 'new') {
          // Convert 'send' to 'new' for consistency
          const broadcastMsg = {
            ...msg,
            action: 'new'
          };
          
          // Broadcast to all connected clients in this room
          await this.broadcast(broadcastMsg, sender);
        }
        break;
        
      case 'typing':
        // Broadcast typing indicator to others in the room
        await this.broadcast(msg, sender);
        break;
        
      case 'read':
        // Mark messages as read
        await this.broadcast(msg, sender);
        break;
        
      case 'contact':
        // Contact request notification
        await this.broadcast(msg, sender);
        break;
        
      case 'call':
        // Call signaling
        await this.broadcast(msg, sender);
        break;
        
      case 'ping':
        // Respond with pong immediately
        sender.send(JSON.stringify({ 
          type: 'pong', 
          timestamp: Date.now() 
        }));
        break;

      case 'ack':
        // Acknowledgment from client - message received
        console.log('[ChatRoom] ACK received for message:', msg.messageId);
        break;
        
      default:
        console.log('Unknown message type:', msg.type);
    }
  }

  async broadcast(message: ChatMessage, exclude?: WebSocket): Promise<void> {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    const deadSockets: WebSocket[] = [];
    
    for (const [ws, meta] of this.sessions) {
      if (ws !== exclude) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(messageStr);
            sentCount++;
          } catch (e) {
            console.error('[ChatRoom] Failed to send to user:', meta.userId, e);
            deadSockets.push(ws);
          }
        } else {
          deadSockets.push(ws);
        }
      }
    }
    
    // Clean up dead sockets
    for (const ws of deadSockets) {
      this.sessions.delete(ws);
    }
    
    console.log('[ChatRoom] Broadcast', message.type, message.action, 'to', sentCount, 'clients');
  }
}

// CallRoom Durable Object - handles WebRTC signaling
export class CallRoom extends DurableObject {
  private participants: Map<string, { ws: WebSocket; lastActivity: number }> = new Map();
  private callState: 'idle' | 'ringing' | 'connected' = 'idle';

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.setWebSocketAutoResponseThreshold(30000);
  }

  // Clean up stale participants
  private cleanupStaleParticipants(): void {
    const now = Date.now();
    const staleThreshold = now - CONNECTION_TIMEOUT;
    
    for (const [userId, data] of this.participants) {
      if (data.ws.readyState !== WebSocket.OPEN || data.lastActivity < staleThreshold) {
        console.log('[CallRoom] Cleaning up stale participant:', userId);
        this.participants.delete(userId);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.cleanupStaleParticipants();
    
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        callState: this.callState,
        participants: Array.from(this.participants.keys())
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
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
    this.participants.set(userId, { ws: server, lastActivity: Date.now() });

    // Send connection confirmation
    server.send(JSON.stringify({
      type: 'connected',
      userId,
      callId,
      callState: this.callState,
      timestamp: Date.now()
    }));
    
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        msg.senderId = userId;
        
        // Update last activity
        const participant = this.participants.get(userId);
        if (participant) {
          participant.lastActivity = Date.now();
        }
        
        // Handle WebRTC signaling
        switch (msg.type) {
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            // Forward to specific target
            const targetData = this.participants.get(msg.targetId);
            if (targetData?.ws.readyState === WebSocket.OPEN) {
              targetData.ws.send(JSON.stringify(msg));
            }
            break;
            
          case 'call-start':
            this.callState = 'ringing';
            // Notify other participants
            for (const [id, data] of this.participants) {
              if (id !== userId && data.ws.readyState === WebSocket.OPEN) {
                data.ws.send(JSON.stringify({
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
            const callerData = this.participants.get(msg.targetId);
            if (callerData?.ws.readyState === WebSocket.OPEN) {
              callerData.ws.send(JSON.stringify({
                type: 'call-answered',
                answererId: userId,
                signal: msg.signal,
              }));
            }
            break;
            
          case 'call-reject':
          case 'call-end':
            this.callState = 'idle';
            // Notify all participants
            for (const [id, data] of this.participants) {
              if (id !== userId && data.ws.readyState === WebSocket.OPEN) {
                data.ws.send(JSON.stringify({
                  type: msg.type === 'call-reject' ? 'call-rejected' : 'call-ended',
                  senderId: userId,
                }));
              }
            }
            break;

          case 'ping':
            server.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        }
      } catch (e) {
        console.error('Failed to handle call message:', e);
      }
    });
    
    server.addEventListener('close', () => {
      this.participants.delete(userId);
      
      // Notify others that participant left
      for (const [id, data] of this.participants) {
        if (data.ws.readyState === WebSocket.OPEN) {
          data.ws.send(JSON.stringify({
            type: 'call-ended',
            senderId: userId,
          }));
        }
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
