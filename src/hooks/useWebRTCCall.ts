'use client';

import { useRef, useCallback, useState, useEffect } from 'react';

// ICE servers for NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

interface CallOptions {
  workersUrl?: string;
  onIncomingCall?: (data: any) => void;
  onCallAnswered?: (data: any) => void;
  onCallRejected?: () => void;
  onCallEnded?: () => void;
  onError?: (message: string) => void;
}

export function useWebRTCCall(options: CallOptions = {}) {
  const workersUrl = options.workersUrl || process.env.NEXT_PUBLIC_WORKERS_URL || 'https://void-time.mr-starred09.workers.dev';
  
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const targetIdRef = useRef<string | null>(null);
  
  const [isInCall, setIsInCall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  
  // Cleanup function - defined first with refs to avoid hoisting issues
  const cleanupRef = useRef<() => void>(() => {});
  
  const cleanup = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(t => t.stop());
      remoteStreamRef.current = null;
    }
    
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    callIdRef.current = null;
    setIsInCall(false);
    setIsCalling(false);
  }, []);
  
  // Update ref in effect to avoid render-time ref access
  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);
  
  // Create peer connection
  const createPeerConnection = useCallback(async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: video ? {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      } : false,
    });
    
    localStreamRef.current = stream;
    
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      sdpSemantics: 'unified-plan',
    });
    
    pcRef.current = pc;
    
    // Add local tracks
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });
    
    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log('[Call] Received remote track:', event.track.kind);
      
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      
      remoteStreamRef.current.addTrack(event.track);
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          targetId: targetIdRef.current,
          candidate: event.candidate.toJSON(),
        }));
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log('[Call] Connection state:', pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        setIsInCall(true);
        setIsCalling(false);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanupRef.current();
      }
    };
    
    return pc;
  }, []);
  
  // Connect to call signaling WebSocket
  const connectToCall = useCallback((callId: string, userId: string, targetId: string) => {
    return new Promise<WebSocket>((resolve, reject) => {
      const wsUrl = `${workersUrl}/ws/call/${callId}?userId=${userId}`;
      console.log('[Call] Connecting to signaling:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      callIdRef.current = callId;
      userIdRef.current = userId;
      targetIdRef.current = targetId;
      
      ws.onopen = () => {
        console.log('[Call] Signaling connected');
        resolve(ws);
      };
      
      ws.onerror = (error) => {
        console.error('[Call] Signaling error:', error);
        reject(error);
      };
      
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('[Call] Signaling message:', msg.type);
          
          switch (msg.type) {
            case 'incoming-call':
              options.onIncomingCall?.({
                callerId: msg.callerId,
                callType: msg.callType,
                signal: msg.signal,
                callId: msg.callId,
              });
              break;
              
            case 'call-answered':
              if (pcRef.current && msg.signal) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.signal));
                options.onCallAnswered?.({ answererId: msg.answererId });
              }
              break;
              
            case 'call-rejected':
              options.onCallRejected?.();
              cleanupRef.current();
              break;
              
            case 'call-ended':
              options.onCallEnded?.();
              cleanupRef.current();
              break;
              
            case 'ice-candidate':
              if (pcRef.current && msg.candidate) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
              }
              break;
          }
        } catch (e) {
          console.error('[Call] Failed to handle message:', e);
        }
      };
      
      ws.onclose = () => {
        console.log('[Call] Signaling disconnected');
      };
    });
  }, [workersUrl, options]);
  
  // Start call
  const startCall = useCallback(async (
    userId: string,
    targetId: string,
    type: 'voice' | 'video',
    callerName: string
  ) => {
    try {
      setIsCalling(true);
      setCallType(type);
      
      const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
      // Connect to signaling
      await connectToCall(callId, userId, targetId);
      
      // Create peer connection
      const pc = await createPeerConnection(type === 'video');
      
      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
      });
      await pc.setLocalDescription(offer);
      
      // Send offer
      wsRef.current?.send(JSON.stringify({
        type: 'call-start',
        targetId,
        callType: type,
        callId,
        signal: offer,
        callerName,
      }));
      
      return callId;
    } catch (error) {
      console.error('[Call] Failed to start call:', error);
      options.onError?.('Не удалось начать звонок');
      cleanupRef.current();
      return null;
    }
  }, [connectToCall, createPeerConnection, options]);
  
  // Answer call
  const answerCall = useCallback(async (
    callId: string,
    userId: string,
    callerId: string,
    signal: RTCSessionDescriptionInit,
    type: 'voice' | 'video'
  ) => {
    try {
      setIsCalling(true);
      setCallType(type);
      
      // Connect to signaling
      await connectToCall(callId, userId, callerId);
      
      // Create peer connection
      const pc = await createPeerConnection(type === 'video');
      
      // Set remote description (offer)
      await pc.setRemoteDescription(new RTCSessionDescription(signal));
      
      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      // Send answer
      wsRef.current?.send(JSON.stringify({
        type: 'call-answer',
        targetId: callerId,
        signal: answer,
      }));
    } catch (error) {
      console.error('[Call] Failed to answer call:', error);
      options.onError?.('Не удалось ответить на звонок');
      cleanupRef.current();
    }
  }, [connectToCall, createPeerConnection, options]);
  
  // Reject call
  const rejectCall = useCallback((targetId: string) => {
    wsRef.current?.send(JSON.stringify({
      type: 'call-reject',
      targetId,
    }));
    cleanupRef.current();
  }, []);
  
  // End call
  const endCall = useCallback(() => {
    wsRef.current?.send(JSON.stringify({
      type: 'call-end',
      targetId: targetIdRef.current,
    }));
    cleanupRef.current();
  }, []);
  
  // Get streams
  const getLocalStream = useCallback(() => localStreamRef.current, []);
  const getRemoteStream = useCallback(() => remoteStreamRef.current, []);
  
  return {
    isInCall,
    isCalling,
    callType,
    startCall,
    answerCall,
    rejectCall,
    endCall,
    getLocalStream,
    getRemoteStream,
    cleanup,
  };
}
