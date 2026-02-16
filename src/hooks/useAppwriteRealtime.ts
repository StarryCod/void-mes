'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Client, Databases, ID, Query } from 'appwrite';
import { createBrowserAppwriteClient, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite/client';

interface MessageEvent {
  id: string;
  senderId: string;
  receiverId: string | null;
  channelId: string | null;
  type: 'new' | 'update' | 'delete';
  timestamp: number;
}

export function useAppwriteRealtime(
  userId: string | null,
  activeChatId: string | null,
  activeChannelId: string | null,
  onNewMessage: (messageId: string) => void
) {
  const clientRef = useRef<Client | null>(null);
  const databasesRef = useRef<Databases | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Create lightweight event in Appwrite for realtime notification
  const createMessageEvent = useCallback(async (
    messageId: string,
    senderId: string,
    receiverId: string | null,
    channelId: string | null
  ) => {
    if (!databasesRef.current) return;

    try {
      // Create a lightweight event document that will trigger realtime
      await databasesRef.current.createDocument(
        DATABASE_ID,
        COLLECTIONS.MESSAGES,
        ID.unique(),
        {
          messageId,
          senderId,
          receiverId: receiverId || '',
          channelId: channelId || '',
          type: 'new',
          timestamp: Date.now(),
        }
      );
    } catch (error) {
      console.error('[Appwrite] Failed to create message event:', error);
    }
  }, []);

  // Delete old events (cleanup)
  const cleanupEvents = useCallback(async () => {
    if (!databasesRef.current) return;

    try {
      const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes ago
      const events = await databasesRef.current.listDocuments(
        DATABASE_ID,
        COLLECTIONS.MESSAGES,
        [
          Query.lessThan('timestamp', cutoff),
          Query.limit(100)
        ]
      );

      for (const event of events.documents) {
        await databasesRef.current.deleteDocument(
          DATABASE_ID,
          COLLECTIONS.MESSAGES,
          event.$id
        );
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Initialize Appwrite client
    const { client, databases } = createBrowserAppwriteClient();
    clientRef.current = client;
    databasesRef.current = databases;

    // Subscribe to realtime events for this user
    const channels = [
      `databases.${DATABASE_ID}.collections.${COLLECTIONS.MESSAGES}.documents`,
    ];

    const unsubscribe = client.subscribe(channels, (response) => {
      console.log('[Appwrite Realtime] Event:', response.events);

      if (response.events.includes('databases.*.collections.*.documents.*.create')) {
        const doc = response.payload as any;

        // Check if this message is relevant to current user
        const isForMe = doc.receiverId === userId || doc.senderId === userId;
        const isInCurrentChat = activeChatId && (
          doc.senderId === activeChatId || doc.receiverId === activeChatId
        );
        const isInCurrentChannel = activeChannelId && doc.channelId === activeChannelId;

        if (isForMe || isInCurrentChat || isInCurrentChannel) {
          console.log('[Appwrite Realtime] New message event:', doc.messageId);
          onNewMessage(doc.messageId);
        }
      }
    });

    unsubscribeRef.current = unsubscribe;

    // Cleanup old events periodically
    const cleanupInterval = setInterval(cleanupEvents, 60000);
    cleanupEvents();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      clearInterval(cleanupInterval);
    };
  }, [userId, activeChatId, activeChannelId, onNewMessage, cleanupEvents]);

  return { createMessageEvent };
}
