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
  pingTimeout: 60000,      // Close connection after 60s of no ping response
  pingInterval: 25000,     // Send ping every 25s
  connectTimeout: 15000,   // Connection timeout
});

// Store user socket mappings
const users = new Map<string, string>(); // userId -> socketId
const socketToUser = new Map<string, string>(); // socketId -> userId
const userLastSeen = new Map<string, number>(); // userId -> timestamp

// Log current state
function logState() {
  console.log(`[Chat] Online users: ${users.size}`);
  users.forEach((socketId, userId) => {
    console.log(`  - ${userId} (${socketId})`);
  });
}

io.on('connection', (socket: Socket) => {
  console.log(`[Chat] Client connected: ${socket.id}`);
  const connectionTime = Date.now();

  // User registers their ID
  socket.on('register', (userId: string) => {
    if (!userId) {
      console.log(`[Chat] Invalid registration attempt from ${socket.id}`);
      return;
    }
    
    // If user already registered, disconnect old socket
    const existingSocketId = users.get(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
      console.log(`[Chat] User ${userId} already connected, disconnecting old socket`);
      const oldSocket = io.sockets.sockets.get(existingSocketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
    }
    
    console.log(`[Chat] ✅ User registered: ${userId} -> ${socket.id}`);
    users.set(userId, socket.id);
    socketToUser.set(socket.id, userId);
    userLastSeen.set(userId, Date.now());
    socket.emit('registered', { success: true, userId });
    
    // Broadcast user online status to all others
    socket.broadcast.emit('user-online', { userId, timestamp: Date.now() });
    console.log(`[Chat] Broadcast online status for ${userId}`);
    
    logState();
  });

  // Heartbeat ping/pong
  socket.on('ping', () => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      userLastSeen.set(userId, Date.now());
    }
    socket.emit('pong');
  });

  // Handle new message
  socket.on('send-message', (data: { 
    receiverId?: string; 
    channelId?: string;
    message: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    console.log(`[Chat] Message from ${senderId} to`, data.receiverId || `channel ${data.channelId}`);
    
    if (data.receiverId) {
      // Direct message
      const targetSocketId = users.get(data.receiverId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('new-message', {
          ...data.message,
          senderId
        });
        console.log(`[Chat] ✅ Delivered message to ${data.receiverId}`);
      } else {
        console.log(`[Chat] ⚠️ User ${data.receiverId} not online`);
      }
    } else if (data.channelId) {
      // Channel message - broadcast to all
      socket.broadcast.emit('channel-message', {
        channelId: data.channelId,
        message: {
          ...data.message,
          senderId
        }
      });
    }
  });

  // Handle typing indicator
  socket.on('typing', (data: { targetId: string; isTyping: boolean }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('user-typing', {
        userId: senderId,
        isTyping: data.isTyping
      });
    }
  });

  // Handle new contact added
  socket.on('contact-added', (data: { 
    contactId: string;
    contact: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.contactId);
    
    console.log(`[Chat] Contact added: ${senderId} added ${data.contactId}`);
    
    if (targetSocketId && senderId) {
      // Notify the added contact that they have a new friend
      io.to(targetSocketId).emit('new-contact', {
        ...data.contact,
        id: senderId
      });
      console.log(`[Chat] Notified ${data.contactId} about new contact`);
    }
  });

  // Handle message read
  socket.on('mark-read', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('messages-read', {
        userId: senderId
      });
    }
  });

  // Handle incoming call signaling (relay through this server)
  socket.on('call-user', (data: { 
    targetId: string;
    signal: any;
    callType: 'voice' | 'video';
    callerName: string;
  }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    console.log(`[Chat] 📞 Call from ${senderId} to ${data.targetId} (${data.callType})`);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('incoming-call', {
        callerId: senderId,
        callerName: data.callerName,
        callType: data.callType,
        signal: data.signal
      });
      console.log(`[Chat] ✅ Call signal sent to ${data.targetId}`);
    } else {
      console.log(`[Chat] ⚠️ Cannot reach ${data.targetId} - not online`);
      // Send error back to caller (but don't spam logs)
      socket.emit('call-error', { 
        message: 'Пользователь недоступен',
        targetId: data.targetId 
      });
    }
  });

  // Handle call answer
  socket.on('call-answer', (data: { 
    targetId: string;
    signal: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    console.log(`[Chat] 📞 Call answer from ${senderId} to ${data.targetId}`);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('call-answered', {
        answererId: senderId,
        signal: data.signal
      });
      console.log(`[Chat] ✅ Call answer delivered to ${data.targetId}`);
    }
  });

  // Handle call rejection
  socket.on('call-reject', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    console.log(`[Chat] 📞 Call rejected by ${senderId}`);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('call-rejected', {
        rejecterId: senderId
      });
    }
  });

  // Handle call end
  socket.on('call-end', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    console.log(`[Chat] 📞 Call ended by ${senderId}`);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('call-ended', {
        enderId: senderId
      });
    }
  });

  // Handle ICE candidate
  socket.on('ice-candidate', (data: { 
    targetId: string;
    candidate: any;
  }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('ice-candidate', {
        senderId,
        candidate: data.candidate
      });
    }
  });

  // Handle screen share start
  socket.on('screen-share-start', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('remote-screen-start', {
        userId: senderId
      });
    }
  });

  // Handle screen share stop
  socket.on('screen-share-stop', (data: { targetId: string }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('remote-screen-stop', {
        userId: senderId
      });
    }
  });

  // Handle collaborative canvas draw
  socket.on('canvas-draw', (data: {
    targetId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    color: string;
    size: number;
  }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('remote-canvas-draw', {
        from: data.from,
        to: data.to,
        color: data.color,
        size: data.size
      });
    }
  });

  // Handle collaborative document update
  socket.on('document-update', (data: {
    targetId: string;
    text: string;
  }) => {
    const senderId = socketToUser.get(socket.id);
    const targetSocketId = users.get(data.targetId);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('remote-document', {
        text: data.text
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', (reason) => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      const duration = Math.round((Date.now() - connectionTime) / 1000);
      console.log(`[Chat] ❌ User disconnected: ${userId} (reason: ${reason}, duration: ${duration}s)`);
      users.delete(userId);
      socketToUser.delete(socket.id);
      userLastSeen.delete(userId);
      
      // Broadcast user offline status
      socket.broadcast.emit('user-offline', { 
        userId, 
        timestamp: Date.now() 
      });
      
      logState();
    } else {
      console.log(`[Chat] Unregistered socket disconnected: ${socket.id} (${reason})`);
    }
  });
});

// Periodic cleanup of stale connections
setInterval(() => {
  const now = Date.now();
  userLastSeen.forEach((lastSeen, userId) => {
    if (now - lastSeen > 120000) { // 2 minutes without ping
      console.log(`[Chat] Cleaning up stale user: ${userId}`);
      const socketId = users.get(userId);
      if (socketId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }
      }
      users.delete(userId);
      socketToUser.delete(socketId || '');
      userLastSeen.delete(userId);
    }
  });
}, 60000); // Check every minute

httpServer.listen(PORT, () => {
  console.log(`[Chat] ✅ Real-time server running on port ${PORT}`);
});
