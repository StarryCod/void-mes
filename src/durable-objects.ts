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
    
    // Handle HTTP requests for broadcasting
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      try {
        const body = await request.json();
        await this.broadcast(body);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
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
        self.handleMessage(server, msg, userId);
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
  
  handleMessage(sender: WebSocket, msg: any, senderUserId: string): void {
    const { type, action, data, targetId, receiverId, channelId, isTyping } = msg;
    
    switch (type) {
      case 'message':
        // Broadcast message to all connected clients in this room
        // (For DMs, the receiver will be in their own room, notified via HTTP)
        this.broadcast({
          type: 'message',
          action: 'new',
          data: data,
          senderId: senderUserId,
          timestamp: Date.now()
        }, sender);
        break;
        
      case 'typing':
        // Broadcast typing indicator
        this.broadcast({
          type: 'typing',
          action: isTyping ? 'start' : 'stop',
          senderId: senderUserId,
          data: { targetId: targetId || receiverId },
          timestamp: Date.now()
        }, sender);
        break;
        
      case 'read':
        // Broadcast read receipt
        this.broadcast({
          type: 'read',
          action: 'mark',
          senderId: senderUserId,
          data: { targetId: targetId },
          timestamp: Date.now()
        }, sender);
        break;
        
      case 'contact':
        // Broadcast contact notification
        this.broadcast({
          type: 'contact',
          action: action || 'new',
          data: data,
          senderId: senderUserId,
          timestamp: Date.now()
        }, sender);
        break;
        
      case 'call':
        // Handle call signaling - broadcast to room
        this.broadcast({
          type: 'call',
          action: action,
          data: data,
          senderId: senderUserId,
          timestamp: Date.now()
        }, sender);
        break;
        
      case 'ping':
        // Heartbeat - just respond with pong
        sender.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
        
      default:
        console.log('Unknown message type:', type);
    }
  }
  
  async broadcast(message: any, exclude?: WebSocket): Promise<void> {
    const messageStr = JSON.stringify(message);
    
    this.sessions.forEach(function(data, ws) {
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
    const callId = url.searchParams.get('callId') || '';
    
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    
    server.accept();
    this.participants.set(userId, server);
    
    // Notify others that participant joined
    const self = this;
    this.participants.forEach(function(ws, id) {
      if (id !== userId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'call',
          action: 'participant-joined',
          data: { userId, callId },
          timestamp: Date.now()
        }));
      }
    });
    
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
              targetWs.send(JSON.stringify({
                type: msg.type,
                senderId: userId,
                data: msg.data || msg.signal || msg.candidate,
                timestamp: Date.now()
              }));
            }
            break;
            
          case 'call':
            if (msg.action === 'start') {
              self.participants.forEach(function(ws, id) {
                if (id !== userId && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'call',
                    action: 'incoming',
                    data: {
                      callerId: userId,
                      callId: callId,
                      callType: msg.callType,
                      signal: msg.signal,
                      callerName: msg.callerName
                    },
                    timestamp: Date.now()
                  }));
                }
              });
            } else if (msg.action === 'answer') {
              const callerWs = self.participants.get(msg.targetId);
              if (callerWs && callerWs.readyState === WebSocket.OPEN) {
                callerWs.send(JSON.stringify({
                  type: 'call',
                  action: 'answered',
                  data: {
                    answererId: userId,
                    signal: msg.signal
                  },
                  timestamp: Date.now()
                }));
              }
            } else if (msg.action === 'reject' || msg.action === 'end') {
              self.participants.forEach(function(ws, id) {
                if (id !== userId && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'call',
                    action: msg.action === 'reject' ? 'rejected' : 'ended',
                    senderId: userId,
                    timestamp: Date.now()
                  }));
                }
              });
            }
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
            type: 'call',
            action: 'participant-left',
            senderId: userId,
            timestamp: Date.now()
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
