'use client';

import { Client, Databases, Storage, ID, Query, Permission, Role } from 'appwrite';
import { createBrowserAppwriteClient, DATABASE_ID, COLLECTIONS } from './appwrite/client';
import { encrypt, decrypt } from './encryption';

// Message document structure for Appwrite
export interface AppwriteMessage {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  senderId: string;
  receiverId: string;
  channelId: string;
  content: string; // encrypted
  isVoice: boolean;
  voiceDuration: number;
  voiceUrl: string;
  replyToId: string;
  attachments: string; // JSON string
  type: 'message' | 'event';
}

// Decrypted message for UI
export interface DecryptedMessage {
  id: string;
  senderId: string;
  receiverId: string | null;
  channelId: string | null;
  content: string;
  isVoice: boolean;
  voiceDuration: number | null;
  voiceUrl: string | null;
  replyToId: string | null;
  attachments: any[];
  createdAt: string;
}

class AppwriteMessageService {
  private client: Client;
  private databases: Databases;
  private storage: Storage;
  private subscriptions: Map<string, () => void> = new Map();

  constructor() {
    const { client, databases, storage } = createBrowserAppwriteClient();
    this.client = client;
    this.databases = databases;
    this.storage = storage;
  }

  // Send a message (encrypted)
  async sendMessage(
    senderId: string,
    receiverId: string | null,
    channelId: string | null,
    content: string,
    options?: {
      isVoice?: boolean;
      voiceDuration?: number;
      voiceUrl?: string;
      replyToId?: string;
      attachments?: any[];
    }
  ): Promise<DecryptedMessage> {
    // Encrypt content
    const encryptedContent = encrypt(content);
    
    // Create document with permissions
    const permissions = [
      Permission.read(Role.user(senderId)),
    ];
    
    if (receiverId) {
      permissions.push(Permission.read(Role.user(receiverId)));
    }
    if (channelId) {
      // For channels, we need channel members to read
      permissions.push(Permission.read(Role.any())); // TODO: restrict to channel members
    }
    permissions.push(Permission.update(Role.user(senderId)));
    permissions.push(Permission.delete(Role.user(senderId)));

    const doc = await this.databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.MESSAGES,
      ID.unique(),
      {
        senderId,
        receiverId: receiverId || '',
        channelId: channelId || '',
        content: encryptedContent,
        isVoice: options?.isVoice || false,
        voiceDuration: options?.voiceDuration || 0,
        voiceUrl: options?.voiceUrl || '',
        replyToId: options?.replyToId || '',
        attachments: JSON.stringify(options?.attachments || []),
        type: 'message',
      },
      permissions
    );

    return this.decryptMessage(doc as unknown as AppwriteMessage);
  }

  // Get messages for a chat
  async getMessages(
    userId: string,
    receiverId: string | null,
    channelId: string | null,
    limit: number = 50
  ): Promise<DecryptedMessage[]> {
    let queries: any[] = [
      Query.orderDesc('$createdAt'),
      Query.limit(limit),
    ];

    if (channelId) {
      queries.push(Query.equal('channelId', channelId));
      queries.push(Query.equal('type', 'message'));
    } else if (receiverId) {
      // Get messages between two users
      queries.push(Query.equal('type', 'message'));
      queries.push(Query.equal('receiverId', [userId, receiverId]));
      // Note: We'll need to filter senderId as well on client side
      // Or use a different approach with two queries
    }

    const result = await this.databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.MESSAGES,
      queries
    );

    // Filter and decrypt
    const messages = result.documents
      .map(doc => this.decryptMessage(doc as unknown as AppwriteMessage))
      .filter(msg => {
        if (channelId) return true;
        // For DMs, filter by sender/receiver
        const isFromMe = msg.senderId === userId;
        const isToMe = msg.receiverId === userId;
        const isWithTarget = msg.senderId === receiverId || msg.receiverId === receiverId;
        return (isFromMe || isToMe) && isWithTarget;
      });

    return messages.reverse(); // Chronological order
  }

  // Decrypt a message
  private decryptMessage(doc: AppwriteMessage): DecryptedMessage {
    return {
      id: doc.$id,
      senderId: doc.senderId,
      receiverId: doc.receiverId || null,
      channelId: doc.channelId || null,
      content: decrypt(doc.content),
      isVoice: doc.isVoice,
      voiceDuration: doc.voiceDuration || null,
      voiceUrl: doc.voiceUrl || null,
      replyToId: doc.replyToId || null,
      attachments: JSON.parse(doc.attachments || '[]'),
      createdAt: doc.$createdAt,
    };
  }

  // Subscribe to realtime updates for a chat
  subscribeToChat(
    userId: string,
    receiverId: string | null,
    channelId: string | null,
    onMessage: (message: DecryptedMessage) => void
  ): () => void {
    const channel = `databases.${DATABASE_ID}.collections.${COLLECTIONS.MESSAGES}.documents`;
    
    const unsubscribe = this.client.subscribe(channel, (response) => {
      if (response.events.includes('databases.*.collections.*.documents.*.create')) {
        const doc = response.payload as unknown as AppwriteMessage;
        
        // Check if this message is relevant
        if (channelId && doc.channelId === channelId) {
          onMessage(this.decryptMessage(doc));
        } else if (receiverId) {
          const isFromMe = doc.senderId === userId;
          const isToMe = doc.receiverId === userId;
          const isWithTarget = doc.senderId === receiverId || doc.receiverId === receiverId;
          if ((isFromMe || isToMe) && isWithTarget) {
            onMessage(this.decryptMessage(doc));
          }
        }
      }
    });

    const key = channelId || receiverId || 'default';
    this.subscriptions.set(key, unsubscribe);
    
    return () => {
      unsubscribe();
      this.subscriptions.delete(key);
    };
  }

  // Subscribe to all user messages (for notifications)
  subscribeToUserMessages(
    userId: string,
    onMessage: (message: DecryptedMessage) => void
  ): () => void {
    const channel = `databases.${DATABASE_ID}.collections.${COLLECTIONS.MESSAGES}.documents`;
    
    return this.client.subscribe(channel, (response) => {
      if (response.events.includes('databases.*.collections.*.documents.*.create')) {
        const doc = response.payload as unknown as AppwriteMessage;
        if (doc.receiverId === userId || doc.senderId === userId) {
          onMessage(this.decryptMessage(doc));
        }
      }
    });
  }

  // Upload file to Appwrite Storage
  async uploadFile(file: File): Promise<string> {
    const result = await this.storage.createFile(
      'uploads', // bucket ID
      ID.unique(),
      file
    );
    return result.$id;
  }

  // Get file URL
  getFileUrl(fileId: string): string {
    return this.storage.getFileView('uploads', fileId).href;
  }

  // Delete a message
  async deleteMessage(messageId: string): Promise<void> {
    await this.databases.deleteDocument(
      DATABASE_ID,
      COLLECTIONS.MESSAGES,
      messageId
    );
  }

  // Update a message
  async updateMessage(messageId: string, content: string): Promise<DecryptedMessage> {
    const doc = await this.databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.MESSAGES,
      messageId,
      { content: encrypt(content) }
    );
    return this.decryptMessage(doc as unknown as AppwriteMessage);
  }
}

// Singleton instance
let messageService: AppwriteMessageService | null = null;

export function getMessageService(): AppwriteMessageService {
  if (!messageService) {
    messageService = new AppwriteMessageService();
  }
  return messageService;
}
