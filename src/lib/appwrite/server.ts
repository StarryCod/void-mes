import { Client, Databases, Users, Account, Storage, ID, Query } from 'node-appwrite';

// Server-side Appwrite client with API key (full permissions)
export function createAppwriteClient() {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '69923291001c25654226';
  const apiKey = process.env.APPWRITE_API_KEY || '';
  
  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId);
  
  if (apiKey) {
    client.setKey(apiKey);
  }

  return {
    client,
    databases: new Databases(client),
    users: new Users(client),
    account: new Account(client),
    storage: new Storage(client),
  };
}

// Database and collection IDs
export const DATABASE_ID = 'void-mes-db';

export const COLLECTIONS = {
  USERS: 'users',
  SESSIONS: 'sessions',
  MESSAGES: 'messages',
  CONTACTS: 'contacts',
  CHANNELS: 'channels',
  CHANNEL_MEMBERS: 'channel_members',
  ATTACHMENTS: 'attachments',
  REACTIONS: 'reactions',
  CANVASES: 'canvases',
  DOCUMENTS: 'documents',
} as const;

// Helper to generate IDs
export { ID, Query };
