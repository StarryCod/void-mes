import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { neon } from '@neondatabase/serverless';

// Types
interface Env {
  DATABASE_URL: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  CHAT_ROOM: DurableObjectNamespace;
  CALL_ROOM: DurableObjectNamespace;
}

// Export Durable Objects
export { ChatRoom } from './durable-objects';
export { CallRoom } from './durable-objects';

// Helpers
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function verifyUser(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7);
  const sql = neon(env.DATABASE_URL);
  
  const sessions = await sql`
    SELECT s."userId", s."expiresAt" 
    FROM "Session" s 
    WHERE s.token = ${token}
  `;
  
  if (sessions.length === 0) {
    return null;
  }
  
  const session = sessions[0];
  if (new Date(session.expiresAt) < new Date()) {
    return null;
  }
  
  return session.userId;
}

// Create Hono app
const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/', function(c) {
  return c.json({ 
    status: 'ok', 
    service: 'void-realtime',
    version: '1.0.0'
  });
});

// ==================== AUTH ====================
app.get('/api/auth/me', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const sql = neon(c.env.DATABASE_URL);
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
app.get('/api/contacts', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const sql = neon(c.env.DATABASE_URL);
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

app.post('/api/contacts', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json();
  const contactId = body.contactId;
  
  if (!contactId) {
    return errorResponse('contactId required');
  }
  
  const sql = neon(c.env.DATABASE_URL);
  
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
  
  return jsonResponse({ success: true, contact: contactInfo[0] });
});

// ==================== MESSAGES ====================
app.get('/api/messages', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const contactId = c.req.query('contactId');
  const channelId = c.req.query('channelId');
  
  const sql = neon(c.env.DATABASE_URL);
  
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

app.post('/api/messages', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json();
  const receiverId = body.receiverId;
  const channelId = body.channelId;
  const content = body.content;
  const isVoice = body.isVoice;
  const voiceUrl = body.voiceUrl;
  const voiceDuration = body.voiceDuration;
  
  if (!content && !voiceUrl) {
    return errorResponse('content or voiceUrl required');
  }
  
  const sql = neon(c.env.DATABASE_URL);
  
  const result = await sql`
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
  
  const message = result[0];
  
  const senderResult = await sql`
    SELECT id, username, "displayName", avatar FROM "User" WHERE id = ${userId}
  `;
  
  const fullMessage = { ...message, sender: senderResult[0] };
  
  return jsonResponse(fullMessage);
});

// ==================== CHANNELS ====================
app.get('/api/channels', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const sql = neon(c.env.DATABASE_URL);
  const channels = await sql`
    SELECT c.*, cm.role
    FROM "Channel" c
    JOIN "ChannelMember" cm ON c.id = cm."channelId"
    WHERE cm."userId" = ${userId}
    ORDER BY c.name
  `;
  
  return jsonResponse(channels);
});

app.post('/api/channels', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const body = await c.req.json();
  const name = body.name;
  const description = body.description;
  const isPrivate = body.isPrivate;
  
  if (!name) {
    return errorResponse('name required');
  }
  
  const sql = neon(c.env.DATABASE_URL);
  
  const result = await sql`
    INSERT INTO "Channel" (id, name, description, "isPrivate", "createdAt")
    VALUES (gen_random_uuid(), ${name}, ${description || null}, ${isPrivate || false}, NOW())
    RETURNING *
  `;
  
  const channel = result[0];
  
  await sql`
    INSERT INTO "ChannelMember" (id, "channelId", "userId", role, "joinedAt")
    VALUES (gen_random_uuid(), ${channel.id}, ${userId}, 'admin', NOW())
  `;
  
  return jsonResponse(channel);
});

// ==================== USERS ====================
app.get('/api/users/search', async function(c) {
  const userId = await verifyUser(c.req.raw, c.env);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }
  
  const q = c.req.query('q');
  if (!q || q.length < 1) {
    return jsonResponse([]);
  }
  
  const searchQuery = q.trim().toLowerCase();
  
  const sql = neon(c.env.DATABASE_URL);
  const users = await sql`
    SELECT id, username, "displayName", avatar, bio, status
    FROM "User"
    WHERE (LOWER(username) LIKE ${'%' + searchQuery + '%'} OR LOWER("displayName") LIKE ${'%' + searchQuery + '%'})
      AND id != ${userId}
    LIMIT 10
  `;
  
  return jsonResponse(users);
});

// ==================== WEBSOCKET ====================
app.get('/ws/user/:userId', async function(c) {
  const userId = c.req.param('userId');
  const roomId = 'user-' + userId;
  
  const id = c.env.CHAT_ROOM.idFromName(roomId);
  const room = c.env.CHAT_ROOM.get(id);
  
  // Add userId to query params for Durable Object
  const url = new URL(c.req.url);
  url.searchParams.set('userId', userId);
  const modifiedRequest = new Request(url.toString(), c.req.raw);
  
  return room.fetch(modifiedRequest);
});

app.get('/ws/channel/:channelId', async function(c) {
  const channelId = c.req.param('channelId');
  const userId = c.req.query('userId');
  const roomId = 'channel-' + channelId;
  
  const id = c.env.CHAT_ROOM.idFromName(roomId);
  const room = c.env.CHAT_ROOM.get(id);
  
  // Add userId to query params for Durable Object
  const url = new URL(c.req.url);
  if (userId) {
    url.searchParams.set('userId', userId);
  }
  const modifiedRequest = new Request(url.toString(), c.req.raw);
  
  return room.fetch(modifiedRequest);
});

app.get('/ws/call/:callId', async function(c) {
  const callId = c.req.param('callId');
  const userId = c.req.query('userId');
  
  const id = c.env.CALL_ROOM.idFromName(callId);
  const room = c.env.CALL_ROOM.get(id);
  
  const url = new URL(c.req.url);
  url.searchParams.set('userId', userId || '');
  url.searchParams.set('callId', callId);
  
  const modifiedRequest = new Request(url.toString(), c.req.raw);
  return room.fetch(modifiedRequest);
});

// Export handler
export default app;
