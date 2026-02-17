'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

// Global WebSocket instance
let globalWs: WebSocket | null = null;
let globalUserId: string | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;

// Cloudflare Workers URL - must use wss:// for secure WebSocket
const getWebSocketUrl = (userId: string) => {
  const baseUrl = process.env.NEXT_PUBLIC_CF_WORKERS_URL || 'https://void-time.mr-starred09.workers.dev';
  // Convert https:// to wss:// for WebSocket
  const wsUrl = baseUrl.replace(/^https?:\/\//, 'wss://');
  return `${wsUrl}/ws/user/${userId}`;
};

export function useWebSocket() {
  const user = useAuthStore((state) => state.user);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Handle incoming messages - defined first to avoid hoisting issues
  const handleMessage = useCallback((msg: any) => {
    const { type, action, data, senderId } = msg;

    switch (type) {
      case 'message':
        if (action === 'new') {
          console.log('[WebSocket] 📩 New message from:', data?.senderId || senderId);
          
          const currentChat = useChatStore.getState().activeChat;
          const messageData = data?.senderId ? data : { ...data, senderId };
          
          // Add message if chat is open with sender
          if (currentChat && messageData.senderId === currentChat.id) {
            useChatStore.getState().addMessage(messageData);
          }
          
          // Update contact list
          const contacts = useChatStore.getState().contacts;
          const existingContact = contacts.find(c => c.id === messageData.senderId);
          
          if (existingContact) {
            useChatStore.getState().setContacts(contacts.map(c =>
              c.id === messageData.senderId
                ? { ...c, lastMessage: messageData, unreadCount: (c.unreadCount || 0) + 1 }
                : c
            ));
          }

          // Show notification if tab is hidden
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Новое сообщение', { 
              body: messageData.content || 'Голосовое сообщение',
            });
          }
        }
        break;

      case 'typing':
        useChatStore.getState().setTypingUser(senderId, '', data?.isTyping ?? true);
        break;

      case 'presence':
        if (action === 'online') {
          console.log('[WebSocket] 🟢 User online:', data?.userId || senderId);
          const contacts = useChatStore.getState().contacts;
          useChatStore.getState().setContacts(contacts.map(c =>
            c.id === (data?.userId || senderId) ? { ...c, isOnline: true } : c
          ));
        } else if (action === 'offline') {
          console.log('[WebSocket] 🔴 User offline:', data?.userId || senderId);
          const contacts = useChatStore.getState().contacts;
          useChatStore.getState().setContacts(contacts.map(c =>
            c.id === (data?.userId || senderId) ? { ...c, isOnline: false, lastSeen: new Date().toISOString() } : c
          ));
        }
        break;

      case 'contact':
        if (action === 'new') {
          console.log('[WebSocket] 👤 New contact:', data?.id);
          const existingContacts = useChatStore.getState().contacts;
          
          if (data && !existingContacts.find(c => c.id === data.id)) {
            useChatStore.getState().addContact({
              id: data.id,
              username: data.username || 'Unknown',
              displayName: data.displayName || null,
              avatar: data.avatar || null,
              bio: data.bio || null,
              status: data.status || null,
              isOnline: data.isOnline ?? true,
              lastSeen: null,
              unreadCount: 0,
              lastMessage: null
            });
          }

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Новый контакт', {
              body: `${data?.displayName || data?.username} добавил вас в друзья`,
            });
          }
        }
        break;

      case 'call':
        // Handle call signaling
        window.dispatchEvent(new CustomEvent(`void-${action}`, { detail: data }));
        break;
    }
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    const userId = user?.id;
    
    if (!userId) {
      if (globalWs) {
        globalWs.close();
        globalWs = null;
        globalUserId = null;
      }
      return;
    }

    // Reuse existing connection if same user
    if (globalUserId === userId && globalWs?.readyState === WebSocket.OPEN) {
      wsRef.current = globalWs;
      queueMicrotask(() => setIsConnected(true));
      return;
    }

    // Close old connection if exists
    if (globalWs) {
      globalWs.close();
    }

    // Clear any pending reconnect
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    globalUserId = userId;
    
    // Connect to Cloudflare Workers WebSocket
    const wsUrl = getWebSocketUrl(userId);
    
    console.log('[WebSocket] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    globalWs = ws;
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] ✅ Connected');
      setIsConnected(true);
      setConnectionError(null);
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected:', event.reason);
      setIsConnected(false);
      
      // Attempt reconnect after 3 seconds
      if (globalUserId === userId) {
        reconnectTimeout = setTimeout(() => {
          console.log('[WebSocket] Attempting reconnect...');
          // Trigger reconnect by resetting
          globalWs = null;
          globalUserId = null;
        }, 3000);
      }
    };

    ws.onerror = () => {
      console.error('[WebSocket] Connection error');
      queueMicrotask(() => setConnectionError('Connection error'));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('[WebSocket] Parse error:', e);
      }
    };

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };
  }, [user?.id, handleMessage]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ==================== SEND FUNCTIONS ====================

  const sendMessage = useCallback((receiverId: string | undefined, channelId: string | undefined, message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        action: 'send',
        receiverId,
        channelId,
        data: message
      }));
    } else {
      console.warn('[WebSocket] Cannot send message - not connected');
    }
  }, []);

  const sendTyping = useCallback((targetId: string, isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'typing',
        targetId,
        isTyping
      }));
    }
  }, []);

  const markAsRead = useCallback((targetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'read',
        targetId
      }));
    }
  }, []);

  const notifyContactAdded = useCallback((contactId: string, contact: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'contact',
        action: 'added',
        contactId,
        data: contact
      }));
    }
  }, []);

  // ==================== CALL FUNCTIONS ====================
  // Calls use separate CallRoom Durable Object for better reliability

  const callUser = useCallback(async (targetId: string, signal: any, callType: 'voice' | 'video', callerName: string) => {
    // Check connection first
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Try to wait for connection
      console.log('[WebSocket] Waiting for connection before call...');
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });
    }

    // Check again after waiting
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      window.dispatchEvent(new CustomEvent('void-call-error', {
        detail: { message: 'Нет соединения с сервером. Проверьте интернет.' }
      }));
      return;
    }
    
    const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    wsRef.current.send(JSON.stringify({
      type: 'call',
      action: 'start',
      targetId,
      callType,
      signal,
      callerName,
      callId
    }));
  }, []);

  const answerCall = useCallback((targetId: string, signal: any, callId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'call',
        action: 'answer',
        targetId,
        signal,
        callId
      }));
    }
  }, []);

  const rejectCall = useCallback((targetId: string, callId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'call',
        action: 'reject',
        targetId,
        callId
      }));
    }
  }, []);

  const endCall = useCallback((targetId: string, callId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'call',
        action: 'end',
        targetId,
        callId
      }));
    }
  }, []);

  const sendIceCandidate = useCallback((targetId: string, candidate: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'call',
        action: 'ice-candidate',
        targetId,
        candidate
      }));
    }
  }, []);

  // ==================== SCREEN/COLLABORATION ====================

  const notifyScreenShareStart = useCallback((targetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'screen',
        action: 'start',
        targetId
      }));
    }
  }, []);

  const notifyScreenShareStop = useCallback((targetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'screen',
        action: 'stop',
        targetId
      }));
    }
  }, []);

  const sendCanvasDraw = useCallback((targetId: string, from: { x: number; y: number }, to: { x: number; y: number }, color: string, size: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'canvas',
        action: 'draw',
        targetId,
        from,
        to,
        color,
        size
      }));
    }
  }, []);

  const sendDocumentUpdate = useCallback((targetId: string, text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'document',
        action: 'update',
        targetId,
        text
      }));
    }
  }, []);

  return {
    sendMessage,
    sendTyping,
    markAsRead,
    notifyContactAdded,
    callUser,
    answerCall,
    rejectCall,
    endCall,
    sendIceCandidate,
    notifyScreenShareStart,
    notifyScreenShareStop,
    sendCanvasDraw,
    sendDocumentUpdate,
    isConnected: () => wsRef.current?.readyState === WebSocket.OPEN,
    connectionError,
  };
}
