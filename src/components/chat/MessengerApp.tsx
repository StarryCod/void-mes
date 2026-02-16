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
  Plus, MessageSquare, Hash, X, Check, LogOut, Settings,
  Phone, Video, MoreVertical, Mic, Send,
  Image as ImageIcon, FileText, Sparkles, Play, Pause,
  Trash2, Eraser, Users, Search, Home, Bell
} from 'lucide-react';

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
  const [showProfile, setShowProfile] = useState<Contact | null>(null);
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
  const [voiceProgress, setVoiceProgress] = useState(0);
  
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
        // Check if message already exists
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
    if ((!newMessage.trim() && attachments.length === 0) || !activeTarget || !user) return;

    setIsSending(true);
    const content = newMessage.trim();

    try {
      // Upload attachments first
      const uploadedAttachments = [];
      for (const att of attachments) {
        // For now, use the old upload API
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
    if (!blob || !activeTarget || !user) return;

    try {
      // Upload voice
      const voiceFile = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', voiceFile);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const uploaded = await res.json();

      // Send via Appwrite
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
      <div className="fixed inset-0 flex items-center justify-center bg-[#313338]">
        <VoidLogo size="xl" />
      </div>
    );
  }

  if (!user) return <AuthForm onSuccess={() => {}} />;

  return (
    <div className="fixed inset-0 flex bg-[#313338]">
      {/* DISCORD-STYLE SERVERS BAR - Only on desktop */}
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 shrink-0 hidden md:flex">
        {/* Home */}
        <button
          onClick={() => { setActiveChat(null); setActiveChannel(null); setActiveView('dms'); }}
          className={`w-12 h-12 rounded-2xl hover:rounded-xl transition-all duration-200 flex items-center justify-center ${activeView === 'dms' && !activeTarget ? 'bg-[#5865f2] rounded-xl' : 'bg-[#36393f] hover:bg-[#5865f2]'}`}
        >
          <VoidLogo size="sm" />
        </button>
        
        <div className="w-8 h-0.5 bg-[#35363c] rounded-full my-1" />
        
        {/* Channels */}
        {channels.slice(0, 5).map(ch => (
          <button
            key={ch.id}
            onClick={() => setActiveChannel(ch)}
            className={`w-12 h-12 rounded-2xl hover:rounded-xl transition-all duration-200 flex items-center justify-center text-white font-semibold ${activeChannel?.id === ch.id ? 'bg-[#5865f2] rounded-xl' : 'bg-[#36393f] hover:bg-[#5865f2]'}`}
          >
            {ch.name[0].toUpperCase()}
          </button>
        ))}
        
        {/* Add channel */}
        <button
          onClick={() => setShowAddModal(true)}
          className="w-12 h-12 rounded-2xl hover:rounded-xl transition-all duration-200 bg-[#36393f] hover:bg-[#5865f2] flex items-center justify-center text-green-500 hover:text-white"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* SIDEBAR - Contacts/Channels list */}
      <div className={`${activeTarget ? 'hidden md:flex' : 'flex'} w-full md:w-60 bg-[#2b2d31] flex-col shrink-0`}>
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-black/20">
          <span className="text-white font-semibold text-sm">
            {activeView === 'dms' ? 'Личные сообщения' : 'Каналы'}
          </span>
          <button
            onClick={() => activeView === 'dms' ? setShowAddModal(true) : null}
            className="w-6 h-6 rounded hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-2">
          <div className="bg-[#1e1f22] rounded flex items-center px-2 h-8">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Найти"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-white text-sm outline-none px-2 placeholder-gray-500"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-2 gap-1">
          <button
            onClick={() => setActiveView('dms')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeView === 'dms' ? 'bg-[#404249] text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            ЛС
          </button>
          <button
            onClick={() => setActiveView('channels')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeView === 'channels' ? 'bg-[#404249] text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Каналы
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto pt-2">
          {activeView === 'dms' ? (
            <div className="px-2">
              {onlineContacts.length === 0 && offlineContacts.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-xs">
                  Нет контактов
                </div>
              ) : (
                <>
                  {onlineContacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChat(c)}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded transition-colors ${activeChat?.id === c.id ? 'bg-[#404249]' : 'hover:bg-[#35373c]'}`}
                    >
                      <div className="relative">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="bg-[#5865f2] text-white text-xs">
                            {initials(c.displayName, c.username)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#2b2d31]" />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-white text-sm font-medium truncate">{c.displayName || c.username}</p>
                      </div>
                    </button>
                  ))}
                  {offlineContacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChat(c)}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded transition-colors ${activeChat?.id === c.id ? 'bg-[#404249]' : 'hover:bg-[#35373c]'}`}
                    >
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-[#36393f] text-gray-400 text-xs">
                          {initials(c.displayName, c.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-gray-400 text-sm truncate">{c.displayName || c.username}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="px-2">
              {channels.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-xs">
                  Нет каналов
                </div>
              ) : (
                channels.map(ch => (
                  <button
                    key={ch.id}
                    onClick={() => setActiveChannel(ch)}
                    className={`w-full flex items-center gap-3 px-2 py-2 rounded transition-colors ${activeChannel?.id === ch.id ? 'bg-[#404249]' : 'hover:bg-[#35373c]'}`}
                  >
                    <Hash className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-300 text-sm font-medium truncate">{ch.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* User panel */}
        <div className="h-[52px] px-2 flex items-center gap-2 bg-[#232428]">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="bg-[#5865f2] text-white text-xs">
              {initials(user?.displayName || null, user?.username || '')}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.displayName || user?.username}</p>
            <p className="text-gray-500 text-xs truncate">#{user?.username?.slice(0, 4)}</p>
          </div>
          <button onClick={() => setShowSettings(true)} className="w-8 h-8 rounded hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* CHAT AREA */}
      <div className={`${activeTarget ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-[#313338]`}>
        {/* Header */}
        {activeTarget && (
          <div className="h-12 px-4 flex items-center gap-3 border-b border-black/20 shrink-0">
            {/* Back for mobile */}
            <button
              onClick={() => { setActiveChat(null); setActiveChannel(null); }}
              className="w-8 h-8 rounded hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white md:hidden"
            >
              <X className="w-5 h-5" />
            </button>
            
            {isChannel ? (
              <Hash className="w-6 h-6 text-gray-400" />
            ) : (
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-[#5865f2] text-white text-xs">
                  {initials(activeTarget.displayName, activeTarget.username)}
                </AvatarFallback>
              </Avatar>
            )}
            
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold text-sm truncate">
                {isChannel ? activeTarget.name : (activeTarget.displayName || activeTarget.username)}
              </h3>
              {!isChannel && (
                <p className="text-xs text-gray-500">
                  {(activeTarget as Contact).isOnline ? (
                    <span className="text-green-500">В сети</span>
                  ) : 'Не в сети'}
                </p>
              )}
            </div>

            <button className="w-8 h-8 rounded hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white">
              <Phone className="w-5 h-5" />
            </button>
            <button className="w-8 h-8 rounded hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white">
              <Video className="w-5 h-5" />
            </button>
            <div className="relative" ref={menuRef}>
              <button onClick={() => setShowMenu(!showMenu)} className="w-8 h-8 rounded hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white">
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-[#111214] rounded-lg shadow-xl overflow-hidden z-50">
                  <button onClick={() => { setShowDeleteConfirm('clear'); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-gray-300 text-sm hover:bg-white/5 flex items-center gap-2">
                    <Eraser className="w-4 h-4" /> Очистить
                  </button>
                  <button onClick={() => { setShowDeleteConfirm('delete'); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-red-400 text-sm hover:bg-red-500/10 flex items-center gap-2">
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
              <div className="w-24 h-24 rounded-full bg-[#5865f2] flex items-center justify-center mb-4">
                <MessageSquare className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-white text-2xl font-bold mb-2">Добро пожаловать!</h2>
              <p className="text-gray-400 text-center max-w-sm">Выберите чат или создайте новый, чтобы начать общение</p>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-8">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-8 h-8 border-2 border-[#5865f2] border-t-transparent rounded-full" />
            </div>
          ) : safeMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Sparkles className="w-12 h-12 text-[#5865f2] mb-4" />
              <p className="text-gray-400">Начните диалог!</p>
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
                        <AvatarFallback className={isOwn ? 'bg-[#5865f2]' : 'bg-[#36393f]'} text-white text-sm>
                          {isOwn ? initials(user?.displayName || null, user?.username || '') : initials(activeTarget?.displayName || null, activeTarget?.username || '')}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className="w-10" />
                    )}
                    <div className="flex-1 min-w-0">
                      {showHeader && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-white font-medium text-sm">
                            {isOwn ? (user?.displayName || user?.username) : (activeTarget?.displayName || activeTarget?.username)}
                          </span>
                          <span className="text-[10px] text-gray-500">{formatMsgTime(msg.createdAt)}</span>
                        </div>
                      )}
                      {msg.isVoice ? (
                        <div className="flex items-center gap-2 bg-[#2b2d31] rounded-full px-3 py-1.5 w-fit">
                          <button onClick={() => playVoiceMessage(msg.id, msg.voiceUrl || undefined)} className="w-6 h-6 rounded-full bg-[#5865f2] flex items-center justify-center">
                            {playingVoiceId === msg.id ? <Pause className="w-3 h-3 text-white" /> : <Play className="w-3 h-3 text-white ml-0.5" />}
                          </button>
                          <span className="text-gray-300 text-xs">{formatTime(msg.voiceDuration || 0)}</span>
                        </div>
                      ) : (
                        <>
                          {msg.content && <p className="text-gray-200 text-sm">{msg.content}</p>}
                          {msg.attachments?.map((att: any, i: number) => (
                            att.type === 'image' ? (
                              <img key={i} src={att.url} alt="" className="max-w-[300px] rounded-lg mt-1" />
                            ) : (
                              <a key={i} href={att.url} download={att.name} className="flex items-center gap-2 px-3 py-2 bg-[#2b2d31] rounded-lg mt-1 text-sm text-[#00a8fc] hover:underline">
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

        {/* Input */}
        {activeTarget && (
          <div className="p-4">
            {isRecording ? (
              <div className="flex items-center gap-3 bg-[#2b2d31] rounded-lg px-4 py-3">
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="w-3 h-3 bg-red-500 rounded-full" />
                <span className="text-white text-sm flex-1 font-mono">{formatTime(recordingTime)}</span>
                <button onClick={sendVoiceMessage} className="px-4 py-1.5 bg-[#5865f2] hover:bg-[#4752c4] text-white rounded text-sm font-medium">Отправить</button>
                <button onClick={() => { stopRecording(); setRecordingTime(0); }} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <form onSubmit={sendMessage} className="flex items-end gap-2">
                <button type="button" onClick={() => setShowAttach(!showAttach)} className="w-10 h-10 rounded-full bg-[#2b2d31] hover:bg-[#36393f] flex items-center justify-center text-gray-400 hover:text-white shrink-0">
                  <Plus className="w-5 h-5" />
                </button>
                {showAttach && (
                  <div className="absolute bottom-16 left-4 bg-[#2b2d31] rounded-lg shadow-xl overflow-hidden w-40">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full px-3 py-2 flex items-center gap-2 text-gray-300 text-sm hover:bg-white/5">
                      <ImageIcon className="w-4 h-4 text-blue-400" /> Фото
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full px-3 py-2 flex items-center gap-2 text-gray-300 text-sm hover:bg-white/5">
                      <FileText className="w-4 h-4 text-green-400" /> Файл
                    </button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    Array.from(files).forEach(file => {
                      const isImage = file.type.startsWith('image/');
                      setAttachments(prev => [...prev, { file, preview: isImage ? URL.createObjectURL(file) : null, type: isImage ? 'image' : 'file' }]);
                    });
                  }
                  e.target.value = '';
                }} />
                <div className="flex-1 bg-[#383a40] rounded-lg flex items-end">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder={`Написать ${isChannel ? activeTarget.name : (activeTarget as Contact)?.displayName || (activeTarget as Contact)?.username}...`}
                    className="flex-1 bg-transparent text-white placeholder-gray-500 px-4 py-2.5 outline-none text-sm min-w-0"
                    disabled={isSending}
                  />
                </div>
                {newMessage.trim() || attachments.length > 0 ? (
                  <button type="submit" disabled={isSending} className="w-10 h-10 rounded-full bg-[#5865f2] hover:bg-[#4752c4] flex items-center justify-center text-white shrink-0 disabled:opacity-50">
                    {isSending ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Send className="w-4 h-4" />}
                  </button>
                ) : (
                  <button type="button" onClick={startRecording} className="w-10 h-10 rounded-full bg-[#2b2d31] hover:bg-[#36393f] flex items-center justify-center text-gray-400 hover:text-white shrink-0">
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </form>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAddModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="bg-[#313338] rounded-lg w-full max-w-md p-4">
              <h2 className="text-white text-xl font-bold mb-4">Добавить друга</h2>
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
                className="w-full bg-[#1e1f22] text-white rounded px-4 py-2 outline-none focus:ring-2 focus:ring-[#5865f2]"
              />
              <div className="mt-4 max-h-48 overflow-y-auto">
                {isSearching ? <div className="text-center text-gray-400">Поиск...</div> : searchResults.map(u => (
                  <div key={u.id} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded">
                    <Avatar className="w-8 h-8"><AvatarFallback className="bg-[#5865f2] text-white text-xs">{initials(u.displayName, u.username)}</AvatarFallback></Avatar>
                    <div className="flex-1"><p className="text-white text-sm">{u.displayName || u.username}</p><p className="text-gray-500 text-xs">@{u.username}</p></div>
                    <button onClick={async () => {
                      await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: u.username }) });
                      fetchContacts();
                    }} className="px-3 py-1 bg-[#5865f2] hover:bg-[#4752c4] text-white rounded text-sm">Добавить</button>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}

        {showSettings && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowSettings(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="bg-[#313338] rounded-lg w-full max-w-md p-4">
              <h2 className="text-white text-xl font-bold mb-4">Настройки</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-xs">Имя</label>
                  <input defaultValue={user?.displayName || ''} className="w-full bg-[#1e1f22] text-white rounded px-4 py-2 mt-1 outline-none" />
                </div>
                <button onClick={logout} className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded">Выйти</button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowDeleteConfirm(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={e => e.stopPropagation()} className="bg-[#313338] rounded-lg w-full max-w-sm p-4 text-center">
              <h2 className="text-white text-xl font-bold mb-2">{showDeleteConfirm === 'delete' ? 'Удалить чат?' : 'Очистить историю?'}</h2>
              <p className="text-gray-400 text-sm mb-4">Это действие нельзя отменить</p>
              <div className="flex gap-2">
                <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2 bg-[#2b2d31] hover:bg-[#36393f] text-white rounded">Отмена</button>
                <button onClick={() => setShowDeleteConfirm(null)} className={`flex-1 py-2 rounded text-white ${showDeleteConfirm === 'delete' ? 'bg-red-500 hover:bg-red-600' : 'bg-[#5865f2] hover:bg-[#4752c4]'}`}>
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
