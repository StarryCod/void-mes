import { DurableObject } from 'cloudflare:workers';
import { Env, corsHeaders } from './types';

interface WebSocketWithMetadata {
  websocket: WebSocket;
  userId: string;
  joinedAt: number;
}

interface ChatMessage {
  type: 'message' | 'typing' | 'read' | 'presence' | 'contact' | 'call' | 'ping';
  action: string;
  data: any;
  senderId?: string;
  timestamp?: number;
}

// ChatRoom Durable Object - handles WebSocket connections for a specific room
export class ChatRoom extends DurableObject {
  private sessions: Map<WebSocket, WebSocketWithMetadata> = new Map();
  private lastActivity: number = Date.now();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
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
    };
    
    this.sessions.set(server, metadata);
    this.lastActivity = Date.now();
    
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
        // Don't broadcast 'send' action - it's handled by API
        // Only broadcast if it's already a 'new' message from API
        if (msg.action === 'new') {
          await this.broadcast(msg, sender);
        }
        // Ignore 'send' action - messages are sent via REST API
        break;
        
      case 'typing':
        // Broadcast typing indicator
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
        // Respond with pong
        sender.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
        
      default:
        console.log('Unknown message type:', msg.type);
    }
  }

  async broadcast(message: ChatMessage, exclude?: WebSocket): Promise<void> {
    const messageStr = JSON.stringify(message);
    
    for (const [ws] of this.sessions) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  }
}

// CallRoom Durable Object - handles WebRTC signaling
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
        
        // Handle WebRTC signaling
        switch (msg.type) {
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            // Forward to specific target
            const targetWs = this.participants.get(msg.targetId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify(msg));
            }
            break;
            
          case 'call-start':
            this.callState = 'ringing';
            // Notify other participants
            for (const [id, ws] of this.participants) {
              if (id !== userId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'incoming-call',
                  callerId: userId,
                  callId,
                  callType: msg.callType,
                  signal: msg.signal,
                }));
              }
            }
            break;
            
          case 'call-answer':
            this.callState = 'connected';
            const callerWs = this.participants.get(msg.targetId);
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
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
            // Notify all participants
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
      
      // Notify others that participant left
      for (const [id, ws] of this.participants) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
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
