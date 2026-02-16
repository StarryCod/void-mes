'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuthStore } from '@/store/auth';
import { useChatStore, Contact, Channel, Message } from '@/store/chat';
import { AuthForm } from '@/components/auth/AuthForm';
import { VoidLogo } from '@/components/common/VoidLogo';
import { CallManager } from '@/components/call/CallManager';
import { useToast } from '@/hooks/use-toast';
import { getMessageService, DecryptedMessage } from '@/lib/appwrite-messages';
import {
  Plus, MessageSquare, Hash, X, LogOut, Settings,
  Phone, Video, MoreVertical, Mic, Send,
  Image as ImageIcon, FileText, Sparkles, Play, Pause,
  Trash2, Eraser, Users, Search, Home, Bell,
  ChevronLeft, Menu
} from 'lucide-react';

// Void-mes color palette (neutral dark theme)
const colors = {
  bg: '#0f0f0f',
  sidebar: '#1a1a1a',
  card: '#262626',
  input: '#1f1f1f',
  accent: '#7c3aed',
  accentHover: '#6d28d9',
  online: '#22c55e',
  text: '#ffffff',
  textMuted: '#a1a1aa',
  border: '#2a2a2a',
};

export function MessengerApp() {
  const { user, token, setUser, logout } = useAuthStore();
  const { 
    contacts, setContacts, activeChat, setActiveChat,
    channels, setChannels, activeChannel, setActiveChannel,
    activeView, setActiveView, addContact, addChannel,
    messages, setMessages, addMessage
  } = useChatStore();
  const { toast } = useToast();

  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [attachments, setAttachments] = useState<{file: File, preview: string | null, type: 'image' | 'file'}[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<'clear' | 'delete' | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'dms' | 'channels' | 'settings'>('dms');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const messageService = getMessageService();

  const safeMessages = Array.isArray(messages) ? messages : [];
  const activeTarget = activeChat || activeChannel;
  const isChannel = !!activeChannel;
  const onlineContacts = (contacts || []).filter(c => c.isOnline);
  const offlineContacts = (contacts || []).filter(c => !c.isOnline);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (token) {
      fetchContacts();
      fetchChannels();
    }
  }, [token]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load messages from Appwrite
  useEffect(() => {
    if (activeTarget && user) {
      loadMessages();
    }
  }, [activeTarget?.id, user]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!user) return;
    
    const unsubscribe = messageService.subscribeToChat(
      user.id,
      activeChat?.id || null,
      activeChannel?.id || null,
      (msg: DecryptedMessage) => {
        const current = useChatStore.getState().messages || [];
        if (!current.find((m: Message) => m.id === msg.id)) {
          addMessage({
            id: msg.id,
            content: msg.content,
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            channelId: msg.channelId,
            isRead: false,
            readAt: null,
            createdAt: msg.createdAt,
            isVoice: msg.isVoice,
            voiceDuration: msg.voiceDuration,
            voiceUrl: msg.voiceUrl,
            replyToId: msg.replyToId,
            attachments: msg.attachments,
          });
        }
      }
    );

    return () => unsubscribe();
  }, [user?.id, activeChat?.id, activeChannel?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [safeMessages.length]);

  const checkAuth = async () => {
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
  };

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

  const loadMessages = async () => {
    if (!user || !activeTarget) return;
    setIsLoading(true);
    try {
      const msgs = await messageService.getMessages(
        user.id,
        activeChat?.id || null,
        activeChannel?.id || null
      );
      setMessages(msgs.map(m => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        receiverId: m.receiverId,
        channelId: m.channelId,
        isRead: true,
        readAt: null,
        createdAt: m.createdAt,
        isVoice: m.isVoice,
        voiceDuration: m.voiceDuration,
        voiceUrl: m.voiceUrl,
        replyToId: m.replyToId,
        attachments: m.attachments,
      })));
    } catch (e) {
      console.error('Load messages error:', e);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !activeTarget || !user || !token) return;

    setIsSending(true);
    const content = newMessage.trim();

    try {
      // Upload attachments first
      const uploadedAttachments = [];
      for (const att of attachments) {
        const formData = new FormData();
        formData.append('file', att.file);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          uploadedAttachments.push(data);
        }
      }

      // Send via Appwrite
      const msg = await messageService.sendMessage(
        user.id,
        activeChat?.id || null,
        activeChannel?.id || null,
        content || ' ',
        {
          attachments: uploadedAttachments,
          replyToId: replyTo?.id,
        }
      );

      // Add to local state
      addMessage({
        id: msg.id,
        content: msg.content,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        channelId: msg.channelId,
        isRead: false,
        readAt: null,
        createdAt: msg.createdAt,
        isVoice: msg.isVoice,
        voiceDuration: msg.voiceDuration,
        voiceUrl: msg.voiceUrl,
        replyToId: msg.replyToId,
        attachments: msg.attachments,
      });

      setNewMessage('');
      setReplyTo(null);
      setAttachments([]);
      setShowAttach(false);
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

  const sendVoiceMessage = async () => {
    const blob = await stopRecording();
    if (!blob || !activeTarget || !user || !token) return;

    try {
      const voiceFile = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', voiceFile);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploaded = await res.json();

      const msg = await messageService.sendMessage(
        user.id,
        activeChat?.id || null,
        activeChannel?.id || null,
        'Голосовое сообщение',
        {
          isVoice: true,
          voiceDuration: recordingTime,
          voiceUrl: uploaded.url,
        }
      );

      addMessage({
        id: msg.id,
        content: msg.content,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        channelId: msg.channelId,
        isRead: false,
        readAt: null,
        createdAt: msg.createdAt,
        isVoice: true,
        voiceDuration: recordingTime,
        voiceUrl: uploaded.url,
        attachments: [],
      });
    } catch (e) {
      console.error('Voice send error:', e);
    }
    setRecordingTime(0);
  };

  const playVoiceMessage = (msgId: string, url?: string) => {
    if (!url) return;
    if (playingVoiceId === msgId) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audio.onended = () => setPlayingVoiceId(null);
      audio.play();
      audioRef.current = audio;
      setPlayingVoiceId(msgId);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatMsgTime = (d: string) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const initials = (n: string | null, u: string) => (n?.[0] || u?.[0] || '?').toUpperCase();

  if (isCheckingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ backgroundColor: colors.bg }}>
        <VoidLogo size="xl" />
      </div>
    );
  }

  if (!user) return <AuthForm onSuccess={() => {}} />;

  // MOBILE VIEW with Discord-like layout
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ backgroundColor: colors.bg }}>
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* DESKTOP SIDEBAR - hidden on mobile */}
        <div className="hidden md:flex w-64 flex-col shrink-0" style={{ backgroundColor: colors.sidebar }}>
          {/* Header */}
          <div className="h-14 px-4 flex items-center justify-between border-b" style={{ borderColor: colors.border }}>
            <span className="font-semibold text-sm" style={{ color: colors.text }}>
              void-mes
            </span>
            <button
              onClick={() => setShowAddModal(true)}
              className="w-7 h-7 rounded flex items-center justify-center transition-colors"
              style={{ color: colors.textMuted }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className="p-3">
            <div className="rounded flex items-center px-3 h-9" style={{ backgroundColor: colors.input }}>
              <Search className="w-4 h-4" style={{ color: colors.textMuted }} />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none px-2"
                style={{ color: colors.text }}
              />
            </div>
          </div>

          {/* DMs Section */}
          <div className="px-3 mb-2">
            <span className="text-xs font-medium px-2" style={{ color: colors.textMuted }}>ЛИЧНЫЕ СООБЩЕНИЯ</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {onlineContacts.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveChat(c)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded transition-colors"
                style={{ 
                  backgroundColor: activeChat?.id === c.id ? colors.card : 'transparent',
                }}
              >
                <div className="relative">
                  <Avatar className="w-9 h-9">
                    <AvatarFallback className="text-white text-xs" style={{ backgroundColor: colors.accent }}>
                      {initials(c.displayName, c.username)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{ backgroundColor: colors.online, borderColor: colors.sidebar }} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: colors.text }}>{c.displayName || c.username}</p>
                </div>
              </button>
            ))}
            {offlineContacts.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveChat(c)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded transition-colors"
                style={{ backgroundColor: activeChat?.id === c.id ? colors.card : 'transparent' }}
              >
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="text-xs" style={{ backgroundColor: colors.card, color: colors.textMuted }}>
                    {initials(c.displayName, c.username)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-sm truncate" style={{ color: colors.textMuted }}>{c.displayName || c.username}</p>
              </button>
            ))}
          </div>

          {/* Channels Section */}
          <div className="px-3 py-2 border-t" style={{ borderColor: colors.border }}>
            <span className="text-xs font-medium px-2" style={{ color: colors.textMuted }}>КАНАЛЫ</span>
          </div>
          <div className="px-2 pb-2 space-y-0.5">
            {channels.map(ch => (
              <button
                key={ch.id}
                onClick={() => setActiveChannel(ch)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded transition-colors"
                style={{ backgroundColor: activeChannel?.id === ch.id ? colors.card : 'transparent' }}
              >
                <Hash className="w-5 h-5" style={{ color: colors.textMuted }} />
                <span className="text-sm truncate" style={{ color: colors.text }}>{ch.name}</span>
              </button>
            ))}
          </div>

          {/* User panel */}
          <div className="h-14 px-3 flex items-center gap-3 border-t" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
            <Avatar className="w-9 h-9">
              <AvatarFallback className="text-white text-xs" style={{ backgroundColor: colors.accent }}>
                {initials(user?.displayName || null, user?.username || '')}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: colors.text }}>{user?.displayName || user?.username}</p>
              <p className="text-xs truncate" style={{ color: colors.textMuted }}>#{user?.username?.slice(0, 4)}</p>
            </div>
            <button onClick={() => setShowSettings(true)} className="w-8 h-8 rounded flex items-center justify-center" style={{ color: colors.textMuted }}>
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* MOBILE: Show list or chat based on activeTarget */}
        {/* DESKTOP: Always show chat area */}
        
        {/* MOBILE LIST VIEW */}
        <div className={`${activeTarget ? 'hidden' : 'flex'} md:hidden flex-1 flex-col`} style={{ backgroundColor: colors.bg }}>
          {/* Mobile header */}
          <div className="h-14 px-4 flex items-center border-b" style={{ borderColor: colors.border }}>
            <span className="font-semibold text-lg" style={{ color: colors.text }}>void-mes</span>
          </div>
          
          {/* Content based on mobile tab */}
          {mobileTab === 'dms' && (
            <div className="flex-1 overflow-y-auto">
              {onlineContacts.length === 0 && offlineContacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-4">
                  <MessageSquare className="w-12 h-12 mb-4" style={{ color: colors.textMuted }} />
                  <p className="text-sm" style={{ color: colors.textMuted }}>Нет контактов</p>
                  <button onClick={() => setShowAddModal(true)} className="mt-3 px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: colors.accent }}>
                    Добавить друга
                  </button>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: colors.border }}>
                  {onlineContacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChat(c)}
                      className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
                      style={{ backgroundColor: 'transparent' }}
                    >
                      <div className="relative">
                        <Avatar className="w-12 h-12">
                          <AvatarFallback className="text-white" style={{ backgroundColor: colors.accent }}>
                            {initials(c.displayName, c.username)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2" style={{ backgroundColor: colors.online, borderColor: colors.bg }} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium truncate" style={{ color: colors.text }}>{c.displayName || c.username}</p>
                        <p className="text-xs" style={{ color: colors.online }}>В сети</p>
                      </div>
                    </button>
                  ))}
                  {offlineContacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChat(c)}
                      className="w-full flex items-center gap-3 px-4 py-3 transition-colors"
                    >
                      <Avatar className="w-12 h-12">
                        <AvatarFallback style={{ backgroundColor: colors.card, color: colors.textMuted }}>
                          {initials(c.displayName, c.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium truncate" style={{ color: colors.textMuted }}>{c.displayName || c.username}</p>
                        <p className="text-xs" style={{ color: colors.textMuted }}>Не в сети</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {mobileTab === 'channels' && (
            <div className="flex-1 overflow-y-auto">
              {channels.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-4">
                  <Hash className="w-12 h-12 mb-4" style={{ color: colors.textMuted }} />
                  <p className="text-sm" style={{ color: colors.textMuted }}>Нет каналов</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: colors.border }}>
                  {channels.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannel(ch)}
                      className="w-full flex items-center gap-3 px-4 py-3"
                    >
                      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.card }}>
                        <Hash className="w-6 h-6" style={{ color: colors.textMuted }} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium truncate" style={{ color: colors.text }}>{ch.name}</p>
                        <p className="text-xs" style={{ color: colors.textMuted }}>Канал</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {mobileTab === 'settings' && (
            <div className="flex-1 p-4">
              <div className="flex flex-col items-center py-6">
                <Avatar className="w-20 h-20 mb-4">
                  <AvatarFallback className="text-2xl text-white" style={{ backgroundColor: colors.accent }}>
                    {initials(user?.displayName || null, user?.username || '')}
                  </AvatarFallback>
                </Avatar>
                <p className="text-lg font-semibold" style={{ color: colors.text }}>{user?.displayName || user?.username}</p>
                <p className="text-sm" style={{ color: colors.textMuted }}>@{user?.username}</p>
              </div>
              <div className="space-y-2 mt-4">
                <button onClick={() => setShowSettings(true)} className="w-full py-3 rounded-lg text-left px-4" style={{ backgroundColor: colors.card, color: colors.text }}>
                  Настройки профиля
                </button>
                <button onClick={logout} className="w-full py-3 rounded-lg text-left px-4 text-red-500" style={{ backgroundColor: colors.card }}>
                  Выйти
                </button>
              </div>
            </div>
          )}
          
          {/* MOBILE BOTTOM TAB BAR - Discord style */}
          <div className="h-16 flex border-t" style={{ backgroundColor: colors.sidebar, borderColor: colors.border }}>
            <button onClick={() => setMobileTab('dms')} className="flex-1 flex flex-col items-center justify-center gap-1">
              <MessageSquare className="w-5 h-5" style={{ color: mobileTab === 'dms' ? colors.accent : colors.textMuted }} />
              <span className="text-xs" style={{ color: mobileTab === 'dms' ? colors.accent : colors.textMuted }}>Чаты</span>
            </button>
            <button onClick={() => setMobileTab('channels')} className="flex-1 flex flex-col items-center justify-center gap-1">
              <Hash className="w-5 h-5" style={{ color: mobileTab === 'channels' ? colors.accent : colors.textMuted }} />
              <span className="text-xs" style={{ color: mobileTab === 'channels' ? colors.accent : colors.textMuted }}>Каналы</span>
            </button>
            <button onClick={() => setMobileTab('settings')} className="flex-1 flex flex-col items-center justify-center gap-1">
              <Settings className="w-5 h-5" style={{ color: mobileTab === 'settings' ? colors.accent : colors.textMuted }} />
              <span className="text-xs" style={{ color: mobileTab === 'settings' ? colors.accent : colors.textMuted }}>Профиль</span>
            </button>
          </div>
        </div>

        {/* CHAT AREA - Mobile: only show when activeTarget, Desktop: always show */}
        <div className={`${activeTarget ? 'flex' : 'hidden md:flex'} flex-1 flex-col`} style={{ backgroundColor: colors.bg }}>
          {/* Header */}
          {activeTarget && (
            <div className="h-14 px-4 flex items-center gap-3 border-b shrink-0" style={{ borderColor: colors.border }}>
              {/* Back for mobile */}
              <button
                onClick={() => { setActiveChat(null); setActiveChannel(null); }}
                className="w-8 h-8 rounded-full flex items-center justify-center md:hidden"
                style={{ backgroundColor: colors.card, color: colors.text }}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              
              {isChannel ? (
                <Hash className="w-6 h-6" style={{ color: colors.textMuted }} />
              ) : (
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="text-white text-sm" style={{ backgroundColor: colors.accent }}>
                    {initials(activeTarget.displayName, activeTarget.username)}
                  </AvatarFallback>
                </Avatar>
              )}
              
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate" style={{ color: colors.text }}>
                  {isChannel ? activeTarget.name : (activeTarget.displayName || activeTarget.username)}
                </h3>
                {!isChannel && (
                  <p className="text-xs" style={{ color: (activeTarget as Contact).isOnline ? colors.online : colors.textMuted }}>
                    {(activeTarget as Contact).isOnline ? 'В сети' : 'Не в сети'}
                  </p>
                )}
              </div>

              <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ color: colors.textMuted }}>
                <Phone className="w-5 h-5" />
              </button>
              <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ color: colors.textMuted }}>
                <Video className="w-5 h-5" />
              </button>
              <div className="relative" ref={menuRef}>
                <button onClick={() => setShowMenu(!showMenu)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ color: colors.textMuted }}>
                  <MoreVertical className="w-5 h-5" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-lg shadow-xl overflow-hidden z-50" style={{ backgroundColor: colors.card }}>
                    <button onClick={() => { setShowDeleteConfirm('clear'); setShowMenu(false); }} className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2" style={{ color: colors.text }}>
                      <Eraser className="w-4 h-4" /> Очистить
                    </button>
                    <button onClick={() => { setShowDeleteConfirm('delete'); setShowMenu(false); }} className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 text-red-400">
                      <Trash2 className="w-4 h-4" /> Удалить
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
            {!activeTarget ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: colors.accent }}>
                  <MessageSquare className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-xl font-bold mb-2" style={{ color: colors.text }}>Добро пожаловать!</h2>
                <p className="text-center max-w-sm" style={{ color: colors.textMuted }}>Выберите чат или создайте новый</p>
              </div>
            ) : isLoading ? (
              <div className="flex justify-center py-8">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-8 h-8 border-2 rounded-full" style={{ borderColor: colors.accent, borderTopColor: 'transparent' }} />
              </div>
            ) : safeMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Sparkles className="w-12 h-12 mb-4" style={{ color: colors.accent }} />
                <p style={{ color: colors.textMuted }}>Начните диалог!</p>
              </div>
            ) : (
              <div className="space-y-1">
                {safeMessages.map((msg, idx) => {
                  const isOwn = msg.senderId === user?.id;
                  const prevMsg = safeMessages[idx - 1];
                  const showHeader = !prevMsg || prevMsg.senderId !== msg.senderId;
                  
                  return (
                    <div key={msg.id} className={`flex gap-3 ${showHeader ? 'mt-4' : ''}`}>
                      {showHeader ? (
                        <Avatar className="w-10 h-10 mt-0.5">
                          <AvatarFallback className="text-white text-sm" style={{ backgroundColor: isOwn ? colors.accent : colors.card }}>
                            {isOwn ? initials(user?.displayName || null, user?.username || '') : initials(activeTarget?.displayName || null, activeTarget?.username || '')}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <div className="w-10" />
                      )}
                      <div className="flex-1 min-w-0">
                        {showHeader && (
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="font-medium text-sm" style={{ color: colors.text }}>
                              {isOwn ? (user?.displayName || user?.username) : (activeTarget?.displayName || activeTarget?.username)}
                            </span>
                            <span className="text-xs" style={{ color: colors.textMuted }}>{formatMsgTime(msg.createdAt)}</span>
                          </div>
                        )}
                        {msg.isVoice ? (
                          <div className="flex items-center gap-2 rounded-full px-3 py-1.5 w-fit" style={{ backgroundColor: colors.card }}>
                            <button onClick={() => playVoiceMessage(msg.id, msg.voiceUrl || undefined)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.accent }}>
                              {playingVoiceId === msg.id ? <Pause className="w-3.5 h-3.5 text-white" /> : <Play className="w-3.5 h-3.5 text-white ml-0.5" />}
                            </button>
                            <span className="text-sm" style={{ color: colors.text }}>{formatTime(msg.voiceDuration || 0)}</span>
                          </div>
                        ) : (
                          <>
                            {msg.content && <p className="text-sm" style={{ color: colors.text }}>{msg.content}</p>}
                            {msg.attachments?.map((att: any, i: number) => (
                              att.type === 'image' ? (
                                <img key={i} src={att.url} alt="" className="max-w-[280px] rounded-lg mt-1" />
                              ) : (
                                <a key={i} href={att.url} download={att.name} className="flex items-center gap-2 px-3 py-2 rounded-lg mt-1 text-sm" style={{ backgroundColor: colors.card, color: colors.accent }}>
                                  <FileText className="w-4 h-4" /> {att.name}
                                </a>
                              )
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Input - Discord mobile style: floating at bottom */}
          {activeTarget && (
            <div className="p-3 border-t" style={{ borderColor: colors.border, backgroundColor: colors.bg }}>
              {isRecording ? (
                <div className="flex items-center gap-3 rounded-full px-4 py-3" style={{ backgroundColor: colors.card }}>
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="w-3 h-3 bg-red-500 rounded-full" />
                  <span className="text-sm flex-1 font-mono" style={{ color: colors.text }}>{formatTime(recordingTime)}</span>
                  <button onClick={sendVoiceMessage} className="px-4 py-1.5 rounded-full text-sm font-medium text-white" style={{ backgroundColor: colors.accent }}>Отправить</button>
                  <button onClick={() => { stopRecording(); setRecordingTime(0); }} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: colors.input, color: colors.textMuted }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <form onSubmit={sendMessage} className="flex items-end gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: colors.card, color: colors.textMuted }}>
                    <Plus className="w-5 h-5" />
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt" onChange={(e) => {
                    const files = e.target.files;
                    if (files) {
                      Array.from(files).forEach(file => {
                        const isImage = file.type.startsWith('image/');
                        setAttachments(prev => [...prev, { file, preview: isImage ? URL.createObjectURL(file) : null, type: isImage ? 'image' : 'file' }]);
                      });
                    }
                    e.target.value = '';
                  }} />
                  <div className="flex-1 rounded-full flex items-center" style={{ backgroundColor: colors.card }}>
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Сообщение..."
                      className="flex-1 bg-transparent px-4 py-2.5 outline-none text-sm min-w-0"
                      style={{ color: colors.text }}
                      disabled={isSending}
                    />
                  </div>
                  {newMessage.trim() || attachments.length > 0 ? (
                    <button type="submit" disabled={isSending} className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-50" style={{ backgroundColor: colors.accent }}>
                      {isSending ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Send className="w-4 h-4" />}
                    </button>
                  ) : (
                    <button type="button" onClick={startRecording} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: colors.card, color: colors.textMuted }}>
                      <Mic className="w-5 h-5" />
                    </button>
                  )}
                </form>
              )}
              {attachments.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {attachments.map((att, i) => (
                    <div key={i} className="relative shrink-0">
                      {att.type === 'image' && att.preview ? (
                        <img src={att.preview} alt="" className="w-16 h-16 object-cover rounded-lg" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg flex items-center justify-center" style={{ backgroundColor: colors.card }}>
                          <FileText className="w-6 h-6" style={{ color: colors.textMuted }} />
                        </div>
                      )}
                      <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }} onClick={() => setShowAddModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="rounded-xl w-full max-w-md p-5" style={{ backgroundColor: colors.sidebar }}>
              <h2 className="text-xl font-bold mb-4" style={{ color: colors.text }}>Добавить друга</h2>
              <input
                value={searchQuery}
                onChange={async (e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.length > 2) {
                    setIsSearching(true);
                    const res = await fetch(`/api/users/search?q=${e.target.value}`, { headers: { Authorization: `Bearer ${token}` } });
                    setSearchResults((await res.json()).users || []);
                    setIsSearching(false);
                  }
                }}
                placeholder="Введите ник..."
                className="w-full rounded-lg px-4 py-3 outline-none"
                style={{ backgroundColor: colors.card, color: colors.text }}
              />
              <div className="mt-4 max-h-48 overflow-y-auto space-y-2">
                {isSearching ? (
                  <div className="text-center py-4" style={{ color: colors.textMuted }}>Поиск...</div>
                ) : searchResults.map(u => (
                  <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: colors.card }}>
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="text-white" style={{ backgroundColor: colors.accent }}>{initials(u.displayName, u.username)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium" style={{ color: colors.text }}>{u.displayName || u.username}</p>
                      <p className="text-xs" style={{ color: colors.textMuted }}>@{u.username}</p>
                    </div>
                    <button onClick={async () => {
                      await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: u.username }) });
                      fetchContacts();
                      setShowAddModal(false);
                    }} className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: colors.accent }}>Добавить</button>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}

        {showSettings && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }} onClick={() => setShowSettings(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="rounded-xl w-full max-w-md p-5" style={{ backgroundColor: colors.sidebar }}>
              <h2 className="text-xl font-bold mb-4" style={{ color: colors.text }}>Настройки</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs" style={{ color: colors.textMuted }}>Отображаемое имя</label>
                  <input defaultValue={user?.displayName || ''} className="w-full rounded-lg px-4 py-2 mt-1 outline-none" style={{ backgroundColor: colors.card, color: colors.text }} />
                </div>
                <button onClick={logout} className="w-full py-3 rounded-lg text-white bg-red-500">Выйти</button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }} onClick={() => setShowDeleteConfirm(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="rounded-xl w-full max-w-sm p-5 text-center" style={{ backgroundColor: colors.sidebar }}>
              <h2 className="text-xl font-bold mb-2" style={{ color: colors.text }}>{showDeleteConfirm === 'delete' ? 'Удалить чат?' : 'Очистить историю?'}</h2>
              <p className="text-sm mb-4" style={{ color: colors.textMuted }}>Это действие нельзя отменить</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg" style={{ backgroundColor: colors.card, color: colors.text }}>Отмена</button>
                <button onClick={() => setShowDeleteConfirm(null)} className={`flex-1 py-2.5 rounded-lg text-white ${showDeleteConfirm === 'delete' ? 'bg-red-500' : ''}`} style={{ backgroundColor: showDeleteConfirm === 'delete' ? undefined : colors.accent }}>
                  {showDeleteConfirm === 'delete' ? 'Удалить' : 'Очистить'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Call Manager */}
      {user && <CallManager userId={user.id} contacts={contacts} onCallStart={() => {}} />}
    </div>
  );
}
