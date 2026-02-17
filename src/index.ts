import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, jsonResponse, errorResponse, corsHeaders } from './types';
import { ChatRoom, CallRoom } from './durable-objects';

// Export Durable Objects
export { ChatRoom, CallRoom };

// Create Hono app
const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ==================== SSE: Client Subscribe ====================

/**
 * Клиент подключается к SSE (одно соединение на всё время)
 * Worker держит соединение открытым
 */
app.post('/sse/subscribe', async (c) => {
  const userId = await verifySimple(c);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json() as { sessionId?: string };
  const sessionId = body.sessionId || `session-${userId}-${Date.now()}`;
  
  // Get user's ChatRoom Durable Object
  const roomId = `user-${userId}`;
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  
  // Forward to Durable Object which returns SSE stream
  return room.fetch(new Request('https://internal/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, sessionId })
  }));
});

/**
 * Unsubscribe from SSE
 */
app.post('/sse/unsubscribe', async (c) => {
  const userId = await verifySimple(c);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json() as { sessionId: string };
  const roomId = `user-${userId}`;
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  
  await room.fetch(new Request('https://internal/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }));
  
  return jsonResponse({ success: true });
});

// ==================== PUSH: From Next.js API ====================

/**
 * Webhook от Next.js API когда создаётся новое сообщение
 * 
 * Next.js API:
 * 1. Сохраняет сообщение в Neon
 * 2. Делает POST /push/message в этот Worker
 * 3. Worker пушит через SSE подключенным клиентам
 * 
 * Результат: 0 пустых запросов, только реальные сообщения!
 */
app.post('/push/message', async (c) => {
  // Простая авторизация - секрет из env
  const secret = c.req.header('X-Worker-Secret');
  if (secret !== c.env.WORKER_SECRET) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json() as {
    userId: string;        // Кому отправить
    type: string;          // 'message', 'contact', 'presence'
    data: any;             // Данные
  };
  
  const { userId, type, data } = body;
  
  // Push to user via SSE
  const roomId = `user-${userId}`;
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  
  const result = await room.fetch(new Request('https://internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data })
  }));
  
  console.log(`[Push] ${type} to user ${userId}`);
  
  return jsonResponse({ success: true });
});

/**
 * Push для каналов - нескольким пользователям
 */
app.post('/push/channel', async (c) => {
  const secret = c.req.header('X-Worker-Secret');
  if (secret !== c.env.WORKER_SECRET) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json() as {
    userIds: string[];
    type: string;
    data: any;
  };
  
  const { userIds, type, data } = body;
  
  // Push to all users
  const promises = userIds.map(async (userId) => {
    const roomId = `user-${userId}`;
    const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
    
    return room.fetch(new Request('https://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    }));
  });
  
  await Promise.all(promises);
  
  console.log(`[Push] ${type} to ${userIds.length} users`);
  
  return jsonResponse({ success: true });
});

// ==================== HEALTH ====================

app.get('/', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'void-realtime',
    version: '4.0.0-push',
    architecture: 'Event-Driven (Push from API)',
    endpoints: {
      sse: {
        subscribe: 'POST /sse/subscribe (client opens SSE)',
        unsubscribe: 'POST /sse/unsubscribe'
      },
      push: {
        message: 'POST /push/message (from Next.js API)',
        channel: 'POST /push/channel (from Next.js API)'
      }
    }
  });
});

// ==================== HELPERS ====================

/**
 * Simple verification - just check token exists
 */
async function verifySimple(c: any): Promise<string | null> {
  const authHeader = c.req.raw.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  // Token format: userId:timestamp:signature
  // For simplicity, we trust the token (Next.js validates)
  const token = authHeader.slice(7);
  const parts = token.split(':');
  return parts[0] || null;
}

export default app;
