'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createSignalingClient, SIGNALING_CHANNEL, RTC_CONFIG, SignalingMessage } from '@/lib/webrtc-signaling';
import { SupabaseClient } from '@supabase/supabase-js';

interface UseWebRTCRealtimeOptions {
  userId: string;
  onIncomingCall?: (data: { callerId: string; callerName: string; callType: 'voice' | 'video'; callId: string }) => void;
  onCallAnswered?: () => void;
  onCallRejected?: () => void;
  onCallEnded?: () => void;
  onError?: (error: string) => void;
}

interface CallState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCalling: boolean;
  isReceiving: boolean;
  isConnected: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  error: string | null;
}

export function useWebRTCRealtime(options: UseWebRTCRealtimeOptions) {
  const { userId, onIncomingCall, onCallAnswered, onCallRejected, onCallEnded, onError } = options;
  
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  
  const [callState, setCallState] = useState<CallState>({
    localStream: null,
    remoteStream: null,
    isCalling: false,
    isReceiving: false,
    isConnected: false,
    isMuted: false,
    isVideoOff: false,
    isScreenSharing: false,
    error: null,
  });
  
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [incomingCallData, setIncomingCallData] = useState<{
    callerId: string;
    callerName: string;
    callType: 'voice' | 'video';
    callId: string;
  } | null>(null);

  // Refs for callbacks
  const onIncomingCallRef = useRef(onIncomingCall);
  const onCallAnsweredRef = useRef(onCallAnswered);
  const onCallRejectedRef = useRef(onCallRejected);
  const onCallEndedRef = useRef(onCallEnded);
  const onErrorRef = useRef(onError);
  
  useEffect(() => { onIncomingCallRef.current = onIncomingCall; }, [onIncomingCall]);
  useEffect(() => { onCallAnsweredRef.current = onCallAnswered; }, [onCallAnswered]);
  useEffect(() => { onCallRejectedRef.current = onCallRejected; }, [onCallRejected]);
  useEffect(() => { onCallEndedRef.current = onCallEnded; }, [onCallEnded]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Send signaling message
  const sendSignal = useCallback((message: Omit<SignalingMessage, 'from' | 'timestamp'>) => {
    if (channelRef.current) {
      const fullMessage: SignalingMessage = {
        ...message,
        from: userId,
        timestamp: Date.now(),
      };
      channelRef.current.send({
        type: 'broadcast',
        event: 'signal',
        payload: fullMessage,
      });
    }
  }, [userId]);

  // Clean up call resources
  const endCall = useCallback(() => {
    // Stop all tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    setCallState({
      localStream: null,
      remoteStream: null,
      isCalling: false,
      isReceiving: false,
      isConnected: false,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
      error: null,
    });
    setCurrentCallId(null);
    setTargetUserId(null);
    setIncomingCallData(null);
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback(async (isVideo: boolean) => {
    try {
      // Get local media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: isVideo ? {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        } : false,
      });
      
      localStreamRef.current = stream;
      setCallState(prev => ({ ...prev, localStream: stream }));

      // Create peer connection
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Handle remote tracks
      pc.ontrack = (event) => {
        console.log('[WebRTC] Received remote track:', event.track.kind);
        const remoteStream = new MediaStream();
        event.streams[0]?.getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
        remoteStreamRef.current = remoteStream;
        setCallState(prev => ({ ...prev, remoteStream }));
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && targetUserId) {
          sendSignal({
            type: 'ice-candidate',
            to: targetUserId,
            payload: event.candidate.toJSON(),
          });
        }
      };

      // Connection state changes
      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          setCallState(prev => ({ ...prev, isConnected: true }));
          onCallAnsweredRef.current?.();
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          onErrorRef.current?.('Connection failed');
          endCall();
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          onErrorRef.current?.('ICE connection failed');
        }
      };

      return pc;
    } catch (error) {
      console.error('[WebRTC] Error creating peer connection:', error);
      onErrorRef.current?.('Failed to access media devices');
      return null;
    }
  }, [targetUserId, sendSignal, endCall]);

  // Start outgoing call
  const startCall = useCallback(async (targetId: string, callType: 'voice' | 'video', callerName: string) => {
    console.log('[WebRTC] Starting call to:', targetId, callType);
    
    setTargetUserId(targetId);
    const callId = `call-${Date.now()}`;
    setCurrentCallId(callId);
    setCallState(prev => ({ ...prev, isCalling: true, error: null }));

    const pc = await createPeerConnection(callType === 'video');
    if (!pc) return;

    // Create offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'video',
    });
    await pc.setLocalDescription(offer);

    // Send call request
    sendSignal({
      type: 'call-request',
      to: targetId,
      payload: {
        callId,
        callType,
        callerName,
        offer: offer.sdp,
      },
    });
  }, [createPeerConnection, sendSignal]);

  // Answer incoming call
  const answerCall = useCallback(async () => {
    if (!incomingCallData) return;

    const { callerId, callType, callId } = incomingCallData;
    console.log('[WebRTC] Answering call from:', callerId);
    
    setTargetUserId(callerId);
    setCurrentCallId(callId);
    setIncomingCallData(null);

    // Send accept signal first
    sendSignal({
      type: 'call-accept',
      to: callerId,
      payload: { callId },
    });
  }, [incomingCallData, sendSignal]);

  // Handle received offer and create answer
  const handleOffer = useCallback(async (callerId: string, callType: 'voice' | 'video', offerSdp: string) => {
    const pc = await createPeerConnection(callType);
    if (!pc) return;

    // Set remote description (offer)
    await pc.setRemoteDescription({
      type: 'offer',
      sdp: offerSdp,
    });

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send answer
    sendSignal({
      type: 'answer',
      to: callerId,
      payload: {
        sdp: answer.sdp,
      },
    });
  }, [createPeerConnection, sendSignal]);

  // Reject incoming call
  const rejectCall = useCallback(() => {
    if (!incomingCallData) return;
    
    sendSignal({
      type: 'call-reject',
      to: incomingCallData.callerId,
      payload: {},
    });
    
    setIncomingCallData(null);
    onCallRejectedRef.current?.();
  }, [incomingCallData, sendSignal]);

  // End active call
  const endActiveCall = useCallback(() => {
    if (targetUserId) {
      sendSignal({
        type: 'call-end',
        to: targetUserId,
        payload: {},
      });
    }
    endCall();
    onCallEndedRef.current?.();
  }, [targetUserId, sendSignal, endCall]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setCallState(prev => ({ ...prev, isMuted: !audioTrack.enabled }));
        return !audioTrack.enabled;
      }
    }
    return false;
  }, []);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setCallState(prev => ({ ...prev, isVideoOff: !videoTrack.enabled }));
        return !videoTrack.enabled;
      }
    }
    return false;
  }, []);

  // Stop screen sharing (defined before startScreenShare to avoid reference issues)
  const stopScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    
    // Restore camera track
    if (peerConnectionRef.current && localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track?.kind === 'video');
      
      if (videoSender && videoTrack) {
        await videoSender.replaceTrack(videoTrack);
      }
    }
    
    setCallState(prev => ({ ...prev, isScreenSharing: false }));
    
    if (targetUserId) {
      sendSignal({
        type: 'screen-stop',
        to: targetUserId,
        payload: {},
      });
    }
  }, [targetUserId, sendSignal]);

  // Start screen sharing
  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true,
      });
      
      screenStreamRef.current = screenStream;
      
      // Replace video track
      if (peerConnectionRef.current) {
        const videoTrack = screenStream.getVideoTracks()[0];
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        
        if (videoSender && videoTrack) {
          await videoSender.replaceTrack(videoTrack);
        }
        
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
      
      setCallState(prev => ({ ...prev, isScreenSharing: true }));
      
      if (targetUserId) {
        sendSignal({
          type: 'screen-start',
          to: targetUserId,
          payload: {},
        });
      }
    } catch (error) {
      console.error('[WebRTC] Screen share error:', error);
    }
  }, [targetUserId, sendSignal, stopScreenShare]);

  // Initialize Supabase Realtime
  useEffect(() => {
    if (!userId) return;

    const supabase = createSignalingClient();
    supabaseRef.current = supabase;

    // Subscribe to signaling channel
    const channel = supabase.channel(SIGNALING_CHANNEL, {
      config: {
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalingMessage }) => {
        // Only process messages meant for us
        if (payload.to !== userId) return;

        console.log('[WebRTC] Received signal:', payload.type, 'from:', payload.from);

        switch (payload.type) {
          case 'call-request':
            // Incoming call
            setIncomingCallData({
              callerId: payload.from,
              callerName: payload.payload.callerName,
              callType: payload.payload.callType,
              callId: payload.payload.callId,
            });
            setCallState(prev => ({ ...prev, isReceiving: true }));
            onIncomingCallRef.current?.({
              callerId: payload.from,
              callerName: payload.payload.callerName,
              callType: payload.payload.callType,
              callId: payload.payload.callId,
            });
            break;

          case 'call-accept':
            // Our call was accepted, now handle the offer
            if (payload.payload.callId === currentCallId && peerConnectionRef.current) {
              // We need to receive the answer
            }
            break;

          case 'answer':
            // Received answer to our offer
            if (peerConnectionRef.current && payload.payload.sdp) {
              peerConnectionRef.current.setRemoteDescription({
                type: 'answer',
                sdp: payload.payload.sdp,
              });
            }
            break;

          case 'offer':
            // This shouldn't happen in normal flow, but handle it
            if (payload.payload.offer) {
              handleOffer(payload.from, payload.payload.callType, payload.payload.offer);
            }
            break;

          case 'ice-candidate':
            // ICE candidate
            if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
              peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.payload));
            }
            break;

          case 'call-reject':
            // Our call was rejected
            onErrorRef.current?.('Call rejected');
            endCall();
            onCallRejectedRef.current?.();
            break;

          case 'call-end':
            // Remote ended the call
            endCall();
            onCallEndedRef.current?.();
            break;

          case 'screen-start':
            // Remote started screen sharing
            break;

          case 'screen-stop':
            // Remote stopped screen sharing
            break;
        }
      })
      .subscribe((status) => {
        console.log('[WebRTC] Channel status:', status);
      });

    // Announce online status
    channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: 'user-online',
        from: userId,
        to: '',
        timestamp: Date.now(),
        payload: {},
      },
    });

    return () => {
      // Announce offline status
      channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'user-offline',
          from: userId,
          to: '',
          timestamp: Date.now(),
          payload: {},
        },
      });
      
      channel.unsubscribe();
      supabase.removeChannel(channel);
      endCall();
    };
  }, [userId, currentCallId, handleOffer, endCall]);

  // Handle answer call with offer processing
  const answerCallWithOffer = useCallback(async (offerSdp: string, callType: 'voice' | 'video') => {
    if (!incomingCallData) return;

    const { callerId, callId } = incomingCallData;
    
    setTargetUserId(callerId);
    setCurrentCallId(callId);
    setIncomingCallData(null);

    const pc = await createPeerConnection(callType);
    if (!pc) return;

    // Set remote description (offer)
    await pc.setRemoteDescription({
      type: 'offer',
      sdp: offerSdp,
    });

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Send accept with answer
    sendSignal({
      type: 'call-accept',
      to: callerId,
      payload: {
        callId,
        answer: answer.sdp,
      },
    });
  }, [incomingCallData, createPeerConnection, sendSignal]);

  return {
    ...callState,
    incomingCallData,
    currentCallId,
    startCall,
    answerCall,
    answerCallWithOffer,
    rejectCall,
    endCall: endActiveCall,
    toggleMute,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    toggleScreenShare: () => callState.isScreenSharing ? stopScreenShare() : startScreenShare(),
  };
}
