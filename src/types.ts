import { neon } from '@neondatabase/serverless';

export interface Env {
  // Durable Objects
  CHAT_ROOM: DurableObjectNamespace;
  CALL_ROOM: DurableObjectNamespace;
  
  // Secret для авторизации Push от Next.js API
  WORKER_SECRET: string;
  
  // Neon (не используется в Worker, только для reference)
  DATABASE_URL?: string;
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

// CORS headers
export function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Worker-Secret',
    'Access-Control-Max-Age': '86400',
  };
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
