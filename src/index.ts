import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, getDb, verifyUser, jsonResponse, errorResponse, handleCors, corsHeaders } from './types';
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

// ==================== AUTH ====================

// Verify token and get user
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
  
  // Update online status
  await sql`
    UPDATE "User" SET "isOnline" = true, "lastSeen" = NOW()
    WHERE id = ${userId}
  `;
  
  return jsonResponse(users[0]);
});

// ==================== CONTACTS ====================

// Get contacts
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

// Add contact
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
  
  // Check if already contacts
  const existing = await sql`
    SELECT id FROM "Contact" 
    WHERE "userId" = ${userId} AND "contactId" = ${contactId}
  `;
  
  if (existing.length > 0) {
    return errorResponse('Already in contacts');
  }
  
  // Add both ways (mutual contacts)
  await sql`
    INSERT INTO "Contact" ("id", "userId", "contactId", "createdAt")
    VALUES (gen_random_uuid(), ${userId}, ${contactId}, NOW())
  `;
  
  await sql`
    INSERT INTO "Contact" ("id", "userId", "contactId", "createdAt")
    VALUES (gen_random_uuid(), ${contactId}, ${userId}, NOW())
  `;
  
  // Get contact info
  const contactInfo = await sql`
    SELECT id, username, "displayName", avatar, bio, status, "isOnline", "lastSeen"
    FROM "User" WHERE id = ${contactId}
  `;
  
  // Notify via WebSocket
  const roomId = `user-${contactId}`;
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  await room.fetch(new Request('https://internal/broadcast', {
    method: 'POST',
    body: JSON.stringify({
      type: 'contact',
      action: 'new',
      data: {
        id: userId,
        ...contactInfo[0],
      },
      senderId: userId,
      timestamp: Date.now(),
    }),
  }));
  
  return jsonResponse({ success: true, contact: contactInfo[0] });
});

// ==================== MESSAGES ====================

// Get messages
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

// Send message
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
  
  // Get sender info
  const [sender] = await sql`
    SELECT id, username, "displayName", avatar FROM "User" WHERE id = ${userId}
  `;
  
  const fullMessage = { ...message, sender };
  
  // Notify via WebSocket
  if (receiverId) {
    // Direct message - notify receiver
    const roomId = `user-${receiverId}`;
    const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
    await room.fetch(new Request('https://internal/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'message',
        action: 'new',
        data: fullMessage,
        senderId: userId,
        timestamp: Date.now(),
      }),
    }));
  } else if (channelId) {
    // Channel message - notify all in channel
    const roomId = `channel-${channelId}`;
    const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
    await room.fetch(new Request('https://internal/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'message',
        action: 'new',
        data: fullMessage,
        senderId: userId,
        timestamp: Date.now(),
      }),
    }));
  }
  
  return jsonResponse(fullMessage);
});

// ==================== CHANNELS ====================

// Get channels
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

// Create channel
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
  
  // Add creator as admin
  await sql`
    INSERT INTO "ChannelMember" (id, "channelId", "userId", role, "joinedAt")
    VALUES (gen_random_uuid(), ${channel.id}, ${userId}, 'admin', NOW())
  `;
  
  return jsonResponse(channel);
});

// ==================== USERS ====================

// Search users
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

// ==================== WEBSOCKET ====================

// WebSocket endpoint for user events
app.get('/ws/user/:userId', async (c) => {
  const userId = c.req.param('userId');
  const roomId = `user-${userId}`;
  
  // Add userId to query params for Durable Object
  const url = new URL(c.req.url);
  url.searchParams.set('userId', userId);
  const modifiedRequest = new Request(url.toString(), c.req.raw);
  
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  return room.fetch(modifiedRequest);
});

// WebSocket endpoint for channel events
app.get('/ws/channel/:channelId', async (c) => {
  const channelId = c.req.param('channelId');
  const userId = c.req.query('userId');
  const roomId = `channel-${channelId}`;
  
  // Add userId to query params for Durable Object
  const url = new URL(c.req.url);
  if (userId) {
    url.searchParams.set('userId', userId);
  }
  const modifiedRequest = new Request(url.toString(), c.req.raw);
  
  const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
  return room.fetch(modifiedRequest);
});

// WebSocket endpoint for calls
app.get('/ws/call/:callId', async (c) => {
  const callId = c.req.param('callId');
  const userId = c.req.query('userId');
  
  const room = c.env.CALL_ROOM.get(c.env.CALL_ROOM.idFromName(callId));
  
  // Add userId to query params
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
    version: '2.0.0',
    endpoints: {
      websocket: {
        user: '/ws/user/:userId',
        channel: '/ws/channel/:channelId',
        call: '/ws/call/:callId',
      },
      api: {
        auth: '/api/auth/me',
        contacts: '/api/contacts',
        messages: '/api/messages',
        channels: '/api/channels',
        users: '/api/users/search',
      }
    }
  });
});

// Export handler
export default app;
