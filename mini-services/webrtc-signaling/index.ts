import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = 3004;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Store user socket mappings
const users = new Map<string, string>(); // userId -> socketId
const socketToUser = new Map<string, string>(); // socketId -> userId

io.on('connection', (socket) => {
  console.log(`[WebRTC] Client connected: ${socket.id}`);

  // User registers their ID for signaling
  socket.on('register', (userId: string) => {
    console.log(`[WebRTC] User registered: ${userId} -> ${socket.id}`);
    users.set(userId, socket.id);
    socketToUser.set(socket.id, userId);
    socket.emit('registered', { success: true });
  });

  // Handle call offer
  socket.on('call-offer', (data: { targetId: string; offer: RTCSessionDescriptionInit; callType: 'voice' | 'video' }) => {
    const targetSocketId = users.get(data.targetId);
    const callerId = socketToUser.get(socket.id);
    
    if (targetSocketId && callerId) {
      console.log(`[WebRTC] Call offer from ${callerId} to ${data.targetId}`);
      io.to(targetSocketId).emit('incoming-call', {
        callerId,
        offer: data.offer,
        callType: data.callType
      });
    } else {
      socket.emit('call-error', { message: 'User not found or offline' });
    }
  });

  // Handle call answer
  socket.on('call-answer', (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
    const targetSocketId = users.get(data.targetId);
    const answererId = socketToUser.get(socket.id);
    
    if (targetSocketId && answererId) {
      console.log(`[WebRTC] Call answer from ${answererId} to ${data.targetId}`);
      io.to(targetSocketId).emit('call-answered', {
        answererId,
        answer: data.answer
      });
    }
  });

  // Handle ICE candidate
  socket.on('ice-candidate', (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
    const targetSocketId = users.get(data.targetId);
    const senderId = socketToUser.get(socket.id);
    
    if (targetSocketId && senderId) {
      io.to(targetSocketId).emit('ice-candidate', {
        senderId,
        candidate: data.candidate
      });
    }
  });

  // Handle call rejection
  socket.on('call-reject', (data: { targetId: string }) => {
    const targetSocketId = users.get(data.targetId);
    const rejecterId = socketToUser.get(socket.id);
    
    if (targetSocketId && rejecterId) {
      console.log(`[WebRTC] Call rejected by ${rejecterId}`);
      io.to(targetSocketId).emit('call-rejected', { rejecterId });
    }
  });

  // Handle call end
  socket.on('call-end', (data: { targetId: string }) => {
    const targetSocketId = users.get(data.targetId);
    const enderId = socketToUser.get(socket.id);
    
    if (targetSocketId && enderId) {
      console.log(`[WebRTC] Call ended by ${enderId}`);
      io.to(targetSocketId).emit('call-ended', { enderId });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      console.log(`[WebRTC] User disconnected: ${userId}`);
      users.delete(userId);
      socketToUser.delete(socket.id);
      
      // Notify any active callers that user went offline
      socket.broadcast.emit('user-offline', { userId });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[WebRTC] Signaling server running on port ${PORT}`);
});
