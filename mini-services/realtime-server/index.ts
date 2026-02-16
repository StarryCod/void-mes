import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

const PORT = 3005;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 20000,
  transports: ['websocket', 'polling'],
});

// User tracking
const users = new Map<string, Set<string>>(); // userId -> Set of socketIds
const socketToUser = new Map<string, string>(); // socketId -> userId
const userLastSeen = new Map<string, number>(); // userId -> timestamp

// Active calls tracking
const activeCalls = new Map<string, { callerId: string; receiverId: string; startTime: number; type: 'voice' | 'video' }>();

function logState() {
  console.log(`[Realtime] 📊 Online users: ${users.size}`);
  users.forEach((sockets, userId) => {
    console.log(`  - ${userId} (${sockets.size} connection${sockets.size > 1 ? 's' : ''})`);
  });
  console.log(`[Realtime] 📞 Active calls: ${activeCalls.size}`);
}

io.on('connection', (socket: Socket) => {
  console.log(`[Realtime] 🔌 Client connected: ${socket.id}`);
  const connectionTime = Date.now();

  // ==================== REGISTRATION ====================
  
  socket.on('register', (userId: string) => {
    if (!userId) {
      console.log(`[Realtime] ⚠️ Invalid registration from ${socket.id}`);
      return;
    }
    
    // Add socket to user's connections
    if (!users.has(userId)) {
      users.set(userId, new Set());
    }
    users.get(userId)!.add(socket.id);
    socketToUser.set(socket.id, userId);
    userLastSeen.set(userId, Date.now());
    
    console.log(`[Realtime] ✅ User registered: ${userId} -> ${socket.id}`);
    socket.emit('registered', { success: true, userId });
    
    // Broadcast online status
    socket.broadcast.emit('user-online', { userId, timestamp: Date.now() });
    
    // Send list of online users to this user
    const onlineUsers = Array.from(users.keys()).filter(id => id !== userId);
    socket.emit('online-users', onlineUsers);
    
    logState();
  });

  // ==================== HEARTBEAT ====================
  
  socket.on('ping', () => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      userLastSeen.set(userId, Date.now());
    }
    socket.emit('pong', { timestamp: Date.now() });
  });

  // ==================== MESSAGING ====================
  
  socket.on('send-message', (data: { 
    receiverId?: string; 
    channelId?: string;
    message: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    console.log(`[Realtime] 💬 Message from ${senderId} to ${data.receiverId || `channel:${data.channelId}`}`);
    
    const messageData = {
      ...data.message,
      senderId,
      timestamp: Date.now()
    };
    
    if (data.receiverId) {
      // Direct message
      const targetSockets = users.get(data.receiverId);
      if (targetSockets && targetSockets.size > 0) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('new-message', messageData);
        });
        console.log(`[Realtime] ✅ Message delivered to ${data.receiverId}`);
      } else {
        console.log(`[Realtime] ⚠️ User ${data.receiverId} not online`);
      }
    } else if (data.channelId) {
      // Channel message
      socket.broadcast.emit('channel-message', {
        channelId: data.channelId,
        message: messageData
      });
    }
  });

  // ==================== TYPING ====================
  
  socket.on('typing', (data: { targetId: string; isTyping: boolean }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('user-typing', {
          userId: senderId,
          isTyping: data.isTyping
        });
      });
    }
  });

  // ==================== CONTACTS ====================
  
  socket.on('contact-added', (data: { 
    contactId: string;
    contact: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    console.log(`[Realtime] 👤 Contact: ${senderId} added ${data.contactId}`);
    
    const targetSockets = users.get(data.contactId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('new-contact', {
          ...data.contact,
          id: senderId,
          isOnline: true
        });
      });
    }
  });

  socket.on('mark-read', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('messages-read', { userId: senderId });
      });
    }
  });

  // ==================== CALLS (WebRTC Signaling) ====================
  
  socket.on('call-user', (data: { 
    targetId: string;
    signal: any;
    callType: 'voice' | 'video';
    callerName: string;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) {
      socket.emit('call-error', { message: 'Not registered' });
      return;
    }
    
    console.log(`[Realtime] 📞 Call from ${senderId} to ${data.targetId} (${data.callType})`);
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets && targetSockets.size > 0) {
      // Generate call ID
      const callId = `${senderId}-${data.targetId}-${Date.now()}`;
      
      // Store active call
      activeCalls.set(callId, {
        callerId: senderId,
        receiverId: data.targetId,
        startTime: Date.now(),
        type: data.callType
      });
      
      // Send call to all receiver's connections
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('incoming-call', {
          callId,
          callerId: senderId,
          callerName: data.callerName,
          callType: data.callType,
          signal: data.signal
        });
      });
      
      console.log(`[Realtime] ✅ Call signal sent to ${data.targetId}`);
    } else {
      console.log(`[Realtime] ⚠️ User ${data.targetId} not online`);
      socket.emit('call-error', { 
        message: 'Пользователь недоступен',
        targetId: data.targetId 
      });
    }
  });

  socket.on('call-answer', (data: { 
    callId?: string;
    targetId: string;
    signal: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    console.log(`[Realtime] 📞 Call answer from ${senderId} to ${data.targetId}`);
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('call-answered', {
          answererId: senderId,
          signal: data.signal
        });
      });
      console.log(`[Realtime] ✅ Call answer delivered to ${data.targetId}`);
    }
  });

  socket.on('call-reject', (data: { targetId: string; callId?: string }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    console.log(`[Realtime] 📞 Call rejected by ${senderId}`);
    
    // Remove active call
    if (data.callId) {
      activeCalls.delete(data.callId);
    }
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('call-rejected', {
          rejecterId: senderId
        });
      });
    }
  });

  socket.on('call-end', (data: { targetId: string; callId?: string }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    console.log(`[Realtime] 📞 Call ended by ${senderId}`);
    
    // Remove active call
    if (data.callId) {
      activeCalls.delete(data.callId);
    }
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('call-ended', {
          enderId: senderId
        });
      });
    }
  });

  // ==================== ICE CANDIDATES ====================
  
  socket.on('ice-candidate', (data: { 
    targetId: string;
    candidate: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('ice-candidate', {
          senderId,
          candidate: data.candidate
        });
      });
    }
  });

  // ==================== SCREEN SHARING ====================
  
  socket.on('screen-share-start', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('remote-screen-start', { userId: senderId });
      });
    }
  });

  socket.on('screen-share-stop', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('remote-screen-stop', { userId: senderId });
      });
    }
  });

  // ==================== COLLABORATION ====================
  
  socket.on('canvas-draw', (data: {
    targetId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    color: string;
    size: number;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('remote-canvas-draw', {
          from: data.from,
          to: data.to,
          color: data.color,
          size: data.size
        });
      });
    }
  });

  socket.on('document-update', (data: {
    targetId: string;
    text: string;
  }) => {
    const senderId = socketToUser.get(socket.id);
    if (!senderId) return;
    
    const targetSockets = users.get(data.targetId);
    if (targetSockets) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('remote-document', { text: data.text });
      });
    }
  });

  // ==================== DISCONNECT ====================
  
  socket.on('disconnect', (reason) => {
    const userId = socketToUser.get(socket.id);
    
    if (userId) {
      const duration = Math.round((Date.now() - connectionTime) / 1000);
      console.log(`[Realtime] ❌ User disconnected: ${userId} (${reason}, duration: ${duration}s)`);
      
      // Remove this socket from user's connections
      const userSockets = users.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        
        // If no more connections, mark user offline
        if (userSockets.size === 0) {
          users.delete(userId);
          userLastSeen.delete(userId);
          
          // Broadcast offline status
          socket.broadcast.emit('user-offline', { 
            userId, 
            timestamp: Date.now() 
          });
        }
      }
      
      socketToUser.delete(socket.id);
      logState();
    } else {
      console.log(`[Realtime] ❌ Unregistered socket disconnected: ${socket.id}`);
    }
  });
});

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  userLastSeen.forEach((lastSeen, userId) => {
    if (now - lastSeen > 120000) { // 2 minutes without activity
      console.log(`[Realtime] 🧹 Cleaning stale user: ${userId}`);
      const userSockets = users.get(userId);
      if (userSockets) {
        userSockets.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) socket.disconnect(true);
        });
      }
      users.delete(userId);
      userLastSeen.delete(userId);
    }
  });
  
  // Clean up stale calls
  activeCalls.forEach((call, callId) => {
    if (now - call.startTime > 3600000) { // 1 hour
      activeCalls.delete(callId);
    }
  });
}, 60000);

httpServer.listen(PORT, () => {
  console.log(`[Realtime] 🚀 Server running on port ${PORT}`);
  console.log(`[Realtime] 📡 Socket.io with WebSocket + Polling fallback`);
});
