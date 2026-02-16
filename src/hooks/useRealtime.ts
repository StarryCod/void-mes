'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

// WebSocket message types
interface WSMessage {
  type: 'message' | 'typing' | 'read' | 'presence' | 'contact' | 'call';
  action: string;
  data: any;
  senderId?: string;
  timestamp?: number;
}

// Connection states
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// Global WebSocket instance
let globalWs: WebSocket | null = null;
let globalUserId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useRealtime() {
  const user = useAuthStore((state) => state.user);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  // Connect WebSocket
  const connect = useCallback(() => {
    const userId = user?.id;
    
    if (!userId) {
      if (globalWs) {
        globalWs.close();
        globalWs = null;
        globalUserId = null;
      }
      return;
    }
    
    // Already connected as same user
    if (globalUserId === userId && globalWs?.readyState === WebSocket.OPEN) {
      wsRef.current = globalWs;
      setConnectionState('connected');
      return;
    }
    
    // Close existing connection
    if (globalWs) {
      globalWs.close();
    }
    
    setConnectionState('connecting');
    globalUserId = userId;
    
    // Connect to Cloudflare Workers WebSocket
    const wsUrl = `${process.env.NEXT_PUBLIC_WORKERS_URL || 'https://void-time.mr-starred09.workers.dev'}/ws/user/${userId}`;
    console.log('[Realtime] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    globalWs = ws;
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('[Realtime] ✅ Connected');
      setConnectionState('connected');
      reconnectAttempts = 0;
      
      // Start heartbeat
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };
    
    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('[Realtime] Failed to parse message:', e);
      }
    };
    
    ws.onclose = (event) => {
      console.log('[Realtime] Disconnected:', event.reason);
      setConnectionState('disconnected');
      
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      
      // Reconnect with exponential backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        
        console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[Realtime] Error:', error);
      setConnectionState('error');
    };
  }, [user?.id]);
  
  // Handle incoming messages
  const handleMessage = useCallback((msg: WSMessage) => {
    console.log('[Realtime] Message:', msg.type, msg.action);
    
    switch (msg.type) {
      case 'message':
        if (msg.action === 'new') {
          const message = msg.data;
          const currentChat = useChatStore.getState().activeChat;
          
          // Add message if it's from current chat
          if (currentChat && message.senderId === currentChat.id) {
            useChatStore.getState().addMessage(message);
          }
          
          // Update contact's last message
          const contacts = useChatStore.getState().contacts;
          const existingContact = contacts.find(c => c.id === message.senderId);
          if (existingContact) {
            useChatStore.getState().setContacts(contacts.map(c =>
              c.id === message.senderId
                ? { ...c, lastMessage: message, unreadCount: (c.unreadCount || 0) + 1 }
                : c
            ));
          }
          
          // Show notification
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Новое сообщение', {
              body: message.content || 'Голосовое сообщение',
            });
          }
        }
        break;
        
      case 'typing':
        if (msg.action === 'start' || msg.action === 'stop') {
          useChatStore.getState().setTypingUser(
            msg.senderId || '',
            '',
            msg.action === 'start'
          );
        }
        break;
        
      case 'presence':
        if (msg.action === 'online') {
          const contacts = useChatStore.getState().contacts;
          useChatStore.getState().setContacts(contacts.map(c =>
            c.id === msg.data.userId ? { ...c, isOnline: true } : c
          ));
        } else if (msg.action === 'offline') {
          const contacts = useChatStore.getState().contacts;
          useChatStore.getState().setContacts(contacts.map(c =>
            c.id === msg.data.userId
              ? { ...c, isOnline: false, lastSeen: new Date().toISOString() }
              : c
          ));
        }
        break;
        
      case 'contact':
        if (msg.action === 'new') {
          const contacts = useChatStore.getState().contacts;
          const newContact = msg.data;
          
          if (!contacts.find(c => c.id === newContact.id)) {
            useChatStore.getState().addContact({
              id: newContact.id,
              username: newContact.username,
              displayName: newContact.displayName,
              avatar: newContact.avatar,
              bio: newContact.bio,
              status: newContact.status,
              isOnline: newContact.isOnline,
              lastSeen: null,
              unreadCount: 0,
              lastMessage: null,
            });
          }
          
          // Show notification
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Новый контакт', {
              body: `${newContact.displayName || newContact.username} добавил вас в друзья`,
            });
          }
        }
        break;
        
      case 'call':
        // Forward call events to CallManager
        window.dispatchEvent(new CustomEvent(`void-${msg.action}`, {
          detail: msg.data,
        }));
        break;
    }
  }, []);
  
  // Connect on mount
  useEffect(() => {
    connect();
    
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);
  
  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);
  
  // Send message through WebSocket
  const send = useCallback((msg: Partial<WSMessage>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        ...msg,
        timestamp: Date.now(),
      }));
    }
  }, []);
  
  // Typing indicator
  const sendTyping = useCallback((targetId: string, isTyping: boolean) => {
    send({
      type: 'typing',
      action: isTyping ? 'start' : 'stop',
      data: { targetId },
    });
  }, [send]);
  
  // Mark messages as read
  const sendRead = useCallback((targetId: string) => {
    send({
      type: 'read',
      action: 'mark',
      data: { targetId },
    });
  }, [send]);
  
  return {
    connectionState,
    isConnected: connectionState === 'connected',
    send,
    sendTyping,
    sendRead,
  };
}
