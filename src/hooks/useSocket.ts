'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

// Global WebSocket instance
let globalWs: WebSocket | null = null;
let globalUserId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useSocket() {
  const user = useAuthStore((state) => state.user);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const getWorkersUrl = useCallback(() => {
    return process.env.NEXT_PUBLIC_WORKERS_URL || 'https://void-time.mr-starred09.workers.dev';
  }, []);

  // Connect WebSocket
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
    
    if (globalUserId === userId && globalWs?.readyState === WebSocket.OPEN) {
      wsRef.current = globalWs;
      setIsConnected(true);
      return;
    }
    
    if (globalWs) {
      globalWs.close();
    }
    
    globalUserId = userId;
    const wsUrl = `${getWorkersUrl()}/ws/user/${userId}`;
    console.log('[WS] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    globalWs = ws;
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('[WS] ✅ Connected');
      setIsConnected(true);
      reconnectAttempts = 0;
      
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setIsConnected(false);
      
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (globalUserId) {
            const newWs = new WebSocket(`${getWorkersUrl()}/ws/user/${globalUserId}`);
            globalWs = newWs;
            wsRef.current = newWs;
          }
        }, delay);
      }
    };
    
    ws.onerror = (e) => {
      console.error('[WS] Error:', e);
    };
    
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [user?.id, getWorkersUrl]);

  // Handle incoming messages
  const handleMessage = useCallback((msg: any) => {
    console.log('[WS] Message:', msg.type);
    
    switch (msg.type) {
      case 'message':
        const message = msg.data;
        const currentChat = useChatStore.getState().activeChat;
        
        if (currentChat && message.senderId === currentChat.id) {
          useChatStore.getState().addMessage(message);
        }
        
        const contacts = useChatStore.getState().contacts;
        const existingContact = contacts.find(c => c.id === message.senderId);
        if (existingContact) {
          useChatStore.getState().setContacts(contacts.map(c =>
            c.id === message.senderId
              ? { ...c, lastMessage: message, unreadCount: (c.unreadCount || 0) + 1 }
              : c
          ));
        }
        
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Новое сообщение', { body: message.content || 'Голосовое сообщение' });
        }
        break;
        
      case 'typing':
        useChatStore.getState().setTypingUser(msg.senderId || '', '', msg.action === 'start');
        break;
        
      case 'presence':
        const presenceContacts = useChatStore.getState().contacts;
        if (msg.action === 'online') {
          useChatStore.getState().setContacts(presenceContacts.map(c =>
            c.id === msg.data.userId ? { ...c, isOnline: true } : c
          ));
        } else if (msg.action === 'offline') {
          useChatStore.getState().setContacts(presenceContacts.map(c =>
            c.id === msg.data.userId ? { ...c, isOnline: false, lastSeen: new Date().toISOString() } : c
          ));
        }
        break;
        
      case 'contact':
        if (msg.action === 'new') {
          const newContact = msg.data;
          const existingContacts = useChatStore.getState().contacts;
          
          if (!existingContacts.find(c => c.id === newContact.id)) {
            useChatStore.getState().addContact({
              id: newContact.id,
              username: newContact.username || 'Unknown',
              displayName: newContact.displayName || null,
              avatar: newContact.avatar || null,
              bio: newContact.bio || null,
              status: newContact.status || null,
              isOnline: newContact.isOnline ?? true,
              lastSeen: null,
              unreadCount: 0,
              lastMessage: null
            });
          }
          
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Новый контакт', {
              body: `${newContact.displayName || newContact.username} добавил вас в друзья`
            });
          }
        }
        break;
        
      case 'incoming-call':
        window.dispatchEvent(new CustomEvent('void-incoming-call', { detail: msg.data }));
        break;
        
      case 'call-answered':
        window.dispatchEvent(new CustomEvent('void-call-answered', { detail: msg.data }));
        break;
        
      case 'call-rejected':
        window.dispatchEvent(new CustomEvent('void-call-rejected', { detail: msg.data }));
        break;
        
      case 'call-ended':
        window.dispatchEvent(new CustomEvent('void-call-ended', { detail: msg.data }));
        break;
        
      case 'ice-candidate':
        window.dispatchEvent(new CustomEvent('void-ice-candidate', { detail: msg.data }));
        break;
    }
  }, []);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Send message through WebSocket
  const send = useCallback((msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        ...msg,
        timestamp: Date.now()
      }));
    } else {
      console.warn('[WS] Cannot send - not connected');
    }
  }, []);

  const sendMessage = useCallback((receiverId: string | undefined, channelId: string | undefined, message: any) => {
    send({
      type: 'message',
      action: 'new',
      data: {
        ...message,
        receiverId,
        channelId
      }
    });
  }, [send]);

  const sendTyping = useCallback((targetId: string, isTyping: boolean) => {
    send({
      type: 'typing',
      action: isTyping ? 'start' : 'stop',
      data: { targetId }
    });
  }, [send]);

  const notifyContactAdded = useCallback((contactId: string, contact: any) => {
    send({
      type: 'contact',
      action: 'new',
      data: {
        id: globalUserId,
        ...contact
      }
    });
  }, [send]);

  const markAsRead = useCallback((targetId: string) => {
    send({
      type: 'read',
      action: 'mark',
      data: { targetId }
    });
  }, [send]);

  const callUser = useCallback((targetId: string, signal: any, callType: 'voice' | 'video', callerName: string) => {
    if (!isConnected) {
      window.dispatchEvent(new CustomEvent('void-call-error', {
        detail: { message: 'Нет соединения с сервером. Попробуйте обновить страницу.' }
      }));
      return;
    }
    
    send({
      type: 'call',
      action: 'start',
      data: {
        targetId,
        signal,
        callType,
        callerName
      }
    });
  }, [send, isConnected]);

  const answerCall = useCallback((targetId: string, signal: any) => {
    send({
      type: 'call',
      action: 'answer',
      data: { targetId, signal }
    });
  }, [send]);

  const rejectCall = useCallback((targetId: string) => {
    send({
      type: 'call',
      action: 'reject',
      data: { targetId }
    });
  }, [send]);

  const endCall = useCallback((targetId: string) => {
    send({
      type: 'call',
      action: 'end',
      data: { targetId }
    });
  }, [send]);

  const sendIceCandidate = useCallback((targetId: string, candidate: any) => {
    send({
      type: 'call',
      action: 'ice',
      data: { targetId, candidate }
    });
  }, [send]);

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
    notifyScreenShareStart: () => {},
    notifyScreenShareStop: () => {},
    sendCanvasDraw: () => {},
    sendDocumentUpdate: () => {},
    isConnected: () => isConnected,
  };
}
