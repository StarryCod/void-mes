import { DurableObject } from 'cloudflare:workers';
import { corsHeaders } from './types';

/**
 * ChatRoom Durable Object - минимальный, только SSE
 * 
 * Хранит SSE соединения и пушит сообщения.
 * Никакой логики, никаких запросов к БД!
 */
export class ChatRoom extends DurableObject {
  private connections: Map<string, { 
    userId: string; 
    writer: WritableStreamDefaultWriter; 
    lastActivity: number 
  }> = new Map();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // SSE subscribe
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      return this.handleSubscribe(request);
    }
    
    // Broadcast (called from main worker)
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request);
    }
    
    // Unsubscribe
    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      return this.handleUnsubscribe(request);
    }
    
    return new Response('Not Found', { status: 404 });
  }

  async handleSubscribe(request: Request): Promise<Response> {
    const body = await request.json() as { userId: string; sessionId: string };
    const { userId, sessionId } = body;
    
    if (!userId || !sessionId) {
      return new Response(JSON.stringify({ error: 'userId and sessionId required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Clean dead connections
    this.cleanup();
    
    // Close old connection if exists
    const existing = this.connections.get(sessionId);
    if (existing) {
      try { await existing.writer.close(); } catch (e) {}
      this.connections.delete(sessionId);
    }

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    
    this.connections.set(sessionId, {
      userId,
      writer,
      lastActivity: Date.now()
    });
    
    // Send connected event
    await this.send(writer, 'connected', { sessionId, userId });
    
    // Start heartbeat
    this.heartbeat(sessionId, writer);
    
    console.log(`[ChatRoom] User ${userId} connected. Total: ${this.connections.size}`);
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders()
      }
    });
  }

  async handleBroadcast(request: Request): Promise<Response> {
    const body = await request.json() as { type: string; data: any };
    const { type, data } = body;
    
    let sent = 0;
    const dead: string[] = [];
    
    for (const [sessionId, conn] of this.connections) {
      try {
        await this.send(conn.writer, type, data);
        sent++;
      } catch (e) {
        dead.push(sessionId);
      }
    }
    
    // Cleanup dead
    for (const id of dead) {
      this.connections.delete(id);
    }
    
    return new Response(JSON.stringify({ success: true, sent }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  async handleUnsubscribe(request: Request): Promise<Response> {
    const body = await request.json() as { sessionId: string };
    const conn = this.connections.get(body.sessionId);
    if (conn) {
      try { await conn.writer.close(); } catch (e) {}
      this.connections.delete(body.sessionId);
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }

  private async send(writer: WritableStreamDefaultWriter, type: string, data: any): Promise<void> {
    const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    await writer.write(new TextEncoder().encode(event));
  }

  private async heartbeat(sessionId: string, writer: WritableStreamDefaultWriter): Promise<void> {
    while (true) {
      await new Promise(r => setTimeout(r, 30000));
      const conn = this.connections.get(sessionId);
      if (!conn) break;
      try {
        await this.send(writer, 'heartbeat', { ts: Date.now() });
        conn.lastActivity = Date.now();
      } catch (e) {
        this.connections.delete(sessionId);
        break;
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, conn] of this.connections) {
      if (now - conn.lastActivity > 120000) {
        try { conn.writer.close(); } catch (e) {}
        this.connections.delete(id);
      }
    }
  }
}

/**
 * CallRoom - WebSocket для звонков (WebRTC signaling)
 */
export class CallRoom extends DurableObject {
  private participants: Map<string, WebSocket> = new Map();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
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
    this.participants.set(userId, server);
    
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        msg.senderId = userId;
        
        // Forward to target
        if (msg.targetId) {
          const target = this.participants.get(msg.targetId);
          if (target?.readyState === WebSocket.OPEN) {
            target.send(JSON.stringify(msg));
          }
        }
      } catch (e) {}
    });
    
    server.addEventListener('close', () => {
      this.participants.delete(userId);
    });
    
    return new Response(null, { status: 101, webSocket: client });
  }
}
