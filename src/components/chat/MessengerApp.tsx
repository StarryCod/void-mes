'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuthStore } from '@/store/auth';
import { useChatStore, Contact, Channel, Message } from '@/store/chat';
import { AuthForm } from '@/components/auth/AuthForm';
import { VoidLogo } from '@/components/common/VoidLogo';
import { CallManager } from '@/components/call/CallManager';
import { useSocket } from '@/hooks/useSocket';
import { useAppwriteRealtime } from '@/hooks/useAppwriteRealtime';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, MessageSquare, Hash, X, Check, LogOut, Settings,
  Phone, Video, MoreVertical, Mic, Send, CheckCheck,
  Image as ImageIcon, FileText, PhoneOff, Sparkles, Play, Pause,
  Trash2, Eraser, Copy, Forward, MoreHorizontal
} from 'lucide-react';

export function MessengerApp() {
  const { user, token, setUser, logout } = useAuthStore();
  const { 
    contacts, setContacts, activeChat, setActiveChat,
    channels, setChannels, activeChannel, setActiveChannel,
    activeView, setActiveView, addContact, addChannel,
    messages, setMessages, addMessage, addReaction,
    typingUsers, setTypingUser
  } = useChatStore();
  const { toast } = useToast();
  const { 
    sendMessage: socketSendMessage, 
    sendTyping, 
    markAsRead, 
    notifyContactAdded,
    callUser,
    answerCall,
    rejectCall,
    endCall: socketEndCall,
    sendIceCandidate,
    notifyScreenShareStart,
    notifyScreenShareStop
  } = useSocket();

  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfile, setShowProfile] = useState<Contact | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<'clear' | 'delete' | null>(null);
  
  // Add friend
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  
  // Channel
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  
  // Settings
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Chat
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [attachments, setAttachments] = useState<{file: File, preview: string | null, type: 'image' | 'file'}[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showCall, setShowCall] = useState(false);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [showMenu, setShowMenu] = useState(false);
  
  // Voice playback
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceUrlsRef = useRef<Map<string, string>>(new Map());
  const voiceProgressRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const safeMessages = Array.isArray(messages) ? messages : [];
  const activeTarget = activeChat || activeChannel;
  const isChannel = !!activeChannel;

  const otherUserTyping = typingUsers.find(u => u.id === activeChat?.id);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setBio(user.bio || '');
    }
  }, [user]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Bridge call events from CallManager to Socket
  useEffect(() => {
    const handleSocketCall = (e: CustomEvent) => {
      const { targetId, signal, callType, callerName } = e.detail;
      callUser(targetId, signal, callType, user?.displayName || user?.username || 'User');
    };

    const handleSocketAnswer = (e: CustomEvent) => {
      const { targetId, signal } = e.detail;
      answerCall(targetId, signal);
    };

    const handleSocketReject = (e: CustomEvent) => {
      const { targetId } = e.detail;
      rejectCall(targetId);
    };

    const handleSocketEnd = (e: CustomEvent) => {
      const { targetId } = e.detail;
      socketEndCall(targetId);
    };

    const handleSocketIce = (e: CustomEvent) => {
      const { targetId, candidate } = e.detail;
      sendIceCandidate(targetId, candidate);
    };

    const handleSocketScreenStart = (e: CustomEvent) => {
      const { targetId } = e.detail;
      notifyScreenShareStart(targetId);
    };

    const handleSocketScreenStop = (e: CustomEvent) => {
      const { targetId } = e.detail;
      notifyScreenShareStop(targetId);
    };

    window.addEventListener('void-socket-call', handleSocketCall as EventListener);
    window.addEventListener('void-socket-answer', handleSocketAnswer as EventListener);
    window.addEventListener('void-socket-reject', handleSocketReject as EventListener);
    window.addEventListener('void-socket-end', handleSocketEnd as EventListener);
    window.addEventListener('void-socket-ice', handleSocketIce as EventListener);
    window.addEventListener('void-socket-screen-start', handleSocketScreenStart as EventListener);
    window.addEventListener('void-socket-screen-stop', handleSocketScreenStop as EventListener);

    return () => {
      window.removeEventListener('void-socket-call', handleSocketCall as EventListener);
      window.removeEventListener('void-socket-answer', handleSocketAnswer as EventListener);
      window.removeEventListener('void-socket-reject', handleSocketReject as EventListener);
      window.removeEventListener('void-socket-end', handleSocketEnd as EventListener);
      window.removeEventListener('void-socket-ice', handleSocketIce as EventListener);
      window.removeEventListener('void-socket-screen-start', handleSocketScreenStart as EventListener);
      window.removeEventListener('void-socket-screen-stop', handleSocketScreenStop as EventListener);
    };
  }, [user, callUser, answerCall, rejectCall, socketEndCall, sendIceCandidate, notifyScreenShareStart, notifyScreenShareStop]);

  const checkAuth = useCallback(async () => {
    if (!token) {
      setIsCheckingAuth(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        logout();
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setIsCheckingAuth(false);
    }
  }, [token, setUser, logout]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (token) {
      fetchContacts();
      fetchChannels();
    }
  }, [token]);

  const fetchContacts = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/contacts', { headers: { Authorization: `Bearer ${token}` } });
      setContacts((await res.json()).contacts || []);
    } catch (e) {}
  };

  const fetchChannels = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/channels', { headers: { Authorization: `Bearer ${token}` } });
      setChannels((await res.json()).channels || []);
    } catch (e) {}
  };

  useEffect(() => {
    if (activeTarget && token) fetchMessages(true);
  }, [activeTarget?.id, token]);

  // Appwrite Realtime - fetch messages when event received
  const handleRealtimeMessage = useCallback(async (messageId: string) => {
    if (!token || !activeTarget) return;
    try {
      const endpoint = isChannel 
        ? `/api/messages?channelId=${activeTarget.id}`
        : `/api/messages?contactId=${activeTarget.id}`;
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const allMessages = Array.isArray(data?.messages) ? data.messages : [];
      const newMsg = allMessages.find((m: Message) => m.id === messageId);
      if (newMsg) {
        const currentMessages = useChatStore.getState().messages || [];
        if (!currentMessages.find((m: Message) => m.id === messageId)) {
          setMessages([...currentMessages, newMsg]);
        }
      }
    } catch (e) {
      console.error('Realtime fetch error:', e);
    }
  }, [token, activeTarget?.id, isChannel]);

  useAppwriteRealtime(
    user?.id || null,
    activeChat?.id || null,
    activeChannel?.id || null,
    handleRealtimeMessage
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [safeMessages.length]);

  const fetchMessages = async (showLoading = false) => {
    if (!activeTarget || !token) return;
    if (showLoading) setIsLoading(true);
    try {
      const endpoint = isChannel 
        ? `/api/messages?channelId=${activeTarget.id}`
        : `/api/messages?contactId=${activeTarget.id}`;
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const msgs = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(msgs);
    } catch (e) {
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (searchQuery && showAddModal) {
      setIsSearching(true);
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setSearchResults((await res.json()).users?.slice(0, 5) || []);
        } catch (e) {}
        setIsSearching(false);
      }, 300);
    }
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [searchQuery, showAddModal, token]);

  const addUser = async (u: any) => {
    if (!token) return;
    setAddingId(u.id);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: u.username }),
      });
      const data = await res.json();
      if (res.ok) {
        const newContact = { ...data.contact, lastMessage: null, unreadCount: 0 };
        addContact(newContact);
        setSearchResults(r => r.map(x => x.id === u.id ? { ...x, isContact: true } : x));
        
        // Notify the other user via socket
        notifyContactAdded(u.id, {
          username: user?.username,
          displayName: user?.displayName
        });
        
        toast({
          title: 'Успешно',
          description: `${u.displayName || u.username} добавлен в друзья`,
        });
      } else {
        toast({
          title: 'Ошибка',
          description: data.error || 'Не удалось добавить контакт',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: 'Произошла ошибка при добавлении контакта',
        variant: 'destructive',
      });
    }
    setAddingId(null);
  };

  const createChannel = async () => {
    if (!token || !channelName.trim()) return;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: channelName.trim(), description: channelDescription }),
      });
      if (res.ok) {
        const data = await res.json();
        addChannel(data.channel);
        setShowChannelModal(false);
        setChannelName('');
        setChannelDescription('');
      }
    } catch (e) {}
  };

  const saveProfile = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName, bio }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {}
    setSaving(false);
  };

  // Clear chat history
  const clearChatHistory = async () => {
    if (!activeTarget || !token) return;
    try {
      const res = await fetch('/api/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          contactId: activeChat?.id, 
          channelId: activeChannel?.id 
        }),
      });
      if (res.ok) {
        setMessages([]);
      }
    } catch (e) {
      console.error('Clear chat error:', e);
    }
    setShowDeleteConfirm(null);
    setShowMenu(false);
  };

  // Delete chat completely
  const deleteChat = async () => {
    if (!activeTarget || !token) return;
    try {
      const res = await fetch('/api/chat/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          contactId: activeChat?.id, 
          channelId: activeChannel?.id 
        }),
      });
      if (res.ok) {
        setMessages([]);
        if (activeChat) {
          setContacts(contacts.filter(c => c.id !== activeChat.id));
          setActiveChat(null);
        }
        if (activeChannel) {
          setChannels(channels.filter(c => c.id !== activeChannel.id));
          setActiveChannel(null);
        }
      }
    } catch (e) {
      console.error('Delete chat error:', e);
    }
    setShowDeleteConfirm(null);
    setShowMenu(false);
  };

  const uploadFile = async (file: File): Promise<{url: string, type: string, name: string} | null> => {
    if (!token) return null;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.error('Upload error:', e);
    }
    return null;
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !activeTarget || !user || !token) return;

    setIsSending(true);
    const content = newMessage.trim();
    const tempId = `temp-${Date.now()}`;

    try {
      const uploadedAttachments = [];
      for (const att of attachments) {
        const uploaded = await uploadFile(att.file);
        if (uploaded) uploadedAttachments.push(uploaded);
      }

      const optimisticMsg: Message = {
        id: tempId,
        content: content,
        senderId: user.id,
        receiverId: activeChat?.id || null,
        channelId: activeChannel?.id || null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
        replyToId: replyTo?.id,
        replyTo: replyTo,
        attachments: uploadedAttachments.map(a => ({
          id: a.url, url: a.url, type: a.type as 'image' | 'file' | 'video' | 'audio', name: a.name, size: 0
        })),
      };

      addMessage(optimisticMsg);
      setNewMessage('');
      setReplyTo(null);
      setAttachments([]);
      setShowAttach(false);

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          receiverId: activeChat?.id, 
          channelId: activeChannel?.id,
          content: content || ' ',
          replyToId: replyTo?.id,
          attachments: uploadedAttachments,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const current = useChatStore.getState().messages || [];
        setMessages([...current.filter((m: Message) => m.id !== tempId), data.message]);
        
        // Send via socket for real-time delivery
        socketSendMessage(activeChat?.id, activeChannel?.id, data.message);
      }
    } catch (e) {
      console.error('Send error:', e);
      toast({
        title: 'Ошибка',
        description: 'Не удалось отправить сообщение',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleFileSelect = (type: 'image' | 'file') => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : '*';
      fileInputRef.current.click();
    }
    setShowAttach(false);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/');
      setAttachments(prev => [...prev, {
        file,
        preview: isImage ? URL.createObjectURL(file) : null,
        type: isImage ? 'image' : 'file' as const
      }]);
    });
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingInterval.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (e) {
      console.error('Mic error:', e);
    }
  };

  const stopRecording = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        recorder.stream.getTracks().forEach(track => track.stop());
        resolve(blob);
      };
      recorder.stop();
      if (recordingInterval.current) {
        clearInterval(recordingInterval.current);
        recordingInterval.current = null;
      }
      setIsRecording(false);
    });
  };

  const cancelRecording = async () => {
    await stopRecording();
    setRecordingTime(0);
  };

  const sendVoiceMessage = async () => {
    const blob = await stopRecording();
    if (!blob || !activeTarget || !user || !token) return;

    const duration = recordingTime;
    const voiceFile = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
    const uploaded = await uploadFile(voiceFile);
    
    if (uploaded) {
      const tempKey = `temp-${Date.now()}`;
      voiceUrlsRef.current.set(tempKey, uploaded.url);
      try {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ 
            receiverId: activeChat?.id, 
            channelId: activeChannel?.id,
            content: 'Голосовое сообщение',
            isVoice: true,
            voiceDuration: duration,
            voiceUrl: uploaded.url,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          voiceUrlsRef.current.set(data.message.id, uploaded.url);
          addMessage(data.message);
          
          // Send via socket for real-time delivery
          socketSendMessage(activeChat?.id, activeChannel?.id, data.message);
        }
      } catch (e) {
        console.error('Voice send error:', e);
      }
    }
    setRecordingTime(0);
  };

  const playVoiceMessage = (msgId: string, url?: string, duration?: number) => {
    const voiceUrl = url || voiceUrlsRef.current.get(msgId);
    
    if (!voiceUrl) {
      console.error('[Voice] No URL found for message:', msgId);
      toast({
        title: 'Ошибка воспроизведения',
        description: 'Аудиофайл не найден',
        variant: 'destructive',
      });
      return;
    }

    console.log('[Voice] Playing:', voiceUrl);

    if (playingVoiceId === msgId) {
      // Pause current playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (voiceProgressRef.current) {
        clearInterval(voiceProgressRef.current);
        voiceProgressRef.current = null;
      }
      setPlayingVoiceId(null);
      setVoiceProgress(0);
    } else {
      // Stop any existing playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (voiceProgressRef.current) {
        clearInterval(voiceProgressRef.current);
        voiceProgressRef.current = null;
      }
      
      const audio = new Audio(voiceUrl);
      audio.volume = 1.0;
      audio.preload = 'auto';
      
      audio.onerror = (e) => {
        console.error('[Voice] Audio error:', e);
        toast({
          title: 'Ошибка воспроизведения',
          description: 'Не удалось загрузить аудиофайл',
          variant: 'destructive',
        });
        setPlayingVoiceId(null);
        setVoiceProgress(0);
      };
      
      audio.onloadedmetadata = () => {
        console.log('[Voice] Loaded, duration:', audio.duration);
        const totalDuration = duration || audio.duration || 1;
        voiceProgressRef.current = setInterval(() => {
          if (audioRef.current) {
            const progress = (audioRef.current.currentTime / totalDuration) * 100;
            setVoiceProgress(progress);
          }
        }, 100);
      };
      
      audio.onended = () => {
        console.log('[Voice] Ended');
        setPlayingVoiceId(null);
        setVoiceProgress(0);
        if (voiceProgressRef.current) {
          clearInterval(voiceProgressRef.current);
          voiceProgressRef.current = null;
        }
      };
      
      audio.play().catch((err) => {
        console.error('[Voice] Play error:', err);
        toast({
          title: 'Ошибка воспроизведения',
          description: 'Не удалось воспроизвести аудио',
          variant: 'destructive',
        });
        setPlayingVoiceId(null);
      });
      
      audioRef.current = audio;
      setPlayingVoiceId(msgId);
    }
  };

  // Seek to position in voice message (0-100)
  const seekVoiceMessage = (percent: number) => {
    if (audioRef.current && playingVoiceId) {
      const msg = safeMessages.find(m => m.id === playingVoiceId);
      const duration = msg?.voiceDuration || audioRef.current.duration || 0;
      const newTime = (percent / 100) * duration;
      audioRef.current.currentTime = newTime;
      setVoiceProgress(percent);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const initials = (n: string | null, u: string) => (n?.[0] || u?.[0] || '?').toUpperCase();
  const formatMsgTime = (d: string) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const formatMsgDate = (d: string) => {
    const date = new Date(d);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Сегодня';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };
  
  const onlineContacts = (contacts || []).filter(c => c.isOnline);
  const offlineContacts = (contacts || []).filter(c => !c.isOnline);
  const quickReactions = ['❤️', '👍', '😂', '😮', '😢', '😡'];

  const groupedMessages = safeMessages.reduce((groups: { date: string; messages: Message[] }[], msg) => {
    const date = formatMsgDate(msg.createdAt);
    const existing = groups.find(g => g.date === date);
    if (existing) existing.messages.push(msg);
    else groups.push({ date, messages: [msg] });
    return groups;
  }, []);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#13131a]">
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
          <VoidLogo size="xl" />
        </motion.div>
      </div>
    );
  }

  if (!user) return <AuthForm onSuccess={() => {}} />;

  return (
    <div className="fixed inset-0 flex bg-[#13131a] overflow-hidden">
      {/* LEFT SIDEBAR - Shows on mobile when no active chat, always on desktop */}
      <div className={`${activeTarget ? 'hidden md:flex' : 'flex'} w-full md:w-60 bg-[#0f0f14] flex-col border-r border-white/5 shrink-0`}>
        {/* Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-white/5">
          <h1 className="text-white font-bold text-lg">Void Mes</h1>
          <button
            onClick={() => activeView === 'dms' ? setShowAddModal(true) : setShowChannelModal(true)}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-1 p-2">
          <button 
            onClick={() => setActiveView('dms')} 
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeView === 'dms' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            Сообщения
          </button>
          <button 
            onClick={() => setActiveView('channels')} 
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeView === 'channels' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            Каналы
          </button>
        </div>
        
        {/* List */}
        <div className="flex-1 overflow-y-auto px-2">
          <AnimatePresence mode="wait">
            {activeView === 'dms' ? (
              <motion.div key="dms" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                {onlineContacts.length === 0 && offlineContacts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    Нет контактов
                  </div>
                ) : (
                  <>
                    {onlineContacts.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setActiveChat(c)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${activeChat?.id === c.id ? 'bg-[#1a1a24]' : 'hover:bg-[#1a1a24]/50'}`}
                      >
                        <div className="relative">
                          <Avatar className="w-9 h-9">
                            <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm">
                              {initials(c.displayName, c.username)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[#0f0f14]" />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-white text-sm font-medium truncate">{c.displayName || c.username}</p>
                          <p className="text-xs text-gray-500 truncate">{c.lastMessage?.content || 'Нет сообщений'}</p>
                        </div>
                        {(c.unreadCount || 0) > 0 && (
                          <span className="bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                            {c.unreadCount}
                          </span>
                        )}
                      </button>
                    ))}
                    {offlineContacts.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setActiveChat(c)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${activeChat?.id === c.id ? 'bg-[#1a1a24]' : 'hover:bg-[#1a1a24]/50'}`}
                      >
                        <Avatar className="w-9 h-9">
                          <AvatarFallback className="bg-[#2a2a34] text-white text-sm">
                            {initials(c.displayName, c.username)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left min-w-0">
                          <p className="text-gray-400 text-sm font-medium truncate">{c.displayName || c.username}</p>
                          <p className="text-xs text-gray-600 truncate">{c.lastMessage?.content || 'Нет сообщений'}</p>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="channels" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                {(channels || []).length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    Нет каналов
                  </div>
                ) : (
                  (channels || []).map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannel(ch)}
                      className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${activeChannel?.id === ch.id ? 'bg-[#1a1a24]' : 'hover:bg-[#1a1a24]/50'}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-[#242430] flex items-center justify-center text-gray-400">
                        <Hash className="w-4 h-4" />
                      </div>
                      <span className="text-white text-sm font-medium truncate">{ch.name}</span>
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* User */}
        <div className="p-3 border-t border-white/5">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-[#1a1a24] transition-colors"
          >
            <Avatar className="w-9 h-9">
              <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm">
                {initials(user?.displayName || null, user?.username || '')}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left">
              <p className="text-white text-sm font-medium">{user?.displayName || user?.username}</p>
              <p className="text-xs text-gray-500">@{user?.username}</p>
            </div>
            <Settings className="w-4 h-4 text-gray-500" />
          </button>
          
          {showUserMenu && (
            <div className="absolute bottom-16 left-2 w-52 bg-[#1a1a24] rounded-xl border border-white/5 shadow-xl overflow-hidden z-50">
              <button onClick={() => { setShowSettings(true); setShowUserMenu(false); }} className="w-full px-4 py-2.5 text-left text-gray-300 text-sm hover:bg-white/5 flex items-center gap-2">
                <Settings className="w-4 h-4" /> Настройки
              </button>
              <button onClick={logout} className="w-full px-4 py-2.5 text-left text-red-400 text-sm hover:bg-red-500/10 flex items-center gap-2">
                <LogOut className="w-4 h-4" /> Выйти
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CHAT WINDOW - Shows only when there's an active chat */}
      <div className={`${activeTarget ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-[#13131a] min-w-0 h-full`}>
        {activeTarget ? (
          <div className="h-14 px-4 flex items-center gap-3 border-b border-white/5 bg-[#1a1a24] shrink-0">
            {/* Back button for mobile */}
            <button 
              onClick={() => {
                setActiveChat(null);
                setActiveChannel(null);
              }}
              className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white sm:hidden"
            >
              <X className="w-5 h-5" />
            </button>
            {isChannel ? (
              <div className="w-9 h-9 rounded-lg bg-[#242430] flex items-center justify-center text-gray-400">
                <span className="text-lg">#</span>
              </div>
            ) : (
              <button onClick={() => setShowProfile(activeTarget as Contact)} className="focus:outline-none">
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm">
                    {initials(activeTarget.displayName, activeTarget.username)}
                  </AvatarFallback>
                </Avatar>
              </button>
            )}
            
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-medium text-sm truncate">
                {isChannel ? activeTarget.name : (activeTarget.displayName || activeTarget.username)}
              </h3>
              <div className="flex items-center gap-2">
                {!isChannel && (
                  <>
                    {otherUserTyping?.isTyping ? (
                      <p className="text-xs text-purple-400 animate-pulse">печатает...</p>
                    ) : (
                      <>
                        <span className={`w-2 h-2 rounded-full ${(activeTarget as Contact).isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
                        <p className="text-xs text-gray-500">
                          {(activeTarget as Contact).isOnline ? <span className="text-green-400">онлайн</span> : 'был(а) недавно'}
                        </p>
                      </>
                    )}
                  </>
                )}
                {isChannel && <p className="text-xs text-gray-500">Канал</p>}
              </div>
            </div>

            <button 
              onClick={() => {
                if (activeChat && (window as any).startWebRTCCall) {
                  (window as any).startWebRTCCall(activeChat.id, activeChat.displayName || activeChat.username, 'voice');
                }
              }} 
              className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button 
              onClick={() => {
                if (activeChat && (window as any).startWebRTCCall) {
                  (window as any).startWebRTCCall(activeChat.id, activeChat.displayName || activeChat.username, 'video');
                }
              }} 
              className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white"
            >
              <Video className="w-5 h-5" />
            </button>
            <div className="relative" ref={menuRef}>
              <button onClick={() => setShowMenu(!showMenu)} className="w-9 h-9 rounded-full hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white">
                <MoreVertical className="w-5 h-5" />
              </button>
              <AnimatePresence>
                {showMenu && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="absolute right-0 top-full mt-1 w-48 bg-[#1a1a24] rounded-xl border border-white/5 shadow-xl overflow-hidden z-50">
                    <button onClick={() => { setShowDeleteConfirm('clear'); setShowMenu(false); }} className="w-full px-4 py-2.5 text-left text-gray-300 text-sm hover:bg-white/5 flex items-center gap-3">
                      <Eraser className="w-4 h-4" /> Очистить историю
                    </button>
                    <button onClick={() => { setShowDeleteConfirm('delete'); setShowMenu(false); }} className="w-full px-4 py-2.5 text-left text-red-400 text-sm hover:bg-red-500/10 flex items-center gap-3">
                      <Trash2 className="w-4 h-4" /> Удалить чат
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : null}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!activeTarget ? (
            <WelcomeScreen />
          ) : isLoading ? (
            <div className="flex justify-center py-8">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full"
              />
            </div>
          ) : safeMessages.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-full text-center"
            >
              <motion.div 
                animate={{ scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-4"
              >
                <Sparkles className="w-8 h-8 text-purple-400" />
              </motion.div>
              <p className="text-gray-400 font-medium">Начните диалог</p>
              <p className="text-gray-600 text-sm mt-1">Отправьте первое сообщение!</p>
            </motion.div>
          ) : (
            <div className="px-4 py-4 pb-24 sm:pb-4">
              {groupedMessages.map((group) => (
                <div key={group.date}>
                  <div className="flex items-center gap-4 my-6">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[11px] text-gray-500 font-medium">{group.date}</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>
                  
                  <div className="space-y-[2px]">
                    {group.messages.map((msg, idx) => {
                      const isOwn = msg.senderId === user?.id;
                      const prevMsg = group.messages[idx - 1];
                      const showHeader = !prevMsg || prevMsg.senderId !== msg.senderId || 
                        (new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() > 5 * 60 * 1000);
                      
                      return (
                        <div key={msg.id} className={`flex gap-3 ${showHeader ? 'mt-4 py-1' : 'py-[2px]'}`}>
                          <div className="w-10 shrink-0">
                            {showHeader ? (
                              <Avatar className="w-10 h-10">
                                <AvatarFallback className={`${isOwn ? 'bg-gradient-to-br from-purple-500 to-pink-500' : 'bg-[#2a2a34]'} text-white text-sm`}>
                                  {isOwn ? initials(user?.displayName || null, user?.username || '') : initials(activeTarget?.displayName || null, activeTarget?.username || '')}
                                </AvatarFallback>
                              </Avatar>
                            ) : (
                              <div className="w-10 h-10 flex items-center justify-center">
                                <span className="text-[10px] text-gray-600">
                                  {formatMsgTime(msg.createdAt)}
                                </span>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            {showHeader && (
                              <div className="flex items-baseline gap-2 mb-0.5">
                                <span className="text-white font-medium text-[15px] hover:underline cursor-pointer">
                                  {isOwn ? (user?.displayName || user?.username) : (activeTarget?.displayName || activeTarget?.username)}
                                </span>
                                <span className="text-[11px] text-gray-500">{formatMsgTime(msg.createdAt)}</span>
                              </div>
                            )}
                            
                            {msg.replyTo && (
                              <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-400 border-l-2 border-purple-500 pl-2">
                                <span className="text-purple-400 font-medium">
                                  {msg.replyTo.senderId === user?.id ? 'Вы' : (activeTarget?.displayName || activeTarget?.username)}
                                </span>
                                <span className="truncate max-w-[200px]">{msg.replyTo.content}</span>
                              </div>
                            )}
                            
                            {/* Message content with hover reactions */}
                            <div className="group/msg relative">
                              {msg.isVoice ? (
                                <VoiceMessage 
                                  msgId={msg.id}
                                  voiceUrl={msg.voiceUrl}
                                  duration={msg.voiceDuration || 0}
                                  isPlaying={playingVoiceId === msg.id}
                                  progress={playingVoiceId === msg.id ? voiceProgress : 0}
                                  onPlay={() => playVoiceMessage(msg.id, msg.voiceUrl, msg.voiceDuration)}
                                  onSeek={seekVoiceMessage}
                                  formatTime={formatTime}
                                />
                              ) : (
                                <>
                                  {msg.content && (
                                    <div className="text-gray-100 text-[15px] leading-[1.4] whitespace-pre-wrap break-words">
                                      {msg.content}
                                    </div>
                                  )}
                                  
                                  {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-2">
                                      {msg.attachments.map((att: any, i: number) => (
                                        att.type === 'image' ? (
                                          <img key={i} src={att.url} alt="" className="max-w-[300px] rounded-lg cursor-pointer hover:opacity-90" />
                                        ) : att.type === 'audio' ? (
                                          <audio key={i} controls src={att.url} className="h-10 max-w-[300px]" />
                                        ) : (
                                          <a key={i} href={att.url} download={att.name} className="flex items-center gap-2 px-4 py-3 bg-[#1a1a24] rounded-lg hover:bg-[#222] transition-colors">
                                            <FileText className="w-5 h-5 text-gray-400" />
                                            <span className="text-sm text-gray-200">{att.name}</span>
                                          </a>
                                        )
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                              
                              {/* Reaction buttons - show on message content hover only */}
                              <div className="absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10">
                                <div className="bg-[#1a1a24] rounded-full shadow-lg border border-white/5 flex items-center px-1 py-0.5">
                                  {quickReactions.slice(0, 4).map((emoji, ri) => (
                                    <button key={ri} onClick={() => addReaction(msg.id, emoji)} className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-sm transition-transform hover:scale-125">{emoji}</button>
                                  ))}
                                  <button onClick={() => setReplyTo(msg)} className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                            
                            {msg.reactions && msg.reactions.length > 0 && (
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {msg.reactions.map((r, ri) => (
                                  <button key={ri} onClick={() => addReaction(msg.id, r.emoji)} className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 transition-colors ${r.reacted ? 'bg-purple-500/30 ring-1 ring-purple-500/50' : 'bg-[#2a2a34] hover:bg-[#333]'}`}>
                                    {r.emoji} <span className="text-gray-300">{r.count}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reply preview */}
        <AnimatePresence>
          {replyTo && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/5 bg-[#0f0f14] overflow-hidden">
              <div className="px-4 py-2 flex items-center gap-3">
                <div className="w-1 h-10 bg-purple-500 rounded-full" />
                <div className="flex-1 min-w-0">
                  <p className="text-purple-400 text-xs font-medium">Ответить {replyTo.senderId === user?.id ? 'себе' : (activeTarget?.displayName || activeTarget?.username)}</p>
                  <p className="text-gray-500 text-sm truncate">{replyTo.content}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-gray-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attachment preview */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/5 bg-[#0f0f14] overflow-hidden">
              <div className="px-4 py-3 flex gap-2 flex-wrap">
                {attachments.map((att, i) => (
                  <div key={i} className="relative group">
                    {att.type === 'image' && att.preview ? (
                      <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#1a1a24]">
                        <img src={att.preview} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="h-20 px-4 rounded-lg bg-[#1a1a24] flex items-center gap-2">
                        <FileText className="w-6 h-6 text-gray-400" />
                        <span className="text-white text-sm truncate max-w-[100px]">{att.file.name}</span>
                      </div>
                    )}
                    <button onClick={() => removeAttachment(i)} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        {activeTarget && (
          <div className="p-4 bg-[#1a1a24] border-t border-white/5">
            {isRecording ? (
              <div className="flex items-center gap-3 bg-[#242430] rounded-xl px-4 py-3">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="w-3 h-3 bg-red-500 rounded-full" />
                <span className="text-white text-sm flex-1 font-mono">{formatTime(recordingTime)}</span>
                <button onClick={sendVoiceMessage} className="px-5 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors">Отправить</button>
                <button onClick={cancelRecording} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
              </div>
            ) : (
              <form onSubmit={sendMessage} className="flex items-end gap-3">
                <div className="relative">
                  <button type="button" onClick={() => setShowAttach(!showAttach)} className="w-10 h-10 rounded-full bg-[#242430] hover:bg-[#2a2a34] flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                    <Plus className="w-5 h-5" />
                  </button>
                  <AnimatePresence>
                    {showAttach && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-12 left-0 bg-[#1a1a24] rounded-xl shadow-xl border border-white/5 overflow-hidden w-40 z-50">
                        <button type="button" onClick={() => handleFileSelect('image')} className="w-full px-4 py-3 flex items-center gap-3 text-gray-300 hover:bg-white/5 text-sm transition-colors">
                          <ImageIcon className="w-5 h-5 text-blue-400" /> Фото
                        </button>
                        <button type="button" onClick={() => handleFileSelect('file')} className="w-full px-4 py-3 flex items-center gap-3 text-gray-300 hover:bg-white/5 text-sm transition-colors">
                          <FileText className="w-5 h-5 text-green-400" /> Файл
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
                <input type="text" value={newMessage} onChange={e => {
                  setNewMessage(e.target.value);
                  // Send typing indicator
                  if (activeChat && e.target.value.length > 0) {
                    sendTyping(activeChat.id, true);
                    // Clear previous timeout
                    if (typingTimeoutRef.current) {
                      clearTimeout(typingTimeoutRef.current);
                    }
                    // Stop typing indicator after 2 seconds of no input
                    typingTimeoutRef.current = setTimeout(() => {
                      sendTyping(activeChat.id, false);
                    }, 2000);
                  } else if (activeChat) {
                    sendTyping(activeChat.id, false);
                  }
                }} placeholder={activeTarget ? `Написать ${activeTarget.displayName || activeTarget.username}...` : 'Сообщение...'} className="flex-1 bg-[#242430] text-white placeholder-gray-500 rounded-xl px-4 py-2.5 outline-none text-sm focus:ring-2 focus:ring-purple-500/50 min-w-0" disabled={isSending} />

                {newMessage.trim() || attachments.length > 0 ? (
                  <button type="submit" disabled={isSending} className="w-10 h-10 rounded-full bg-purple-500 hover:bg-purple-600 flex items-center justify-center text-white shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {isSending ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                ) : (
                  <button type="button" onClick={startRecording} disabled={isSending} className="w-10 h-10 rounded-full bg-[#242430] hover:bg-[#2a2a34] flex items-center justify-center text-gray-400 hover:text-white shrink-0 transition-colors disabled:opacity-50">
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </form>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}

      {/* Add Friend Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { setShowAddModal(false); setSearchQuery(''); setSearchResults([]); }}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} onClick={e => e.stopPropagation()} className="bg-[#1a1a24] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-semibold">Добавить друга</h2>
                <button onClick={() => { setShowAddModal(false); setSearchQuery(''); setSearchResults([]); }} className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Введите ник..." className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50" autoFocus />
              </div>
              <div className="px-4 pb-4 max-h-48 overflow-y-auto">
                {isSearching ? (
                  <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : searchResults.length === 0 && searchQuery ? (
                  <p className="text-gray-500 text-center py-4 text-sm">Не найдено</p>
                ) : (
                  <div className="space-y-1">
                    {searchResults.map(u => (
                      <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                        <Avatar className="w-9 h-9"><AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm">{initials(u.displayName, u.username)}</AvatarFallback></Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">{u.displayName || u.username}</p>
                          <p className="text-gray-500 text-xs">@{u.username}</p>
                        </div>
                        <button onClick={() => addUser(u)} disabled={u.isContact || addingId === u.id} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${u.isContact ? 'bg-green-500/20 text-green-400' : 'bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-50'}`}>
                          {addingId === u.id ? '...' : u.isContact ? <Check className="w-4 h-4" /> : 'Добавить'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Channel Creation Modal with Ghost Assistant */}
      <AnimatePresence>
        {showChannelModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowChannelModal(false)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} onClick={e => e.stopPropagation()} className="bg-[#1a1a24] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative">
              {/* Ghost Assistant */}
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-10">
                <div className="relative select-none">
                  <div className="text-6xl select-none pointer-events-none">👻</div>
                  <div className="absolute -right-4 top-0 bg-[#1a1a24] rounded-xl px-3 py-2 shadow-xl border border-white/5 whitespace-nowrap">
                    <p className="text-sm text-white select-none">Привет! Создадим канал? ✨</p>
                    <div className="absolute -bottom-1 left-8 w-2 h-2 bg-[#1a1a24] border-r border-b border-white/5 rotate-45" />
                  </div>
                </div>
              </div>

              <div className="p-6 pt-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xl">
                    <Hash className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-white font-semibold text-lg">Новый канал</h2>
                    <p className="text-gray-500 text-xs">Создайте пространство для общения</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-gray-400 text-xs uppercase block mb-1.5">Название канала</label>
                    <input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="my-awesome-channel" className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500/50" />
                  </div>
                  
                  <div>
                    <label className="text-gray-400 text-xs uppercase block mb-1.5">Описание (необязательно)</label>
                    <textarea value={channelDescription} onChange={e => setChannelDescription(e.target.value)} placeholder="О чём будет этот канал..." rows={2} className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500/50 resize-none" />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowChannelModal(false)} className="flex-1 py-2.5 bg-[#242430] hover:bg-[#2a2a34] text-gray-300 rounded-lg text-sm font-medium transition-colors">
                      Отмена
                    </button>
                    <button onClick={createChannel} disabled={!channelName.trim()} className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                      <Sparkles className="w-4 h-4" /> Создать
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete/Clear Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowDeleteConfirm(null)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} onClick={e => e.stopPropagation()} className="bg-[#1a1a24] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-6 text-center">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${showDeleteConfirm === 'delete' ? 'bg-red-500/20' : 'bg-purple-500/20'}`}>
                  {showDeleteConfirm === 'delete' ? (
                    <Trash2 className="w-8 h-8 text-red-400" />
                  ) : (
                    <Eraser className="w-8 h-8 text-purple-400" />
                  )}
                </div>
                <h2 className="text-white font-semibold text-lg mb-2">
                  {showDeleteConfirm === 'delete' ? 'Удалить чат?' : 'Очистить историю?'}
                </h2>
                <p className="text-gray-500 text-sm mb-6">
                  {showDeleteConfirm === 'delete' 
                    ? 'Чат будет удалён для вас. Это действие нельзя отменить.' 
                    : 'Все сообщения в этом чате будут удалены. Это действие нельзя отменить.'}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2.5 bg-[#242430] hover:bg-[#2a2a34] text-gray-300 rounded-lg text-sm font-medium transition-colors">
                    Отмена
                  </button>
                  <button onClick={showDeleteConfirm === 'delete' ? deleteChat : clearChatHistory} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${showDeleteConfirm === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'} text-white`}>
                    {showDeleteConfirm === 'delete' ? 'Удалить' : 'Очистить'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSettings(false)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} onClick={e => e.stopPropagation()} className="bg-[#1a1a24] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-semibold">Настройки</h2>
                <button onClick={() => setShowSettings(false)} className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex justify-center">
                  <Avatar className="w-20 h-20">
                    <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-2xl">{initials(displayName || null, user?.username || '')}</AvatarFallback>
                  </Avatar>
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase block mb-1.5">Имя пользователя</label>
                  <input value={user?.username || ''} disabled className="w-full bg-[#242430] text-gray-500 rounded-lg px-4 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase block mb-1.5">Отображаемое имя</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Как вас видят другие" className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase block mb-1.5">О себе</label>
                  <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Расскажите о себе..." rows={3} className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500/50 resize-none" />
                </div>
                <button onClick={saveProfile} disabled={saving} className="w-full py-2.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
                  {saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowProfile(null)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} onClick={e => e.stopPropagation()} className="bg-[#1a1a24] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
              <div className="p-6 flex flex-col items-center">
                <Avatar className="w-20 h-20">
                  <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-2xl">
                    {initials(showProfile.displayName, showProfile.username)}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-white font-semibold text-lg mt-4">{showProfile.displayName || showProfile.username}</h2>
                <p className="text-gray-500 text-sm">@{showProfile.username}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`w-2 h-2 rounded-full ${showProfile.isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
                  <span className={`text-xs ${showProfile.isOnline ? 'text-green-400' : 'text-gray-500'}`}>
                    {showProfile.isOnline ? 'онлайн' : 'был(а) недавно'}
                  </span>
                </div>
                {showProfile.bio && <p className="text-gray-400 text-sm text-center mt-4">{showProfile.bio}</p>}
                <div className="flex gap-3 mt-6 w-full">
                  <button 
                    onClick={() => { 
                      setShowProfile(null);
                      if ((window as any).startWebRTCCall) {
                        (window as any).startWebRTCCall(showProfile.id, showProfile.displayName || showProfile.username, 'voice');
                      }
                    }} 
                    className="flex-1 py-2.5 bg-[#242430] hover:bg-[#2a2a34] text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Phone className="w-4 h-4" /> Позвонить
                  </button>
                  <button onClick={() => setShowProfile(null)} className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors">
                    Написать
                  </button>
                </div>
              </div>
              <button onClick={() => setShowProfile(null)} className="absolute top-4 right-4 w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400"><X className="w-5 h-5" /></button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No Mobile Bottom Navigation - using sidebar instead */}

      {/* Call Manager - WebRTC */}
      {user && (
        <CallManager
          userId={user.id}
          contacts={contacts}
          onCallStart={() => setShowCall(false)}
        />
      )}
    </div>
  );
}

// Voice Message Component - Telegram style with clickable timeline
function VoiceMessage({ msgId, voiceUrl, duration, isPlaying, progress, onPlay, onSeek, formatTime }: {
  msgId: string;
  voiceUrl?: string;
  duration: number;
  isPlaying: boolean;
  progress: number;
  onPlay: () => void;
  onSeek: (percent: number) => void;
  formatTime: (s: number) => string;
}) {
  const waveformRef = useRef<HTMLDivElement>(null);
  
  // Check if URL is missing
  const hasUrl = !!voiceUrl;
  
  // Use a safe duration (at least 1 second to show waveform)
  const safeDuration = Math.max(duration || 1, 1);

  // Generate waveform bars based on duration
  const barCount = Math.min(Math.max(Math.floor(safeDuration * 2.5), 15), 40);
  const bars = Array.from({ length: barCount }, (_, i) => {
    const seed = i * 0.5;
    const base = Math.sin(seed) * 0.3 + 0.4;
    const variance = Math.sin(seed * 2.3) * 0.2;
    return Math.max(0.15, Math.min(1, base + variance));
  });

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!waveformRef.current || !hasUrl) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    onSeek(percent);
  };

  // Calculate current time based on progress
  const currentTime = Math.floor((progress / 100) * safeDuration);
  const displayTime = isPlaying ? currentTime : safeDuration;

  return (
    <div className={`inline-flex items-center gap-2 py-1 px-3 rounded-2xl ${!hasUrl ? 'bg-red-500/20 border border-red-500/30' : 'bg-[#1a1a24]'}`}>
      <button 
        onClick={onPlay} 
        disabled={!hasUrl}
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
          !hasUrl 
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
            : isPlaying 
              ? 'bg-purple-500 text-white' 
              : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
        }`}
      >
        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>

      {/* Waveform timeline - TG style, clickable */}
      <div
        ref={waveformRef}
        onClick={handleWaveformClick}
        className={`flex items-center h-6 gap-[2px] min-w-[120px] max-w-[280px] ${hasUrl ? 'cursor-pointer' : 'cursor-not-allowed'}`}
      >
        {bars.map((height, i) => {
          const barProgress = (i / barCount) * 100;
          const isActive = barProgress <= progress;
          return (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-colors duration-100 ${
                !hasUrl 
                  ? 'bg-gray-600' 
                  : isActive 
                    ? 'bg-purple-400' 
                    : 'bg-gray-500'
              }`}
              style={{ height: `${Math.floor(height * 16) + 4}px` }}
            />
          );
        })}
      </div>

      <span className={`text-xs shrink-0 tabular-nums min-w-[28px] text-right ${!hasUrl ? 'text-red-400' : 'text-gray-400'}`}>
        {!hasUrl ? 'ошибка' : (isPlaying ? formatTime(currentTime) : formatTime(safeDuration))}
      </span>
    </div>
  );
}

// Welcome Screen with Easter Eggs - Optimized
const TIPS = [
  "🔒 Ваши сообщения защищены сквозным шифрованием",
  "✨ Добавьте друзей и начните общение",
  "🎮 Проведите свайп влево для быстрого доступа",
  "🎭 Создавайте каналы для групповых чатов",
];

// Static particle positions (pre-computed for performance)
const PARTICLES = [...Array(8)].map((_, i) => ({
  left: `${50 + (Math.random() * 40 - 20)}%`,
  duration: 4 + Math.random() * 4,
  delay: i * 0.8,
}));

function WelcomeScreen() {
  const [clickCount, setClickCount] = useState(0);
  const [showSecret, setShowSecret] = useState(false);
  const [showWatching, setShowWatching] = useState(false);
  const [ghosts, setGhosts] = useState<{id: number, x: number, y: number}[]>([]);
  const [tipIndex, setTipIndex] = useState(0);
  
  const tipIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Tips rotation with ref for better cleanup
  useEffect(() => {
    tipIntervalRef.current = setInterval(() => {
      setTipIndex(i => (i + 1) % TIPS.length);
    }, 5000);
    return () => {
      if (tipIntervalRef.current) clearInterval(tipIntervalRef.current);
    };
  }, []);

  // Easter egg: click ghost 5 times to reveal secret
  const handleGhostClick = useCallback(() => {
    setClickCount(c => {
      const newCount = c + 1;
      if (newCount >= 5) {
        setShowSecret(true);
        setTimeout(() => setShowSecret(false), 3000);
        return 0;
      }
      return newCount;
    });
    
    // 1% chance to show "We are watching you"
    if (Math.random() < 0.01) {
      setShowWatching(true);
      setTimeout(() => setShowWatching(false), 3000);
    }
    
    // Spawn floating ghost (limited to 3 max for performance)
    setGhosts(prev => {
      if (prev.length >= 3) return prev;
      const newGhost = {
        id: Date.now(),
        x: Math.random() * 200 - 100,
        y: Math.random() * -100,
      };
      setTimeout(() => {
        setGhosts(g => g.filter(ghost => ghost.id !== newGhost.id));
      }, 2000);
      return [...prev, newGhost];
    });
  }, []);

  return (
    <div className="flex items-center justify-center h-full relative overflow-hidden">
      {/* Floating particles - reduced count for performance */}
      <div className="absolute inset-0 pointer-events-none">
        {PARTICLES.map((particle, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-purple-500/30 rounded-full will-change-transform"
            initial={{ y: 300, opacity: 0 }}
            animate={{ y: -300, opacity: [0, 0.5, 0] }}
            transition={{ 
              duration: particle.duration,
              repeat: Infinity,
              delay: particle.delay,
              ease: "linear",
            }}
            style={{ left: particle.left }}
          />
        ))}
      </div>

      {/* Floating ghosts */}
      <AnimatePresence>
        {ghosts.map(ghost => (
          <motion.div
            key={ghost.id}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: ghost.x, y: ghost.y - 100, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, ease: "easeOut" }}
            className="absolute text-2xl pointer-events-none select-none"
          >
            👻
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="text-center relative z-10">
        <motion.div 
          animate={{ 
            scale: [1, 1.05, 1],
          }} 
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          onClick={handleGhostClick}
          className="w-28 h-28 rounded-3xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mx-auto mb-6 cursor-pointer hover:from-purple-500/30 hover:to-pink-500/30 transition-colors shadow-lg shadow-purple-500/10 border border-purple-500/10 select-none"
        >
          <span className="text-5xl select-none pointer-events-none">
            {showSecret ? '🎃' : '👻'}
          </span>
        </motion.div>
        
        <h2 className="text-white text-2xl font-bold mb-2">
          Void Mes
        </h2>
        
        <motion.p 
          key={tipIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="text-gray-500 text-sm"
        >
          {TIPS[tipIndex]}
        </motion.p>

        <p className="text-gray-600 text-xs mt-4">
          Выберите чат слева
        </p>

        {/* Secret message - Easter egg found */}
        <AnimatePresence>
          {showSecret && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute -bottom-20 left-1/2 -translate-x-1/2 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-full text-sm whitespace-nowrap select-none"
            >
              🎉 Ты нашёл пасхалку!
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Creepy 1% message */}
        <AnimatePresence>
          {showWatching && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute -bottom-20 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-full text-sm whitespace-nowrap shadow-lg shadow-red-500/50 select-none"
            >
              👁️ Мы следим за тобой...
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Avatar with Rotating Name
function AvatarWithRotatingName({ contact, isActive, onClick, onDoubleClick, initials, offline = false }: { 
  contact: Contact; 
  isActive: boolean; 
  onClick: () => void; 
  onDoubleClick: () => void;
  initials: (n: string | null, u: string) => string; 
  offline?: boolean 
}) {
  const name = contact.displayName || contact.username;
  const avatarSize = 48;
  const textRadius = 28;

  return (
    <div className="relative cursor-pointer" style={{ width: avatarSize, height: avatarSize }} onClick={onClick} onDoubleClick={onDoubleClick}>
      <svg className="absolute inset-0 pointer-events-none" style={{ width: avatarSize, height: avatarSize }} viewBox={`0 0 ${avatarSize} ${avatarSize}`}>
        <defs>
          <path id={`textcircle-${contact.id}`} d={`M ${avatarSize/2}, ${avatarSize/2} m -${textRadius}, 0 a ${textRadius},${textRadius} 0 1,1 ${textRadius*2},0 a ${textRadius},${textRadius} 0 1,1 -${textRadius*2},0`} />
        </defs>
        <text className={offline ? 'fill-gray-500' : 'fill-purple-300'} style={{ fontSize: '5px', fontFamily: 'system-ui, sans-serif', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          <textPath href={`#textcircle-${contact.id}`}>
            <animateTransform attributeName="transform" type="rotate" from={`0 ${avatarSize/2} ${avatarSize/2}`} to={`360 ${avatarSize/2} ${avatarSize/2}`} dur="8s" repeatCount="indefinite" />
            {name}
          </textPath>
        </text>
      </svg>

      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full overflow-hidden ${isActive ? 'ring-2 ring-purple-500' : ''} ${offline ? 'opacity-50' : ''}`}>
        <Avatar className="w-9 h-9">
          <AvatarFallback className={`${offline ? 'bg-gray-700 text-gray-400' : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white'} text-xs font-medium`}>
            {initials(contact.displayName, contact.username)}
          </AvatarFallback>
        </Avatar>
      </div>

      {!offline && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[#0f0f14]" />}

      {(contact.unreadCount || 0) > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 bg-purple-500 text-white text-[10px] rounded-full flex items-center justify-center font-medium">
          {contact.unreadCount}
        </span>
      )}
    </div>
  );
}

// Channel Button
function ChannelButton({ channel, isActive, onClick }: { channel: Channel; isActive: boolean; onClick: () => void }) {
  const [showName, setShowName] = useState(false);

  return (
    <div className="relative">
      <motion.button onMouseEnter={() => setShowName(true)} onMouseLeave={() => setShowName(false)} onClick={onClick} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} className={`w-12 h-12 rounded-xl flex items-center justify-center text-sm font-medium transition-colors ${isActive ? 'bg-purple-500/20 text-purple-400 ring-2 ring-purple-500' : 'bg-[#1a1a24] text-gray-400 hover:text-white'}`}>
        <Hash className="w-5 h-5" />
      </motion.button>

      <AnimatePresence>
        {showName && (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap z-50">
            <div className="bg-[#1a1a24] text-white text-sm px-3 py-1.5 rounded-lg shadow-xl border border-white/5">{channel.name}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
