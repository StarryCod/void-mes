import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, getDb, verifyUser, jsonResponse, errorResponse, corsHeaders } from './types';
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

// ==================== SSE SUBSCRIBE ====================

/**
 * SSE endpoint for real-time updates
 * Client sends POST with token, we verify and return SSE stream
 */
app.post('/sse/subscribe', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json() as { sessionId?: string };
  const sessionId = body.sessionId || `session-${userId}-${Date.now()}`;
  
  // Get user's ChatRoom Durable Object
  const roomId = `user-${userId}`;
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  
  // Forward to Durable Object which returns SSE stream
  const response = await room.fetch(new Request('https://internal/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, sessionId })
  }));
  
  return response;
});

/**
 * Unsubscribe from SSE
 */
app.post('/sse/unsubscribe', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
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

/**
 * Get online users
 */
app.get('/sse/online/:userId', async (c) => {
  const userId = c.req.param('userId');
  const roomId = `user-${userId}`;
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  
  return room.fetch(new Request('https://internal/online'));
});

// ==================== AUTH ====================

app.get('/api/auth/me', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const sql = getDb(c.env);
  const users = await sql`
    SELECT id, username, "displayName", avatar, bio, status, "isOnline", "lastSeen"
    FROM "User" WHERE id = ${userId}
  `;
  
  if (users.length === 0) {
    return errorResponse('User not found', 404);
  }
  
  await sql`
    UPDATE "User" SET "isOnline" = true, "lastSeen" = NOW()
    WHERE id = ${userId}
  `;
  
  return jsonResponse(users[0]);
});

// ==================== CONTACTS ====================

app.get('/api/contacts', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const sql = getDb(c.env);
  const contacts = await sql`
    SELECT 
      u.id, u.username, u."displayName", u.avatar, u.bio, u.status, 
      u."isOnline", u."lastSeen"
    FROM "Contact" c
    JOIN "User" u ON c."contactId" = u.id
    WHERE c."userId" = ${userId}
    ORDER BY u.username
  `;
  
  return jsonResponse(contacts);
});

app.post('/api/contacts', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const { contactId } = await c.req.json();
  
  if (!contactId) {
    return errorResponse('contactId required');
  }
  
  const sql = getDb(c.env);
  
  const existing = await sql`
    SELECT id FROM "Contact" 
    WHERE "userId" = ${userId} AND "contactId" = ${contactId}
  `;
  
  if (existing.length > 0) {
    return errorResponse('Already in contacts');
  }
  
  await sql`
    INSERT INTO "Contact" ("id", "userId", "contactId", "createdAt")
    VALUES (gen_random_uuid(), ${userId}, ${contactId}, NOW())
  `;
  
  await sql`
    INSERT INTO "Contact" ("id", "userId", "contactId", "createdAt")
    VALUES (gen_random_uuid(), ${contactId}, ${userId}, NOW())
  `;
  
  const contactInfo = await sql`
    SELECT id, username, "displayName", avatar, bio, status, "isOnline", "lastSeen"
    FROM "User" WHERE id = ${contactId}
  `;
  
  // Notify via SSE
  await broadcastToUser(c.env, contactId, 'contact', {
    id: userId,
    ...contactInfo[0],
  });
  
  return jsonResponse({ success: true, contact: contactInfo[0] });
});

// ==================== MESSAGES ====================

app.get('/api/messages', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const contactId = c.req.query('contactId');
  const channelId = c.req.query('channelId');
  
  const sql = getDb(c.env);
  
  let messages;
  if (contactId) {
    messages = await sql`
      SELECT m.*, 
        json_build_object('id', u.id, 'username', u.username, 'displayName', u."displayName", 'avatar', u.avatar) as sender
      FROM "Message" m
      JOIN "User" u ON m."senderId" = u.id
      WHERE (m."senderId" = ${userId} AND m."receiverId" = ${contactId})
         OR (m."senderId" = ${contactId} AND m."receiverId" = ${userId})
      ORDER BY m."createdAt" ASC
      LIMIT 100
    `;
  } else if (channelId) {
    messages = await sql`
      SELECT m.*, 
        json_build_object('id', u.id, 'username', u.username, 'displayName', u."displayName", 'avatar', u.avatar) as sender
      FROM "Message" m
      JOIN "User" u ON m."senderId" = u.id
      WHERE m."channelId" = ${channelId}
      ORDER BY m."createdAt" ASC
      LIMIT 100
    `;
  } else {
    return errorResponse('contactId or channelId required');
  }
  
  return jsonResponse(messages);
});

