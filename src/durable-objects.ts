import { DurableObject } from 'cloudflare:workers';

interface Env {
  DATABASE_URL: string;
}

interface WebSocketData {
  userId: string;
  joinedAt: number;
}

// ChatRoom Durable Object
export class ChatRoom extends DurableObject {
  private sessions: Map<WebSocket, WebSocketData> = new Map();
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }
    
    // Handle HTTP requests for room state
    if (url.pathname === '/users') {
      const users: Array<{ userId: string; joinedAt: number }> = [];
      this.sessions.forEach(function(data) {
        users.push({ userId: data.userId, joinedAt: data.joinedAt });
      });
      return new Response(JSON.stringify(users), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const body = await request.json();
      await this.broadcast(body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }
  
  async handleWebSocket(request: Request, url: URL): Promise<Response> {
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }
    
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    
    server.accept();
    
    const data: WebSocketData = {
      userId: userId,
      joinedAt: Date.now()
    };
    
    this.sessions.set(server, data);
    
    // Notify others that user joined
    await this.broadcast({
      type: 'presence',
      action: 'online',
      data: { userId: userId },
      timestamp: Date.now()
    }, server);
    
    const self = this;
    
    server.addEventListener('message', function(event) {
      try {
        const msg = JSON.parse(event.data as string);
        msg.senderId = userId;
        msg.timestamp = Date.now();
        self.handleMessage(server, msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });
    
    server.addEventListener('close', function() {
      self.sessions.delete(server);
      self.broadcast({
        type: 'presence',
        action: 'offline',
        data: { userId: userId },
        timestamp: Date.now()
      });
    });
    
    server.addEventListener('error', function(e) {
      console.error('WebSocket error:', e);
      self.sessions.delete(server);
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  handleMessage(sender: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'message':
      case 'typing':
      case 'read':
      case 'contact':
      case 'call':
        this.broadcast(msg, sender);
        break;
      default:
        console.log('Unknown message type:', msg.type);
    }
  }
  
  async broadcast(message: any, exclude?: WebSocket): Promise<void> {
    const messageStr = JSON.stringify(message);
    
    this.sessions.forEach(function(ws) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }
}

// CallRoom Durable Object
export class CallRoom extends DurableObject {
  private participants: Map<string, WebSocket> = new Map();
  
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
    const userId = url.searchParams.get('userId') || '';
    
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    
    server.accept();
    this.participants.set(userId, server);
    
    const self = this;
    
    server.addEventListener('message', function(event) {
      try {
        const msg = JSON.parse(event.data as string);
        msg.senderId = userId;
        
        switch (msg.type) {
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            const targetWs = self.participants.get(msg.targetId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify(msg));
            }
            break;
            
          case 'call-start':
            self.participants.forEach(function(ws, id) {
              if (id !== userId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'incoming-call',
                  callerId: userId,
                  callId: msg.callId,
                  callType: msg.callType,
                  signal: msg.signal
                }));
              }
            });
            break;
            
          case 'call-answer':
            const callerWs = self.participants.get(msg.targetId);
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
              callerWs.send(JSON.stringify({
                type: 'call-answered',
                answererId: userId,
                signal: msg.signal
              }));
            }
            break;
            
          case 'call-reject':
          case 'call-end':
            self.participants.forEach(function(ws, id) {
              if (id !== userId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: msg.type === 'call-reject' ? 'call-rejected' : 'call-ended',
                  senderId: userId
                }));
              }
            });
            break;
        }
      } catch (e) {
        console.error('Failed to handle call message:', e);
      }
    });
    
    server.addEventListener('close', function() {
      self.participants.delete(userId);
      
      self.participants.forEach(function(ws, id) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'call-ended',
            senderId: userId
          }));
        }
      });
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
}
