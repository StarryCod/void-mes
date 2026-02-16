'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuthStore } from '@/store/auth';
import { useChatStore, Contact, Channel } from '@/store/chat';
import {
  Plus, LogOut, UserPlus, X, Users, Check, Settings, Search,
  MessageSquare, Hash
} from 'lucide-react';

interface ChannelListProps {
  onSelectChat: () => void;
  onOpenSettings: () => void;
}

interface FoundUser {
  id: string;
  username: string;
  displayName: string | null;
  isOnline: boolean;
  isContact: boolean;
}

export function ChannelList({ onSelectChat, onOpenSettings }: ChannelListProps) {
  const { user, token, logout } = useAuthStore();
  const { 
    contacts, setContacts, activeChat, setActiveChat,
    channels, setChannels, activeChannel, setActiveChannel,
    activeView, setActiveView, addContact, addChannel
  } = useChatStore();
  
  const [search, setSearch] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [results, setResults] = useState<FoundUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const timeout = useRef<NodeJS.Timeout | null>(null);

  const fetchContacts = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/contacts', { headers: { Authorization: `Bearer ${token}` } });
      setContacts((await res.json()).contacts || []);
    } catch (e) {
      console.error('Failed to fetch contacts:', e);
    }
  };

  const fetchChannels = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/channels', { headers: { Authorization: `Bearer ${token}` } });
      setChannels((await res.json()).channels || []);
    } catch (e) {
      console.error('Failed to fetch channels:', e);
    }
  };

  const searchUsers = async (q: string) => {
    if (!token) return;
    if (!q) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      const users = (await res.json()).users || [];
      setResults(users.slice(0, 8));
    } catch (e) {
      setResults([]);
    }
    setLoading(false);
  };

  useEffect(() => { 
    if (token) {
      fetchContacts();
      fetchChannels();
    }
  }, [token]);

  useEffect(() => {
    if (timeout.current) clearTimeout(timeout.current);
    if (addSearch.length >= 1 && showAddContact) {
      timeout.current = setTimeout(() => searchUsers(addSearch), 300);
    }
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [addSearch, showAddContact]);

  const addContactHandler = async (u: FoundUser) => {
    if (!token) return;
    setAdding(u.id);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: u.username }),
      });
      if (res.ok) {
        const data = await res.json();
        addContact({ ...data.contact, lastMessage: null, unreadCount: 0 });
        setResults(r => r.map(x => x.id === u.id ? { ...x, isContact: true } : x));
      }
    } catch (e) {
      console.error('Failed to add contact:', e);
    }
    setAdding(null);
  };

  const createChannel = async () => {
    if (!token || !channelName.trim()) return;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: channelName.trim(), description: channelDesc.trim() || null }),
      });
      if (res.ok) {
        const data = await res.json();
        addChannel(data.channel);
        setShowCreateChannel(false);
        setChannelName('');
        setChannelDesc('');
      }
    } catch (e) {
      console.error('Failed to create channel:', e);
    }
  };

  const selectContact = (c: Contact) => {
    setActiveChat(c);
    onSelectChat();
  };

  const selectChannel = (ch: Channel) => {
    setActiveChannel(ch);
    onSelectChat();
  };

  const filteredContacts = (contacts || []).filter(c =>
    !search || c.username?.toLowerCase().includes(search.toLowerCase()) || 
    c.displayName?.toLowerCase().includes(search.toLowerCase())
  );
  const online = filteredContacts.filter(c => c.isOnline);
  const offline = filteredContacts.filter(c => !c.isOnline);

  const filteredChannels = (channels || []).filter(ch =>
    !search || ch.name?.toLowerCase().includes(search.toLowerCase())
  );

  const initials = (n: string | null, u: string) => n?.[0]?.toUpperCase() || u?.[0]?.toUpperCase() || '?';

  return (
    <div className="flex flex-col h-full">
      {/* Header with toggle */}
      <div className="h-14 px-3 flex items-center gap-2 border-b border-white/5 shrink-0">
        <div className="flex-1 flex items-center bg-[#242430] rounded-lg p-1">
          <button
            onClick={() => setActiveView('dms')}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
              activeView === 'dms' 
                ? 'bg-purple-500 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Чаты
          </button>
          <button
            onClick={() => setActiveView('channels')}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
              activeView === 'channels' 
                ? 'bg-purple-500 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            Каналы
          </button>
        </div>
        <button 
          onClick={() => activeView === 'dms' ? setShowAddContact(true) : setShowCreateChannel(true)} 
          className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={activeView === 'dms' ? 'Поиск друзей...' : 'Поиск каналов...'}
            className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeView === 'dms' ? (
            <motion.div
              key="dms"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-2"
            >
              {filteredContacts.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-purple-400" />
                  </div>
                  <p className="text-gray-500 text-sm mb-3">Нет контактов</p>
                  <button 
                    onClick={() => setShowAddContact(true)} 
                    className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Добавить друзей
                  </button>
                </div>
              ) : (
                <>
                  {online.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-gray-500 uppercase px-2 py-1.5 font-medium">
                        Онлайн — {online.length}
                      </p>
                      {online.map(c => (
                        <ContactItem
                          key={c.id}
                          contact={c}
                          isActive={activeChat?.id === c.id}
                          onClick={() => selectContact(c)}
                          initials={initials}
                        />
                      ))}
                    </div>
                  )}
                  {offline.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase px-2 py-1.5 font-medium">
                        Оффлайн — {offline.length}
                      </p>
                      {offline.map(c => (
                        <ContactItem
                          key={c.id}
                          contact={c}
                          isActive={activeChat?.id === c.id}
                          onClick={() => selectContact(c)}
                          initials={initials}
                          offline
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="channels"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-2"
            >
              {filteredChannels.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3">
                    <Hash className="w-6 h-6 text-purple-400" />
                  </div>
                  <p className="text-gray-500 text-sm mb-3">Нет каналов</p>
                  <button 
                    onClick={() => setShowCreateChannel(true)} 
                    className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Создать канал
                  </button>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredChannels.map(ch => (
                    <ChannelItem
                      key={ch.id}
                      channel={ch}
                      isActive={activeChannel?.id === ch.id}
                      onClick={() => selectChannel(ch)}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* User bar */}
      <div className="h-14 bg-[#0f0f14] flex items-center px-3 gap-3 border-t border-white/5">
        <Avatar className="w-9 h-9">
          <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs font-medium">
            {initials(user?.displayName || null, user?.username || '')}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{user?.displayName || user?.username}</p>
          <p className="text-gray-500 text-xs">@{user?.username}</p>
        </div>
        <button 
          onClick={() => onOpenSettings()} 
          className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button 
          onClick={logout} 
          className="w-8 h-8 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Add Contact Modal */}
      <AnimatePresence>
        {showAddContact && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            onClick={() => { setShowAddContact(false); setAddSearch(''); setResults([]); }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#1a1a24] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-semibold">Добавить друга</h2>
                <button 
                  onClick={() => { setShowAddContact(false); setAddSearch(''); setResults([]); }} 
                  className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4">
                <input
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  placeholder="Введите ник пользователя..."
                  className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50"
                  autoFocus
                />
              </div>
              <div className="px-4 pb-4 max-h-60 overflow-y-auto">
                {loading ? (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : results.length === 0 && addSearch ? (
                  <p className="text-gray-500 text-center py-4 text-sm">Пользователь не найден</p>
                ) : (
                  <div className="space-y-1">
                    {results.map(u => (
                      <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                        <Avatar className="w-10 h-10">
                          <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm">
                            {initials(u.displayName, u.username)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">{u.displayName || u.username}</p>
                          <p className="text-gray-500 text-xs">@{u.username}</p>
                        </div>
                        <button
                          onClick={() => addContactHandler(u)}
                          disabled={u.isContact || adding === u.id}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            u.isContact 
                              ? 'bg-green-500/20 text-green-400 cursor-default' 
                              : 'bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-50'
                          }`}
                        >
                          {adding === u.id ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : u.isContact ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            'Добавить'
                          )}
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

      {/* Create Channel Modal */}
      <AnimatePresence>
        {showCreateChannel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setShowCreateChannel(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#1a1a24] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-white font-semibold">Создать канал</h2>
                <button 
                  onClick={() => setShowCreateChannel(false)} 
                  className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-gray-400 text-xs uppercase block mb-1.5 font-medium">Название канала</label>
                  <input
                    value={channelName}
                    onChange={e => setChannelName(e.target.value)}
                    placeholder="my-awesome-channel"
                    className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase block mb-1.5 font-medium">Описание (необязательно)</label>
                  <textarea
                    value={channelDesc}
                    onChange={e => setChannelDesc(e.target.value)}
                    placeholder="О чём этот канал..."
                    rows={3}
                    className="w-full bg-[#242430] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                  />
                </div>
                <button
                  onClick={createChannel}
                  disabled={!channelName.trim()}
                  className="w-full py-2.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Создать канал
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ContactItem({ contact, isActive, onClick, initials, offline = false }: {
  contact: Contact;
  isActive: boolean;
  onClick: () => void;
  initials: (n: string | null, u: string) => string;
  offline?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
        isActive ? 'bg-purple-500/20' : 'hover:bg-white/5'
      }`}
    >
      <div className="relative shrink-0">
        <Avatar className={`w-9 h-9 ${offline ? 'opacity-50' : ''}`}>
          <AvatarFallback className={`${offline ? 'bg-gray-700 text-gray-400' : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white'} text-xs font-medium`}>
            {initials(contact.displayName, contact.username)}
          </AvatarFallback>
        </Avatar>
        {!offline && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#1a1a24]" />
        )}
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className={`text-sm truncate ${offline ? 'text-gray-400' : 'text-white'}`}>
          {contact.displayName || contact.username}
        </p>
      </div>
      {(contact.unreadCount || 0) > 0 && (
        <span className="min-w-[18px] h-5 px-1 bg-purple-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
          {contact.unreadCount}
        </span>
      )}
    </motion.button>
  );
}

function ChannelItem({ channel, isActive, onClick }: {
  channel: Channel;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
        isActive ? 'bg-purple-500/20' : 'hover:bg-white/5'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-[#242430] flex items-center justify-center text-gray-400 shrink-0">
        <Hash className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-white text-sm truncate">{channel.name}</p>
        {channel.description && (
          <p className="text-xs text-gray-500 truncate">{channel.description}</p>
        )}
      </div>
      {(channel.unreadCount || 0) > 0 && (
        <span className="min-w-[18px] h-5 px-1 bg-purple-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
          {channel.unreadCount}
        </span>
      )}
    </motion.button>
  );
}
