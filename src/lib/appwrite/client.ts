import { Client, Account, Databases, Storage, ID, Query } from 'appwrite';

// Browser-side Appwrite client (limited permissions, uses sessions)
export function createBrowserAppwriteClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

  return {
    client,
    account: new Account(client),
    databases: new Databases(client),
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

export { ID, Query };
