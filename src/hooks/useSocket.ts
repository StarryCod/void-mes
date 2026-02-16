'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

// Global socket instance
let globalSocket: Socket | null = null;
let globalUserId: string | null = null;

export function useSocket() {
  const user = useAuthStore((state) => state.user);
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Get Socket.io server URL
  const getSocketUrl = useCallback(() => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return '';
  }, []);

  // Initialize socket connection
  useEffect(() => {
    const userId = user?.id;
    
    if (!userId) {
      if (globalSocket) {
        globalSocket.disconnect();
        globalSocket = null;
        globalUserId = null;
      }
      return;
    }

    // Reuse existing connection if same user
    if (globalUserId === userId && globalSocket?.connected) {
      socketRef.current = globalSocket;
      // Use queueMicrotask to avoid synchronous setState in effect
      queueMicrotask(() => setIsConnected(true));
      return;
    }

    // Disconnect old socket if exists
    if (globalSocket) {
      globalSocket.disconnect();
    }

    globalUserId = userId;
    const socketUrl = getSocketUrl();
    
    console.log('[Socket] Connecting to:', socketUrl, 'with port 3005');
    
    // Create new socket connection
    const socket = io(socketUrl, {
      path: '/socket.io',
      query: { XTransformPort: '3005' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    globalSocket = socket;
    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('[Socket] ✅ Connected:', socket.id);
      setIsConnected(true);
      setConnectionError(null);
      
      // Register user
      socket.emit('register', userId);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
      setConnectionError(error.message);
    });

    socket.on('registered', (data) => {
      console.log('[Socket] ✅ Registered as:', data.userId);
    });

    // ==================== MESSAGE HANDLERS ====================

    socket.on('new-message', (message) => {
      console.log('[Socket] 📩 New message from:', message.senderId);
      
      const currentChat = useChatStore.getState().activeChat;
      
      // Add message if chat is open with sender
      if (currentChat && message.senderId === currentChat.id) {
        useChatStore.getState().addMessage(message);
      }
      
      // Update contact list
      const contacts = useChatStore.getState().contacts;
      const existingContact = contacts.find(c => c.id === message.senderId);
      
      if (existingContact) {
        useChatStore.getState().setContacts(contacts.map(c =>
          c.id === message.senderId
            ? { ...c, lastMessage: message, unreadCount: (c.unreadCount || 0) + 1 }
            : c
        ));
      }

      // Show notification if tab is hidden
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Новое сообщение', { 
          body: message.content || 'Голосовое сообщение',
          icon: '/void-icon.svg'
        });
      }
    });

    // ==================== TYPING ====================

    socket.on('user-typing', (data: { userId: string; isTyping: boolean }) => {
      useChatStore.getState().setTypingUser(data.userId, '', data.isTyping);
    });

    // ==================== PRESENCE ====================

    socket.on('user-online', (data: { userId: string; timestamp: number }) => {
      console.log('[Socket] 🟢 User online:', data.userId);
      const contacts = useChatStore.getState().contacts;
      useChatStore.getState().setContacts(contacts.map(c =>
        c.id === data.userId ? { ...c, isOnline: true } : c
      ));
    });

    socket.on('user-offline', (data: { userId: string; timestamp: number }) => {
      console.log('[Socket] 🔴 User offline:', data.userId);
      const contacts = useChatStore.getState().contacts;
      useChatStore.getState().setContacts(contacts.map(c =>
        c.id === data.userId ? { ...c, isOnline: false, lastSeen: new Date().toISOString() } : c
      ));
    });

    socket.on('online-users', (userIds: string[]) => {
      console.log('[Socket] 📋 Online users:', userIds.length);
      const contacts = useChatStore.getState().contacts;
      useChatStore.getState().setContacts(contacts.map(c =>
        userIds.includes(c.id) ? { ...c, isOnline: true } : c
      ));
    });

    // ==================== CONTACTS ====================

    socket.on('new-contact', (contact) => {
      console.log('[Socket] 👤 New contact:', contact.id);
      const existingContacts = useChatStore.getState().contacts;
      
      if (!existingContacts.find(c => c.id === contact.id)) {
        useChatStore.getState().addContact({
          id: contact.id,
          username: contact.username || 'Unknown',
          displayName: contact.displayName || null,
          avatar: contact.avatar || null,
          bio: contact.bio || null,
          status: contact.status || null,
          isOnline: contact.isOnline ?? true,
          lastSeen: null,
          unreadCount: 0,
          lastMessage: null
        });
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Новый контакт', {
          body: `${contact.displayName || contact.username} добавил вас в друзья`,
          icon: '/void-icon.svg'
        });
      }
    });

    socket.on('messages-read', (data: { userId: string }) => {
      console.log('[Socket] ✅ Messages read by:', data.userId);
    });

    // ==================== CALL SIGNALING ====================

    socket.on('incoming-call', (data) => {
      console.log('[Socket] 📞 Incoming call from:', data.callerId);
      window.dispatchEvent(new CustomEvent('void-incoming-call', { 
        detail: data 
      }));
    });

    socket.on('call-answered', (data) => {
      console.log('[Socket] 📞 Call answered by:', data.answererId);
      window.dispatchEvent(new CustomEvent('void-call-answered', { 
        detail: data 
      }));
    });

    socket.on('call-rejected', (data) => {
      console.log('[Socket] 📞 Call rejected by:', data.rejecterId);
      window.dispatchEvent(new CustomEvent('void-call-rejected', { 
        detail: data 
      }));
    });

    socket.on('call-ended', (data) => {
      console.log('[Socket] 📞 Call ended by:', data.enderId);
      window.dispatchEvent(new CustomEvent('void-call-ended', { 
        detail: data 
      }));
    });

    socket.on('ice-candidate', (data) => {
      window.dispatchEvent(new CustomEvent('void-ice-candidate', { 
        detail: data 
      }));
    });

    socket.on('call-error', (data) => {
      console.error('[Socket] 📞 Call error:', data.message);
      window.dispatchEvent(new CustomEvent('void-call-error', { 
        detail: data 
      }));
    });

    // ==================== SCREEN SHARING ====================

    socket.on('remote-screen-start', (data) => {
      window.dispatchEvent(new CustomEvent('void-screen-start', { detail: data }));
    });

    socket.on('remote-screen-stop', (data) => {
      window.dispatchEvent(new CustomEvent('void-screen-stop', { detail: data }));
    });

    // ==================== COLLABORATION ====================

    socket.on('remote-canvas-draw', (data) => {
      window.dispatchEvent(new CustomEvent('void-canvas-draw', { detail: data }));
    });

    socket.on('remote-document', (data) => {
      window.dispatchEvent(new CustomEvent('void-document-update', { detail: data }));
    });

  }, [user?.id, getSocketUrl]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ==================== EMIT FUNCTIONS ====================

  const sendMessage = useCallback((receiverId: string | undefined, channelId: string | undefined, message: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('send-message', {
        receiverId,
        channelId,
        message
      });
    } else {
      console.warn('[Socket] Cannot send message - not connected');
    }
  }, []);

  const sendTyping = useCallback((targetId: string, isTyping: boolean) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('typing', { targetId, isTyping });
    }
  }, []);

  const markAsRead = useCallback((targetId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('mark-read', { targetId });
    }
  }, []);

  const notifyContactAdded = useCallback((contactId: string, contact: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('contact-added', { contactId, contact });
    }
  }, []);

  // ==================== CALL FUNCTIONS ====================

  const callUser = useCallback((targetId: string, signal: any, callType: 'voice' | 'video', callerName: string) => {
    if (!socketRef.current?.connected) {
      window.dispatchEvent(new CustomEvent('void-call-error', {
        detail: { message: 'Нет соединения с сервером. Попробуйте обновить страницу.' }
      }));
      return;
    }
    
    socketRef.current.emit('call-user', {
      targetId,
      signal,
      callType,
      callerName
    });
  }, []);

  const answerCall = useCallback((targetId: string, signal: any, callId?: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('call-answer', { targetId, signal, callId });
    }
  }, []);

  const rejectCall = useCallback((targetId: string, callId?: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('call-reject', { targetId, callId });
    }
  }, []);

  const endCall = useCallback((targetId: string, callId?: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('call-end', { targetId, callId });
    }
  }, []);

  const sendIceCandidate = useCallback((targetId: string, candidate: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('ice-candidate', { targetId, candidate });
    }
  }, []);

  // ==================== SCREEN/COLLABORATION ====================

  const notifyScreenShareStart = useCallback((targetId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('screen-share-start', { targetId });
    }
  }, []);

  const notifyScreenShareStop = useCallback((targetId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('screen-share-stop', { targetId });
    }
  }, []);

  const sendCanvasDraw = useCallback((targetId: string, from: { x: number; y: number }, to: { x: number; y: number }, color: string, size: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('canvas-draw', { targetId, from, to, color, size });
    }
  }, []);

  const sendDocumentUpdate = useCallback((targetId: string, text: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('document-update', { targetId, text });
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
    isConnected: () => socketRef.current?.connected || false,
    connectionError,
  };
}