app.post('/api/messages', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const { receiverId, channelId, content, isVoice, voiceUrl, voiceDuration } = await c.req.json();
  
  if (!content && !voiceUrl) {
    return errorResponse('content or voiceUrl required');
  }
  
  const sql = getDb(c.env);
  
  const [message] = await sql`
    INSERT INTO "Message" (
      id, content, "senderId", "receiverId", "channelId", 
      "isVoice", "voiceUrl", "voiceDuration", "createdAt"
    )
    VALUES (
      gen_random_uuid(), ${content || ''}, ${userId}, ${receiverId || null}, ${channelId || null},
      ${isVoice || false}, ${voiceUrl || null}, ${voiceDuration || null}, NOW()
    )
    RETURNING *
  `;
  
  const [sender] = await sql`
    SELECT id, username, "displayName", avatar FROM "User" WHERE id = ${userId}
  `;
  
  const fullMessage = { ...message, sender };
  
  // Notify via SSE - simple and reliable!
  if (receiverId) {
    await broadcastToUser(c.env, receiverId, 'message', fullMessage);
  } else if (channelId) {
    // For channels, get all members and notify them
    const members = await sql`
      SELECT "userId" FROM "ChannelMember" WHERE "channelId" = ${channelId} AND "userId" != ${userId}
    `;
    for (const member of members) {
      await broadcastToUser(c.env, member.userId, 'message', fullMessage);
    }
  }
  
  return jsonResponse(fullMessage);
});

// ==================== CHANNELS ====================

app.get('/api/channels', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const sql = getDb(c.env);
  const channels = await sql`
    SELECT c.*, cm.role
    FROM "Channel" c
    JOIN "ChannelMember" cm ON c.id = cm."channelId"
    WHERE cm."userId" = ${userId}
    ORDER BY c.name
  `;
  
  return jsonResponse(channels);
});

app.post('/api/channels', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const { name, description, isPrivate } = await c.req.json();
  
  if (!name) {
    return errorResponse('name required');
  }
  
  const sql = getDb(c.env);
  
  const [channel] = await sql`
    INSERT INTO "Channel" (id, name, description, "isPrivate", "createdAt")
    VALUES (gen_random_uuid(), ${name}, ${description || null}, ${isPrivate || false}, NOW())
    RETURNING *
  `;
  
  await sql`
    INSERT INTO "ChannelMember" (id, "channelId", "userId", role, "joinedAt")
    VALUES (gen_random_uuid(), ${channel.id}, ${userId}, 'admin', NOW())
  `;
  
  return jsonResponse(channel);
});

// ==================== USERS ====================

app.get('/api/users/search', async (c) => {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const q = c.req.query('q')?.trim().toLowerCase();
  
  if (!q || q.length < 1) {
    return jsonResponse([]);
  }
  
  const sql = getDb(c.env);
  const users = await sql`
    SELECT id, username, "displayName", avatar, bio, status
    FROM "User"
    WHERE (LOWER(username) LIKE ${'%' + q + '%'} OR LOWER("displayName") LIKE ${'%' + q + '%'})
      AND id != ${userId}
    LIMIT 10
  `;
  
  return jsonResponse(users);
});

// ==================== CALLS (WebSocket) ====================

app.get('/ws/call/:callId', async (c) => {
  const callId = c.req.param('callId');
  const userId = c.req.query('userId');
  
  const room = c.env.CALL_ROOM.get(c.env.CALL_ROOM.idFromName(callId));
  
  const url = new URL(c.req.url);
  url.searchParams.set('userId', userId || '');
  url.searchParams.set('callId', callId);
  
  const modifiedRequest = new Request(url.toString(), c.req.raw);
  return room.fetch(modifiedRequest);
});

// ==================== HEALTH ====================

app.get('/', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'void-realtime',
    version: '3.0.0-sse',
    transport: 'Server-Sent Events',
    endpoints: {
      sse: {
        subscribe: 'POST /sse/subscribe',
        unsubscribe: 'POST /sse/unsubscribe',
        online: 'GET /sse/online/:userId'
      },
      api: {
        auth: '/api/auth/me',
        contacts: '/api/contacts',
        messages: '/api/messages',
        channels: '/api/channels',
        users: '/api/users/search',
      },
      calls: '/ws/call/:callId'
    }
  });
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Broadcast message to user via SSE
 * Simple, reliable, no complex WebSocket handling
 */
async function broadcastToUser(env: Env, userId: string, type: string, data: any): Promise<void> {
  try {
    const roomId = `user-${userId}`;
    const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomId));
    
    await room.fetch(new Request('https://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    }));
    
    console.log(`[Worker] Broadcast ${type} to user ${userId}`);
  } catch (error) {
    console.error(`[Worker] Failed to broadcast to user ${userId}:`, error);
  }
}

// Export handler
export default app;
