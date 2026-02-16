'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

// Global socket instance to prevent multiple connections
let globalSocket: Socket | null = null;
let globalUserId: string | null = null;

export function useSocket() {
  const user = useAuthStore((state) => state.user);
  const socketRef = useRef<Socket | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;

  // Single socket connection effect
  useEffect(() => {
    const userId = user?.id;
    
    // Skip if no user
    if (!userId) {
      // Disconnect if logged out
      if (globalSocket) {
        console.log('[Socket] User logged out, disconnecting');
        globalSocket.disconnect();
        globalSocket = null;
        globalUserId = null;
      }
      return;
    }

    // Already connected as same user
    if (globalUserId === userId && globalSocket?.connected) {
      socketRef.current = globalSocket;
      console.log('[Socket] Reusing existing connection');
      return;
    }

    // Disconnect existing socket if different user
    if (globalSocket) {
      console.log('[Socket] Different user, reconnecting');
      globalSocket.disconnect();
      globalSocket = null;
    }

    console.log('[Socket] Creating new connection for user:', userId);
    globalUserId = userId;

    const socket = io('/?XTransformPort=3005', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 15000,
      forceNew: true,
    });

    globalSocket = socket;
    socketRef.current = socket;

    // Connection successful
    socket.on('connect', () => {
      console.log('[Socket] ✅ Connected:', socket.id);
      reconnectAttemptsRef.current = 0;
      socket.emit('register', userId);
      
      // Start heartbeat
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (socket.connected) {
          socket.emit('ping');
        }
      }, 15000);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] ⚠️ Disconnected:', reason);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      
      // If server initiated disconnect, try to reconnect
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('connect_error', (error) => {
      reconnectAttemptsRef.current++;
      console.log('[Socket] ❌ Connection error (attempt', reconnectAttemptsRef.current, '):', error.message);
      
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        console.log('[Socket] Max reconnect attempts reached');
      }
    });

    socket.on('registered', (data) => {
      console.log('[Socket] ✅ Registered:', data.userId);
    });

    socket.on('pong', () => {
      // Heartbeat response - connection is alive
    });

    // Message handlers
    socket.on('new-message', (message) => {
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
    });

    socket.on('channel-message', (data) => {
      const currentChannel = useChatStore.getState().activeChannel;
      if (currentChannel && data.channelId === currentChannel.id) {
        useChatStore.getState().addMessage(data.message);
      }
    });

    socket.on('new-contact', (contactData) => {
      const contacts = useChatStore.getState().contacts;
      if (!contacts.find(c => c.id === contactData.id)) {
        useChatStore.getState().addContact({
          id: contactData.id,
          username: contactData.username || 'Unknown',
          displayName: contactData.displayName || null,
          avatar: contactData.avatar || null,
          bio: contactData.bio || null,
          status: contactData.status || null,
          isOnline: true,
          lastSeen: null,
          unreadCount: 0,
          lastMessage: null
        });
      }
    });

    socket.on('user-typing', (data) => {
      useChatStore.getState().setTypingUser(data.userId, '', data.isTyping);
    });

    socket.on('user-online', (data) => {
      const contacts = useChatStore.getState().contacts;
      useChatStore.getState().setContacts(contacts.map(c => 
        c.id === data.userId ? { ...c, isOnline: true } : c
      ));
    });

    socket.on('user-offline', (data) => {
      const contacts = useChatStore.getState().contacts;
      useChatStore.getState().setContacts(contacts.map(c => 
        c.id === data.userId ? { ...c, isOnline: false, lastSeen: new Date().toISOString() } : c
      ));
    });

    // Call events
    socket.on('incoming-call', (data) => {
      console.log('[Socket] 📞 Incoming call from:', data.callerId);
      window.dispatchEvent(new CustomEvent('void-incoming-call', { detail: data }));
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`${data.callType === 'video' ? '📹' : '📞'} Входящий звонок`, {
          body: `Звонит ${data.callerName}`,
          requireInteraction: true
        });
      }
    });

    socket.on('call-answered', (data) => {
      console.log('[Socket] 📞 Call answered by:', data.answererId);
      window.dispatchEvent(new CustomEvent('void-call-answered', { detail: data }));
    });

    socket.on('call-rejected', (data) => {
      console.log('[Socket] 📞 Call rejected by:', data.rejecterId);
      window.dispatchEvent(new CustomEvent('void-call-rejected', { detail: data }));
    });

    socket.on('call-ended', (data) => {
      console.log('[Socket] 📞 Call ended by:', data.enderId);
      window.dispatchEvent(new CustomEvent('void-call-ended', { detail: data }));
    });

    socket.on('ice-candidate', (data) => {
      window.dispatchEvent(new CustomEvent('void-ice-candidate', { detail: data }));
    });

    socket.on('call-error', (data) => {
      // Only log, don't show error to user for "user unavailable"
      console.log('[Socket] 📞 Call error:', data.message);
      window.dispatchEvent(new CustomEvent('void-call-error', { detail: data }));
    });

    socket.on('remote-screen-start', (data) => {
      window.dispatchEvent(new CustomEvent('void-remote-screen-start', { detail: data }));
    });

    socket.on('remote-screen-stop', (data) => {
      window.dispatchEvent(new CustomEvent('void-remote-screen-stop', { detail: data }));
    });

    socket.on('remote-canvas-draw', (data) => {
      window.dispatchEvent(new CustomEvent('void-remote-canvas-draw', { detail: data }));
    });

    socket.on('remote-document', (data) => {
      window.dispatchEvent(new CustomEvent('void-remote-document', { detail: data }));
    });

    return () => {
      console.log('[Socket] Cleanup for user effect');
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      // Don't disconnect on cleanup - keep connection alive
      // Only disconnect on logout
    };
  }, [user?.id]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Helper functions that use the socket ref
  const getSocket = useCallback(() => socketRef.current || globalSocket, []);

  const sendMessage = useCallback((receiverId: string | undefined, channelId: string | undefined, message: any) => {
    const socket = getSocket();
    if (socket?.connected && message) {
      socket.emit('send-message', { receiverId, channelId, message });
    } else {
      console.warn('[Socket] Cannot send message - not connected');
    }
  }, [getSocket]);

  const sendTyping = useCallback((targetId: string, isTyping: boolean) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      socket.emit('typing', { targetId, isTyping });
    }
  }, [getSocket]);

  const notifyContactAdded = useCallback((contactId: string, contact: any) => {
    const socket = getSocket();
    if (socket?.connected && contactId) {
      socket.emit('contact-added', { contactId, contact });
    }
  }, [getSocket]);

  const markAsRead = useCallback((targetId: string) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      socket.emit('mark-read', { targetId });
    }
  }, [getSocket]);

  const callUser = useCallback((targetId: string, signal: any, callType: 'voice' | 'video', callerName: string) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      console.log('[Socket] 📞 Calling:', targetId);
      socket.emit('call-user', { targetId, signal, callType, callerName });
    } else {
      console.error('[Socket] Cannot call - not connected');
      // Show error to user
      window.dispatchEvent(new CustomEvent('void-call-error', { 
        detail: { message: 'Нет соединения с сервером. Попробуйте обновить страницу.' }
      }));
    }
  }, [getSocket]);

  const answerCall = useCallback((targetId: string, signal: any) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      console.log('[Socket] 📞 Answering call to:', targetId);
      socket.emit('call-answer', { targetId, signal });
    }
  }, [getSocket]);

  const rejectCall = useCallback((targetId: string) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('call-reject', { targetId });
    }
  }, [getSocket]);

  const endCall = useCallback((targetId: string) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('call-end', { targetId });
    }
  }, [getSocket]);

  const sendIceCandidate = useCallback((targetId: string, candidate: any) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      socket.emit('ice-candidate', { targetId, candidate });
    }
  }, [getSocket]);

  const notifyScreenShareStart = useCallback((targetId: string) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('screen-share-start', { targetId });
    }
  }, [getSocket]);

  const notifyScreenShareStop = useCallback((targetId: string) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('screen-share-stop', { targetId });
    }
  }, [getSocket]);

  const sendCanvasDraw = useCallback((targetId: string, from: {x: number, y: number}, to: {x: number, y: number}, color: string, size: number) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      socket.emit('canvas-draw', { targetId, from, to, color, size });
    }
  }, [getSocket]);

  const sendDocumentUpdate = useCallback((targetId: string, text: string) => {
    const socket = getSocket();
    if (socket?.connected && targetId) {
      socket.emit('document-update', { targetId, text });
    }
  }, [getSocket]);

  const isConnected = useCallback(() => {
    const socket = getSocket();
    return socket?.connected ?? false;
  }, [getSocket]);

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
    isConnected,
  };
}
