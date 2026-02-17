'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

// Global WebSocket instance to prevent duplicate connections
let globalWs: WebSocket | null = null;
let globalUserId: string | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let messageQueue: any[] = []; // Queue for messages during reconnect

const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL = 25000; // 25 seconds

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
  const lastPongRef = useRef<number>(Date.now());

  // Handle incoming messages - defined first to avoid hoisting issues
  const handleMessage = useCallback((msg: any) => {
    const { type, action, data, senderId } = msg;
    
    console.log('[WebSocket] 📨 Received:', type, action, { data, senderId });

    // Handle pong - update last pong time
    if (type === 'pong') {
      lastPongRef.current = Date.now();
      return;
    }

    // Handle connection confirmation
    if (type === 'connected') {
      console.log('[WebSocket] ✅ Connection confirmed for user:', msg.userId);
      return;
    }

    switch (type) {
      case 'message':
        if (action === 'new') {
          console.log('[WebSocket] 📩 New message from:', data?.senderId || senderId);
          
          const currentChat = useChatStore.getState().activeChat;
          const messageData = data?.senderId ? data : { ...data, senderId };
          
          console.log('[WebSocket] 🔍 Debug:', {
            currentChatId: currentChat?.id,
            messageSenderId: messageData.senderId,
            willAdd: currentChat && messageData.senderId === currentChat.id
          });
          
          // Add message if chat is open with sender
          if (currentChat && messageData.senderId === currentChat.id) {
            console.log('[WebSocket] ✅ Adding message to UI');
            useChatStore.getState().addMessage(messageData);
          } else {
            console.log('[WebSocket] ⚠️ Message not added - chat not open or different sender');
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
        useChatStore.getState().setTypingUser(senderId || '', '', data?.isTyping ?? true);
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

  // Start heartbeat mechanism
  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    
    heartbeatInterval = setInterval(() => {
      if (globalWs?.readyState === WebSocket.OPEN) {
        // Check if we received a pong recently
        const timeSinceLastPong = Date.now() - lastPongRef.current;
        if (timeSinceLastPong > 60000) {
          console.log('[WebSocket] No pong received for 60s, reconnecting...');
          globalWs.close(1000, 'Heartbeat timeout');
          return;
        }
        
        // Send ping
        globalWs.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        console.log('[WebSocket] 🏓 Ping sent');
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  // Process queued messages
  const processMessageQueue = useCallback(() => {
    if (messageQueue.length > 0 && globalWs?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Processing', messageQueue.length, 'queued messages');
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        globalWs.send(JSON.stringify(msg));
      }
    }
  }, []);

  // Connect WebSocket
  const connect = useCallback(() => {
    const userId = user?.id;
    
    if (!userId) {
      if (globalWs) {
        globalWs.close();
        globalWs = null;
        globalUserId = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
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
      reconnectAttempts = 0;
      lastPongRef.current = Date.now();
      
      // Start heartbeat
      startHeartbeat();
      
      // Process any queued messages
      processMessageQueue();
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected:', event.code, event.reason);
      setIsConnected(false);
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      
      // Attempt reconnect with exponential backoff
      if (globalUserId === userId && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        
        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        
        reconnectTimeout = setTimeout(() => {
          connect();
        }, delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[WebSocket] Max reconnect attempts reached');
        setConnectionError('Connection lost. Please refresh the page.');
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Connection error:', error);
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
  }, [user?.id, handleMessage, startHeartbeat, processMessageQueue]);

  // Initialize WebSocket connection
  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };
  }, [connect]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ==================== SEND FUNCTIONS ====================

  // Safe send - queues message if not connected
  const safeSend = useCallback((msg: any) => {
    if (globalWs?.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify(msg));
      return true;
    } else {
      console.log('[WebSocket] Not connected, queuing message');
      messageQueue.push(msg);
      return false;
    }
  }, []);

  const sendMessage = useCallback((receiverId: string | undefined, channelId: string | undefined, message: any) => {
    safeSend({
      type: 'message',
      action: 'send',
      receiverId,
      channelId,
      targetId: receiverId,
      data: message,
      messageId: message.id,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const sendTyping = useCallback((targetId: string, isTyping: boolean) => {
    safeSend({
      type: 'typing',
      action: isTyping ? 'start' : 'stop',
      targetId,
      isTyping,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const markAsRead = useCallback((targetId: string) => {
    safeSend({
      type: 'read',
      action: 'mark',
      targetId,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const notifyContactAdded = useCallback((contactId: string, contact: any) => {
    safeSend({
      type: 'contact',
      action: 'added',
      contactId,
      data: contact,
      timestamp: Date.now()
    });
  }, [safeSend]);

  // ==================== CALL FUNCTIONS ====================
  // Calls use separate CallRoom Durable Object for better reliability

  const callUser = useCallback(async (targetId: string, signal: any, callType: 'voice' | 'video', callerName: string) => {
    // Check connection first
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      // Try to wait for connection
      console.log('[WebSocket] Waiting for connection before call...');
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (globalWs?.readyState === WebSocket.OPEN) {
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
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      window.dispatchEvent(new CustomEvent('void-call-error', {
        detail: { message: 'Нет соединения с сервером. Проверьте интернет.' }
      }));
      return;
    }
    
    const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    globalWs.send(JSON.stringify({
      type: 'call',
      action: 'start',
      targetId,
      callType,
      signal,
      callerName,
      callId,
      timestamp: Date.now()
    }));
  }, []);

  const answerCall = useCallback((targetId: string, signal: any, callId?: string) => {
    safeSend({
      type: 'call',
      action: 'answer',
      targetId,
      signal,
      callId,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const rejectCall = useCallback((targetId: string, callId?: string) => {
    safeSend({
      type: 'call',
      action: 'reject',
      targetId,
      callId,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const endCall = useCallback((targetId: string, callId?: string) => {
    safeSend({
      type: 'call',
      action: 'end',
      targetId,
      callId,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const sendIceCandidate = useCallback((targetId: string, candidate: any) => {
    safeSend({
      type: 'call',
      action: 'ice-candidate',
      targetId,
      candidate,
      timestamp: Date.now()
    });
  }, [safeSend]);

  // ==================== SCREEN/COLLABORATION ====================

  const notifyScreenShareStart = useCallback((targetId: string) => {
    safeSend({
      type: 'screen',
      action: 'start',
      targetId,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const notifyScreenShareStop = useCallback((targetId: string) => {
    safeSend({
      type: 'screen',
      action: 'stop',
      targetId,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const sendCanvasDraw = useCallback((targetId: string, from: { x: number; y: number }, to: { x: number; y: number }, color: string, size: number) => {
    safeSend({
      type: 'canvas',
      action: 'draw',
      targetId,
      from,
      to,
      color,
      size,
      timestamp: Date.now()
    });
  }, [safeSend]);

  const sendDocumentUpdate = useCallback((targetId: string, text: string) => {
    safeSend({
      type: 'document',
      action: 'update',
      targetId,
      text,
      timestamp: Date.now()
    });
  }, [safeSend]);

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
    isConnected: () => globalWs?.readyState === WebSocket.OPEN,
    connectionError,
    reconnectAttempts,
  };
}
