'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseWebRTCOptions {
  userId: string;
  onIncomingCall?: (data: { callerId: string; offer: RTCSessionDescriptionInit; callType: 'voice' | 'video' }) => void;
  onCallAnswered?: (data: { answererId: string; answer: RTCSessionDescriptionInit }) => void;
  onCallRejected?: () => void;
  onCallEnded?: () => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
}

interface WebRTCCall {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerConnection: RTCPeerConnection | null;
  isCalling: boolean;
  isReceiving: boolean;
  error: string | null;
}

// Free STUN servers
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export function useWebRTC(options: UseWebRTCOptions) {
  const { userId, onIncomingCall, onCallAnswered, onCallRejected, onCallEnded } = options;
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  
  const [callState, setCallState] = useState<WebRTCCall>({
    localStream: null,
    remoteStream: null,
    peerConnection: null,
    isCalling: false,
    isReceiving: false,
    error: null,
  });
  
  const [incomingCallData, setIncomingCallData] = useState<{
    callerId: string;
    offer: RTCSessionDescriptionInit;
    callType: 'voice' | 'video';
  } | null>(null);

  // Refs for callbacks
  const onIncomingCallRef = useRef(onIncomingCall);
  const onCallAnsweredRef = useRef(onCallAnswered);
  const onCallRejectedRef = useRef(onCallRejected);
  const onCallEndedRef = useRef(onCallEnded);
  
  useEffect(() => { onIncomingCallRef.current = onIncomingCall; }, [onIncomingCall]);
  useEffect(() => { onCallAnsweredRef.current = onCallAnswered; }, [onCallAnswered]);
  useEffect(() => { onCallRejectedRef.current = onCallRejected; }, [onCallRejected]);
  useEffect(() => { onCallEndedRef.current = onCallEnded; }, [onCallEnded]);

  // End call function - defined first
  const endCall = useCallback(() => {
    // Stop all local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setCallState({
      localStream: null,
      remoteStream: null,
      peerConnection: null,
      isCalling: false,
      isReceiving: false,
      error: null,
    });
    setIncomingCallData(null);
  }, []);

  // Handle call answered
  const handleCallAnswered = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback(async (isVideo: boolean, targetId: string) => {
    try {
      // Get local media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo ? { facingMode: 'user' } : false,
      });
      localStreamRef.current = stream;
      setCallState(prev => ({ ...prev, localStream: stream }));

      // Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionRef.current = pc;
      
      // Store target ID for ICE candidates
      (pc as any).targetId = targetId;

      // Add local tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Handle remote stream
      pc.ontrack = (event) => {
        console.log('[WebRTC] Received remote track');
        const remoteStream = new MediaStream();
        event.streams[0].getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
        remoteStreamRef.current = remoteStream;
        setCallState(prev => ({ ...prev, remoteStream }));
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('ice-candidate', {
            targetId: targetId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          endCall();
        }
      };

      return pc;
    } catch (error) {
      console.error('[WebRTC] Error creating peer connection:', error);
      setCallState(prev => ({ ...prev, error: 'Failed to access media devices' }));
      return null;
    }
  }, [endCall]);

  // Start call
  const startCall = useCallback(async (targetId: string, callType: 'voice' | 'video') => {
    if (!socketRef.current) {
      console.error('[WebRTC] Socket not connected');
      return;
    }

    setCallState(prev => ({ ...prev, isCalling: true, error: null }));

    const pc = await createPeerConnection(callType === 'video', targetId);
    if (!pc) return;

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Send offer through signaling server
    socketRef.current.emit('call-offer', {
      targetId,
      offer,
      callType,
    });

    setCallState(prev => ({ ...prev, peerConnection: pc }));
  }, [createPeerConnection]);

  // Answer call
  const answerCall = useCallback(async () => {
    if (!incomingCallData || !socketRef.current) return;

    const { callerId, offer, callType } = incomingCallData;

    const pc = await createPeerConnection(callType === 'video', callerId);
    if (!pc) return;

    // Set remote description (offer)
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send answer through signaling server
    socketRef.current.emit('call-answer', {
      targetId: callerId,
      answer,
    });

    setCallState(prev => ({
      ...prev,
      peerConnection: pc,
      isReceiving: false,
      incomingCallData: null,
    }));
    setIncomingCallData(null);
  }, [incomingCallData, createPeerConnection]);

  // Reject call
  const rejectCall = useCallback(() => {
    if (!incomingCallData || !socketRef.current) return;

    socketRef.current.emit('call-reject', {
      targetId: incomingCallData.callerId,
    });

    setIncomingCallData(null);
    setCallState(prev => ({ ...prev, isReceiving: false }));
  }, [incomingCallData]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return !audioTrack.enabled; // Returns true if muted
      }
    }
    return false;
  }, []);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return !videoTrack.enabled; // Returns true if video is off
      }
    }
    return false;
  }, []);

  // Initialize socket connection
  useEffect(() => {
    if (!userId) return;

    const socket = io('/?XTransformPort=3004', {
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('[WebRTC] Socket connected');
      socket.emit('register', userId);
    });

    socket.on('registered', () => {
      console.log('[WebRTC] Registered successfully');
    });

    socket.on('incoming-call', (data) => {
      console.log('[WebRTC] Incoming call from', data.callerId);
      setIncomingCallData(data);
      setCallState(prev => ({ ...prev, isReceiving: true }));
      onIncomingCallRef.current?.(data);
    });

    socket.on('call-answered', (data) => {
      console.log('[WebRTC] Call answered by', data.answererId);
      handleCallAnswered(data.answer);
      onCallAnsweredRef.current?.(data);
    });

    socket.on('call-rejected', () => {
      console.log('[WebRTC] Call rejected');
      endCall();
      onCallRejectedRef.current?.();
    });

    socket.on('call-ended', () => {
      console.log('[WebRTC] Call ended by remote');
      endCall();
      onCallEndedRef.current?.();
    });

    socket.on('ice-candidate', (data) => {
      console.log('[WebRTC] Received ICE candidate');
      if (peerConnectionRef.current) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [userId, handleCallAnswered, endCall]);

  return {
    ...callState,
    incomingCallData,
    startCall,
    answerCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
}
