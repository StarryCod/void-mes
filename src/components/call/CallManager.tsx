'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Video, PhoneOff, Mic, MicOff, VideoOff, Volume2, VolumeX, Monitor, MonitorOff, Palette, FileText, Download, X, Users, Wifi, WifiOff } from 'lucide-react';
import { soundManager } from '@/lib/sounds';

interface CallManagerProps {
  userId: string;
  contacts: any[];
  onCallStart?: () => void;
  onCallEnd?: () => void;
}

interface IncomingCall {
  callerId: string;
  callerName: string;
  signal: RTCSessionDescriptionInit;
  callType: 'voice' | 'video';
}

// STUN servers for NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

export function CallManager({ userId, contacts, onCallStart, onCallEnd }: CallManagerProps) {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const hasRemoteTrackRef = useRef(false);

  const [callState, setCallState] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [targetUser, setTargetUser] = useState<{ id: string; name: string } | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showCollab, setShowCollab] = useState<'none' | 'canvas' | 'document'>('none');
  const [isCallInitiator, setIsCallInitiator] = useState(false);
  const [iceState, setIceState] = useState<string>('new');
  const [connectionState, setConnectionState] = useState<string>('new');

  // Refs for callbacks
  const onCallStartRef = useRef(onCallStart);
  const onCallEndRef = useRef(onCallEnd);
  useEffect(() => { onCallStartRef.current = onCallStart; }, [onCallStart]);
  useEffect(() => { onCallEndRef.current = onCallEnd; }, [onCallEnd]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // Timer functions
  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    console.log('[Call] ⏱️ Timer started');
  }, []);

  const stopCallTimer = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  }, []);

  // Clear connection timeout
  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  // Force connected state (fallback)
  const forceConnected = useCallback(() => {
    if (callState === 'calling' && hasRemoteTrackRef.current) {
      console.log('[Call] ⚡ Force connecting - we have remote tracks');
      setCallState('connected');
      startCallTimer();
      onCallStartRef.current?.();
    }
  }, [callState, startCallTimer]);

  // End call function
  const endCall = useCallback(() => {
    console.log('[Call] 🔴 Ending call');
    stopCallTimer();
    clearConnectionTimeout();

    // Stop ring sound
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(t => t.stop());
      remoteStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Dispatch event for socket
    if (targetUser) {
      window.dispatchEvent(new CustomEvent('void-end-call', { 
        detail: { targetId: targetUser.id }
      }));
    }

    setCallState('idle');
    setTargetUser(null);
    setIncomingCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsSpeakerOff(false);
    setIsScreenSharing(false);
    setIsRemoteScreenSharing(false);
    setShowCollab('none');
    setError(null);
    setIsCallInitiator(false);
    pendingCandidatesRef.current = [];
    hasRemoteTrackRef.current = false;
    setIceState('new');
    setConnectionState('new');
    onCallEndRef.current?.();
  }, [targetUser, stopCallTimer, clearConnectionTimeout]);

  // Stop screen sharing
  const stopScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    
    if (peerConnectionRef.current && localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track?.kind === 'video');
      
      if (videoSender && videoTrack) {
        await videoSender.replaceTrack(videoTrack);
      }
    }
    
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    
    setIsScreenSharing(false);
    
    window.dispatchEvent(new CustomEvent('void-screen-share-stop', {
      detail: { targetId: targetUser?.id }
    }));
  }, [targetUser]);

  // Start screen sharing
  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true,
      });
      
      screenStreamRef.current = screenStream;
      
      if (peerConnectionRef.current && localStreamRef.current) {
        const videoTrack = screenStream.getVideoTracks()[0];
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        
        if (videoSender) {
          await videoSender.replaceTrack(videoTrack);
        }
        
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
      }
      
      setIsScreenSharing(true);
      
      window.dispatchEvent(new CustomEvent('void-screen-share-start', {
        detail: { targetId: targetUser?.id }
      }));
    } catch (error) {
      console.error('[Call] Screen share error:', error);
      setError('Не удалось запустить демонстрацию экрана');
    }
  }, [targetUser, stopScreenShare]);

  // Play remote audio
  const playRemoteAudio = useCallback((stream: MediaStream) => {
    console.log('[Call] 🔊 Setting up remote audio');
    
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = stream;
    
    audio.play().then(() => {
      console.log('[Call] ✅ Remote audio playing');
    }).catch(err => {
      console.error('[Call] ❌ Audio play error:', err);
    });
    
    // Store reference for speaker toggle
    const audioRef = audio;
    Object.defineProperty(window, '__voidRemoteAudio', { value: audioRef, writable: true });
  }, []);

  // Mark as connected
  const markConnected = useCallback(() => {
    if (callState !== 'connected') {
      console.log('[Call] ✅ Marking as connected');
      clearConnectionTimeout();
      setCallState('connected');
      startCallTimer();
      onCallStartRef.current?.();
    }
  }, [callState, startCallTimer, clearConnectionTimeout]);

  // Create peer connection
  const createPeerConnection = useCallback(async (video: boolean, targetId: string, isInitiator: boolean) => {
    try {
      console.log('[Call] 🎥 Getting media devices, video:', video);
      
      await soundManager.init();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: video ? { 
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
      });

      localStreamRef.current = stream;
      console.log('[Call] Got local stream, tracks:', stream.getTracks().map(t => t.kind));

      if (video && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(() => {});
      }

      const pc = new RTCPeerConnection({ 
        iceServers: ICE_SERVERS,
        sdpSemantics: 'unified-plan',
        iceCandidatePoolSize: 10,
      });
      peerConnectionRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => {
        console.log('[Call] Adding local track:', track.kind);
        pc.addTrack(track, stream);
      });

      // Handle remote tracks
      pc.ontrack = (event) => {
        console.log('[Call] 📹 Received remote track:', event.track.kind);
        hasRemoteTrackRef.current = true;
        
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        
        remoteStreamRef.current.addTrack(event.track);
        
        // For video calls
        if (video && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
          remoteVideoRef.current.play().catch(() => {});
        }
        
        // For voice calls
        if (!video || event.track.kind === 'audio') {
          playRemoteAudio(remoteStreamRef.current);
        }
        
        // Force connected if we have tracks but still in calling state
        if (callState === 'calling') {
          setTimeout(() => forceConnected(), 500);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[Call] 🧊 ICE candidate:', event.candidate.type);
          window.dispatchEvent(new CustomEvent('void-send-ice', { 
            detail: { 
              targetId, 
              candidate: event.candidate.toJSON() 
            }
          }));
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log('[Call] 🧊 ICE state:', state);
        setIceState(state);
        
        if (state === 'connected' || state === 'completed') {
          markConnected();
        } else if (state === 'failed') {
          console.log('[Call] ICE failed, restarting...');
          pc.restartIce();
        } else if (state === 'disconnected') {
          // Wait for reconnection
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected') {
              console.log('[Call] ICE still disconnected, ending call');
              endCall();
            }
          }, 5000);
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('[Call] 🔗 Connection state:', state);
        setConnectionState(state);
        
        if (state === 'connected') {
          markConnected();
        } else if (state === 'failed') {
          setError('Не удалось установить соединение');
          setTimeout(endCall, 2000);
        } else if (state === 'disconnected') {
          setTimeout(() => {
            if (pc.connectionState === 'disconnected') {
              endCall();
            }
          }, 3000);
        }
      };

      // Set up connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (callState === 'calling' && hasRemoteTrackRef.current) {
          console.log('[Call] ⏱️ Connection timeout, forcing connected');
          forceConnected();
        }
      }, 10000);

      return pc;
    } catch (error) {
      console.error('[Call] Error creating peer connection:', error);
      setError('Не удалось получить доступ к камере/микрофону');
      return null;
    }
  }, [callState, endCall, forceConnected, markConnected, playRemoteAudio]);

  // Start call
  const startCall = useCallback(async (targetId: string, targetName: string, type: 'voice' | 'video') => {
    console.log('[Call] 📞 Starting call to:', targetId, type);
    
    setTargetUser({ id: targetId, name: targetName });
    setCallType(type);
    setCallState('calling');
    setError(null);
    setIsCallInitiator(true);

    const pc = await createPeerConnection(type === 'video', targetId, true);
    if (!pc) return;

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: type === 'video',
    });
    await pc.setLocalDescription(offer);

    console.log('[Call] Sending offer');
    window.dispatchEvent(new CustomEvent('void-start-call', { 
      detail: { 
        targetId, 
        signal: offer, 
        callType: type,
        callerName: 'User'
      }
    }));
  }, [createPeerConnection]);

  // Answer call
  const answerCall = useCallback(async () => {
    if (!incomingCall) return;

    // Stop ring sound
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    soundManager.playCallConnected();

    const { callerId, callerName, signal, callType } = incomingCall;
    console.log('[Call] 📞 Answering call from:', callerId, callType);
    
    setTargetUser({ id: callerId, name: callerName });
    setCallType(callType);
    setIncomingCall(null);
    setCallState('calling');
    setIsCallInitiator(false);

    const pc = await createPeerConnection(callType === 'video', callerId, false);
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(signal));
    
    // Process pending ICE candidates
    for (const candidate of pendingCandidatesRef.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('[Call] Error adding pending candidate:', e);
      }
    }
    pendingCandidatesRef.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    console.log('[Call] Sending answer');
    window.dispatchEvent(new CustomEvent('void-answer-call', { 
      detail: { 
        targetId: callerId, 
        signal: answer 
      }
    }));
  }, [incomingCall, createPeerConnection]);

  // Reject call
  const rejectCall = useCallback(() => {
    if (!incomingCall) return;
    
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    
    window.dispatchEvent(new CustomEvent('void-reject-call', { 
      detail: { targetId: incomingCall.callerId }
    }));
    
    setIncomingCall(null);
    setCallState('idle');
  }, [incomingCall]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      }
    }
  }, [isMuted]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsVideoOff(!track.enabled);
      }
    }
  }, [isVideoOff]);

  // Toggle speaker
  const toggleSpeaker = useCallback(() => {
    const audio = (window as any).__voidRemoteAudio;
    if (audio) {
      audio.muted = !isSpeakerOff;
      setIsSpeakerOff(!isSpeakerOff);
    }
  }, [isSpeakerOff]);

  // Toggle screen share
  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  // Listen for socket events
  useEffect(() => {
    const handleIncomingCall = async (e: CustomEvent) => {
      console.log('[Call] 📞 Incoming call event:', e.detail);
      const data = e.detail;
      const caller = contacts.find(c => c.id === data.callerId);
      
      await soundManager.init();
      
      setIncomingCall({
        callerId: data.callerId,
        callerName: data.callerName || caller?.displayName || caller?.username || 'Unknown',
        signal: data.signal,
        callType: data.callType,
      });
      setCallState('ringing');
      
      if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = soundManager.playCallRing();
    };

    const handleCallAnswered = async (e: CustomEvent) => {
      console.log('[Call] 📞 Call answered event:', e.detail);
      
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      soundManager.playCallConnected();
      
      if (peerConnectionRef.current && e.detail.signal) {
        console.log('[Call] Setting remote description (answer)');
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(e.detail.signal));
        console.log('[Call] Remote description set');
        
        // Process pending ICE candidates
        for (const candidate of pendingCandidatesRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('[Call] Error adding pending candidate:', e);
          }
        }
        pendingCandidatesRef.current = [];
      }
    };

    const handleCallRejected = () => {
      console.log('[Call] 📞 Call rejected');
      
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      setError('Звонок отклонён');
      setTimeout(endCall, 2000);
    };

    const handleCallEnded = () => {
      console.log('[Call] 📞 Remote ended call');
      
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      soundManager.playCallEnded();
      endCall();
    };

    const handleIceCandidate = async (e: CustomEvent) => {
      if (peerConnectionRef.current) {
        if (peerConnectionRef.current.remoteDescription) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(e.detail.candidate));
            console.log('[Call] ICE candidate added');
          } catch (err) {
            console.error('[Call] ICE candidate error:', err);
          }
        } else {
          console.log('[Call] Storing ICE candidate for later');
          pendingCandidatesRef.current.push(e.detail.candidate);
        }
      }
    };

    const handleCallError = (e: CustomEvent) => {
      if (e.detail.message === 'Пользователь недоступен') {
        console.log('[Call] Target user not available');
        return;
      }
      
      console.error('[Call] Error:', e.detail.message);
      setError(e.detail.message);
      setTimeout(() => setError(null), 3000);
    };

    const handleRemoteScreenShareStart = () => {
      setIsRemoteScreenSharing(true);
    };

    const handleRemoteScreenShareStop = () => {
      setIsRemoteScreenSharing(false);
    };

    window.addEventListener('void-incoming-call', handleIncomingCall as EventListener);
    window.addEventListener('void-call-answered', handleCallAnswered as EventListener);
    window.addEventListener('void-call-rejected', handleCallRejected as EventListener);
    window.addEventListener('void-call-ended', handleCallEnded as EventListener);
    window.addEventListener('void-ice-candidate', handleIceCandidate as EventListener);
    window.addEventListener('void-call-error', handleCallError as EventListener);
    window.addEventListener('void-remote-screen-start', handleRemoteScreenShareStart as EventListener);
    window.addEventListener('void-remote-screen-stop', handleRemoteScreenShareStop as EventListener);

    return () => {
      window.removeEventListener('void-incoming-call', handleIncomingCall as EventListener);
      window.removeEventListener('void-call-answered', handleCallAnswered as EventListener);
      window.removeEventListener('void-call-rejected', handleCallRejected as EventListener);
      window.removeEventListener('void-call-ended', handleCallEnded as EventListener);
      window.removeEventListener('void-ice-candidate', handleIceCandidate as EventListener);
      window.removeEventListener('void-call-error', handleCallError as EventListener);
      window.removeEventListener('void-remote-screen-start', handleRemoteScreenShareStart as EventListener);
      window.removeEventListener('void-remote-screen-stop', handleRemoteScreenShareStop as EventListener);
    };
  }, [contacts, endCall]);

  // Socket bridge
  useEffect(() => {
    const handleStartCall = (e: CustomEvent) => {
      const { targetId, signal, callType, callerName } = e.detail;
      window.dispatchEvent(new CustomEvent('void-socket-call', { 
        detail: { targetId, signal, callType, callerName }
      }));
    };

    const handleAnswerCall = (e: CustomEvent) => {
      const { targetId, signal } = e.detail;
      window.dispatchEvent(new CustomEvent('void-socket-answer', { 
        detail: { targetId, signal }
      }));
    };

    const handleRejectCall = (e: CustomEvent) => {
      const { targetId } = e.detail;
      window.dispatchEvent(new CustomEvent('void-socket-reject', { 
        detail: { targetId }
      }));
    };

    const handleEndCall = (e: CustomEvent) => {
      const { targetId } = e.detail;
      window.dispatchEvent(new CustomEvent('void-socket-end', { 
        detail: { targetId }
      }));
    };

    const handleSendIce = (e: CustomEvent) => {
      const { targetId, candidate } = e.detail;
      window.dispatchEvent(new CustomEvent('void-socket-ice', { 
        detail: { targetId, candidate }
      }));
    };

    const handleScreenShareStart = (e: CustomEvent) => {
      window.dispatchEvent(new CustomEvent('void-socket-screen-start', {
        detail: { targetId: e.detail.targetId }
      }));
    };

    const handleScreenShareStop = (e: CustomEvent) => {
      window.dispatchEvent(new CustomEvent('void-socket-screen-stop', {
        detail: { targetId: e.detail.targetId }
      }));
    };

    window.addEventListener('void-start-call', handleStartCall as EventListener);
    window.addEventListener('void-answer-call', handleAnswerCall as EventListener);
    window.addEventListener('void-reject-call', handleRejectCall as EventListener);
    window.addEventListener('void-end-call', handleEndCall as EventListener);
    window.addEventListener('void-send-ice', handleSendIce as EventListener);
    window.addEventListener('void-screen-share-start', handleScreenShareStart as EventListener);
    window.addEventListener('void-screen-share-stop', handleScreenShareStop as EventListener);

    return () => {
      window.removeEventListener('void-start-call', handleStartCall as EventListener);
      window.removeEventListener('void-answer-call', handleAnswerCall as EventListener);
      window.removeEventListener('void-reject-call', handleRejectCall as EventListener);
      window.removeEventListener('void-end-call', handleEndCall as EventListener);
      window.removeEventListener('void-send-ice', handleSendIce as EventListener);
      window.removeEventListener('void-screen-share-start', handleScreenShareStart as EventListener);
      window.removeEventListener('void-screen-share-stop', handleScreenShareStop as EventListener);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (remoteStreamRef.current) remoteStreamRef.current.getTracks().forEach(t => t.stop());
      if (peerConnectionRef.current) peerConnectionRef.current.close();
    };
  }, []);

  // Expose startCall globally
  useEffect(() => {
    (window as any).startWebRTCCall = startCall;
    return () => { delete (window as any).startWebRTCCall; };
  }, [startCall]);

  // Connection status indicator
  const getConnectionStatus = () => {
    if (callState === 'connected') return { icon: Wifi, color: 'text-green-500', text: 'Подключено' };
    if (callState === 'calling') {
      if (iceState === 'checking') return { icon: Wifi, color: 'text-yellow-500', text: 'Соединение...' };
      if (iceState === 'failed') return { icon: WifiOff, color: 'text-red-500', text: 'Ошибка' };
      return { icon: Wifi, color: 'text-yellow-500', text: 'Подключение...' };
    }
    return { icon: WifiOff, color: 'text-gray-500', text: '' };
  };

  const status = getConnectionStatus();
  const StatusIcon = status.icon;

  return (
    <AnimatePresence>
      {/* Incoming call */}
      {incomingCall && (
        <motion.div 
          key="incoming-call"
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-[#1a1a24] rounded-3xl p-8 text-center max-w-sm border border-purple-500/20 shadow-2xl shadow-purple-500/10">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4 text-white text-3xl font-bold shadow-lg shadow-purple-500/30 animate-pulse">
              {incomingCall.callerName[0]}
            </div>
            <h2 className="text-white text-xl font-semibold mb-2">{incomingCall.callerName}</h2>
            <p className="text-gray-400 mb-6">{incomingCall.callType === 'video' ? '📹 Видеозвонок' : '📞 Голосовой звонок'}</p>
            <div className="flex justify-center gap-6">
              <button 
                onClick={rejectCall} 
                className="w-16 h-16 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-500/30"
              >
                <PhoneOff className="w-7 h-7 mx-auto" />
              </button>
              <button 
                onClick={answerCall} 
                className="w-16 h-16 rounded-full bg-green-500 text-white hover:bg-green-600 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-green-500/30"
              >
                <Phone className="w-7 h-7 mx-auto" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Active call */}
      {callState !== 'idle' && !incomingCall && (
        <motion.div key="active-call" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-[#0f0f14] flex flex-col">
          {/* Video container */}
          {callType === 'video' && callState === 'connected' && (
            <>
              {/* Main video (remote or screen share) */}
              <div className="flex-1 relative">
                <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline 
                  className={`w-full h-full object-contain ${isRemoteScreenSharing ? 'bg-black' : ''}`}
                />
                {isRemoteScreenSharing && (
                  <div className="absolute top-4 left-4 bg-purple-500/80 text-white px-3 py-1 rounded-full text-sm">
                    🖥️ Демонстрация экрана
                  </div>
                )}
              </div>
              
              {/* Local video (small) */}
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute bottom-28 right-4 w-32 h-44 rounded-2xl object-cover border-2 border-purple-500/30 shadow-lg"
              />
              
              {/* Screen share indicator */}
              {isScreenSharing && (
                <div className="absolute top-4 right-4 bg-green-500/80 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  <Monitor className="w-4 h-4" />
                  Демонстрация экрана
                </div>
              )}
            </>
          )}
          
          {/* Voice call UI */}
          {(callType === 'voice' || callState !== 'connected') && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-6 text-white text-4xl font-bold shadow-lg shadow-purple-500/30">
                  {targetUser?.name?.[0] || '?'}
                </div>
                <h2 className="text-white text-2xl font-semibold">{targetUser?.name}</h2>
                <p className="text-gray-400 mt-1">
                  {callState === 'calling' ? (
                    <span className="flex items-center justify-center gap-2">
                      <StatusIcon className={`w-4 h-4 ${status.color}`} />
                      {status.text}
                    </span>
                  ) : (
                    formatDuration(callDuration)
                  )}
                </p>
                {callType === 'voice' && callState === 'connected' && (
                  <div className="flex justify-center gap-1 mt-4">
                    {[...Array(12)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-purple-500 rounded-full animate-pulse"
                        style={{ 
                          height: `${8 + Math.sin(i * 0.5) * 12}px`,
                          animationDelay: `${i * 0.1}s`,
                          animationDuration: '0.8s'
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Collaborative panel */}
          {showCollab !== 'none' && callState === 'connected' && (
            <CollaborativePanel 
              type={showCollab} 
              onClose={() => setShowCollab('none')}
              targetUser={targetUser}
            />
          )}
          
          {/* Controls */}
          <div className="h-24 bg-[#1a1a24] flex items-center justify-center gap-3 border-t border-white/5 px-4">
            {callType === 'video' && callState === 'connected' && (
              <>
                <button 
                  onClick={toggleVideo} 
                  className={`w-12 h-12 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-[#242430]'} text-white transition-all hover:scale-105 active:scale-95`}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5 mx-auto" /> : <Video className="w-5 h-5 mx-auto" />}
                </button>
                <button 
                  onClick={toggleScreenShare} 
                  className={`w-12 h-12 rounded-full ${isScreenSharing ? 'bg-green-500' : 'bg-[#242430]'} text-white transition-all hover:scale-105 active:scale-95`}
                >
                  {isScreenSharing ? <MonitorOff className="w-5 h-5 mx-auto" /> : <Monitor className="w-5 h-5 mx-auto" />}
                </button>
              </>
            )}
            <button 
              onClick={toggleMute} 
              className={`w-12 h-12 rounded-full ${isMuted ? 'bg-red-500' : 'bg-[#242430]'} text-white transition-all hover:scale-105 active:scale-95`}
            >
              {isMuted ? <MicOff className="w-5 h-5 mx-auto" /> : <Mic className="w-5 h-5 mx-auto" />}
            </button>
            <button 
              onClick={endCall} 
              className="w-14 h-14 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-500/30"
            >
              <PhoneOff className="w-6 h-6 mx-auto" />
            </button>
            {callType === 'voice' && callState === 'connected' && (
              <button 
                onClick={toggleSpeaker} 
                className={`w-12 h-12 rounded-full ${isSpeakerOff ? 'bg-red-500' : 'bg-[#242430]'} text-white transition-all hover:scale-105 active:scale-95`}
              >
                {isSpeakerOff ? <VolumeX className="w-5 h-5 mx-auto" /> : <Volume2 className="w-5 h-5 mx-auto" />}
              </button>
            )}
            {callState === 'connected' && (
              <>
                <div className="w-px h-8 bg-white/10 mx-1" />
                <button 
                  onClick={() => setShowCollab(showCollab === 'canvas' ? 'none' : 'canvas')} 
                  className={`w-12 h-12 rounded-full ${showCollab === 'canvas' ? 'bg-purple-500' : 'bg-[#242430]'} text-white transition-all hover:scale-105 active:scale-95`}
                  title="Совместный холст"
                >
                  <Palette className="w-5 h-5 mx-auto" />
                </button>
                <button 
                  onClick={() => setShowCollab(showCollab === 'document' ? 'none' : 'document')} 
                  className={`w-12 h-12 rounded-full ${showCollab === 'document' ? 'bg-purple-500' : 'bg-[#242430]'} text-white transition-all hover:scale-105 active:scale-95`}
                  title="Совместный документ"
                >
                  <FileText className="w-5 h-5 mx-auto" />
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}

      {error && (
        <motion.div 
          key="call-error"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg z-[101] shadow-lg"
        >
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Collaborative Panel Component
function CollaborativePanel({ 
  type, 
  onClose, 
  targetUser 
}: { 
  type: 'canvas' | 'document'; 
  onClose: () => void;
  targetUser: { id: string; name: string } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#a855f7');
  const [brushSize, setBrushSize] = useState(4);
  const [documentText, setDocumentText] = useState('');
  const lastPosRef = useRef({ x: 0, y: 0 });

  // Canvas drawing
  useEffect(() => {
    if (type !== 'canvas' || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [type]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    lastPosRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    lastPosRef.current = { x, y };
    
    window.dispatchEvent(new CustomEvent('void-canvas-draw', {
      detail: {
        targetId: targetUser?.id,
        from: lastPosRef.current,
        to: { x, y },
        color,
        size: brushSize
      }
    }));
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `void-canvas-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  const downloadDocument = () => {
    const blob = new Blob([documentText], { type: 'text/plain' });
    const link = document.createElement('a');
    link.download = `void-doc-${Date.now()}.txt`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };

  // Listen for remote canvas updates
  useEffect(() => {
    const handleRemoteDraw = (e: CustomEvent) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      
      const { from, to, color: remoteColor, size } = e.detail;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = remoteColor;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    const handleRemoteDocument = (e: CustomEvent) => {
      setDocumentText(e.detail.text);
    };

    window.addEventListener('void-remote-canvas-draw', handleRemoteDraw as EventListener);
    window.addEventListener('void-remote-document', handleRemoteDocument as EventListener);

    return () => {
      window.removeEventListener('void-remote-canvas-draw', handleRemoteDraw as EventListener);
      window.removeEventListener('void-remote-document', handleRemoteDocument as EventListener);
    };
  }, []);

  // Document sync
  const handleDocumentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setDocumentText(text);
    window.dispatchEvent(new CustomEvent('void-document-update', {
      detail: { targetId: targetUser?.id, text }
    }));
  };

  const colors = ['#a855f7', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#ffffff'];

  return (
    <div
      className="absolute inset-y-0 right-0 w-96 bg-[#1a1a24] border-l border-white/5 flex flex-col z-10 animate-in slide-in-from-right duration-200"
    >
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          {type === 'canvas' ? <Palette className="w-4 h-4 text-purple-400" /> : <FileText className="w-4 h-4 text-purple-400" />}
          <span className="text-white font-medium">
            {type === 'canvas' ? 'Совместный холст' : 'Совместный документ'}
          </span>
          <Users className="w-3 h-3 text-gray-500" />
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {type === 'canvas' ? (
          <>
            {/* Canvas */}
            <div className="flex-1 p-4">
              <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                className="w-full h-full rounded-lg cursor-crosshair bg-[#1a1a24] border border-white/10"
              />
            </div>
            
            {/* Toolbar */}
            <div className="p-4 border-t border-white/5 space-y-3">
              {/* Colors */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-12">Цвет:</span>
                <div className="flex gap-1">
                  {colors.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              
              {/* Brush size */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-12">Размер:</span>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs text-gray-400 w-6">{brushSize}</span>
              </div>
              
              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={clearCanvas}
                  className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
                >
                  Очистить
                </button>
                <button
                  onClick={downloadCanvas}
                  className="flex-1 py-2 bg-purple-500/20 text-purple-400 rounded-lg text-sm hover:bg-purple-500/30 transition-colors flex items-center justify-center gap-1"
                >
                  <Download className="w-4 h-4" />
                  Сохранить
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Document */}
            <div className="flex-1 p-4">
              <textarea
                value={documentText}
                onChange={handleDocumentChange}
                placeholder="Начните печатать здесь... Изменения будут видны вашему собеседнику в реальном времени."
                className="w-full h-full bg-[#0f0f14] rounded-lg p-3 text-gray-100 text-sm resize-none border border-white/10 focus:border-purple-500/50 focus:outline-none"
              />
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-white/5">
              <button
                onClick={downloadDocument}
                className="w-full py-2 bg-purple-500/20 text-purple-400 rounded-lg text-sm hover:bg-purple-500/30 transition-colors flex items-center justify-center gap-1"
              >
                <Download className="w-4 h-4" />
                Сохранить документ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
