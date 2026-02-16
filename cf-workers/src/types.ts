import { neon } from '@neondatabase/serverless';

export interface Env {
  DATABASE_URL: string;
  APPWRITE_ENDPOINT: string;
  APPWRITE_PROJECT_ID: string;
  APPWRITE_API_KEY: string;
  CHAT_ROOM: DurableObjectNamespace;
  CALL_ROOM: DurableObjectNamespace;
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  isOnline: boolean;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  receiverId: string | null;
  channelId: string | null;
  createdAt: string;
  isVoice: boolean;
  voiceUrl: string | null;
  voiceDuration: number | null;
  sender?: User;
}

export interface Contact {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  isOnline: boolean;
  lastSeen: string | null;
}

// Get database connection
export function getDb(env: Env) {
  return neon(env.DATABASE_URL);
}

// Verify user token from request
export async function verifyUser(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7);
  const sql = getDb(env);
  
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

// CORS headers
export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// Handle CORS preflight
export function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// JSON response helper
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

// Error response helper
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
