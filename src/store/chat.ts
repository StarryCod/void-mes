import { create } from 'zustand';

export interface Message {
  id: string;
  content: string;
  senderId: string;
  receiverId: string | null;
  channelId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  reactions?: Reaction[];
  replyTo?: Message | null;
  replyToId?: string | null;
  attachments?: Attachment[];
  isVoice?: boolean;
  voiceDuration?: number;
  voiceUrl?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface Attachment {
  id: string;
  url: string;
  type: 'image' | 'file' | 'video' | 'audio';
  name: string;
  size: number;
}

export interface Contact {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  status: string | null;
  isOnline: boolean;
  lastSeen: string | null;
  lastMessage?: Message;
  unreadCount?: number;
}

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  createdAt: string;
  unreadCount?: number;
  lastMessage?: Message;
}

export interface TypingUser {
  id: string;
  username: string;
  isTyping: boolean;
}

interface ChatState {
  contacts: Contact[];
  channels: Channel[];
  messages: Message[];
  activeChat: Contact | null;
  activeChannel: Channel | null;
  activeView: 'dms' | 'channels';
  isLoading: boolean;
  typingUsers: TypingUser[];
  
  // Actions
  setContacts: (contacts: Contact[] | undefined | null) => void;
  addContact: (contact: Contact) => void;
  setChannels: (channels: Channel[] | undefined | null) => void;
  addChannel: (channel: Channel) => void;
  setMessages: (messages: Message[] | undefined | null) => void;
  addMessage: (message: Message) => void;
  setActiveChat: (contact: Contact | null) => void;
  setActiveChannel: (channel: Channel | null) => void;
  setActiveView: (view: 'dms' | 'channels') => void;
  setLoading: (loading: boolean) => void;
  updateContactLastMessage: (contactId: string, message: Message) => void;
  markMessagesAsRead: (contactId: string) => void;
  setTypingUser: (userId: string, username: string, isTyping: boolean) => void;
  addReaction: (messageId: string, emoji: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  contacts: [],
  channels: [],
  messages: [],
  activeChat: null,
  activeChannel: null,
  activeView: 'dms',
  isLoading: false,
  typingUsers: [],
  
  setContacts: (contacts) => set({ contacts: contacts || [] }),
  addContact: (contact) => set((state) => ({ contacts: [...(state.contacts || []), contact] })),
  setChannels: (channels) => set({ channels: channels || [] }),
  addChannel: (channel) => set((state) => ({ channels: [...(state.channels || []), channel] })),
  setMessages: (messages) => set({ messages: messages || [] }),
  addMessage: (message) => set((state) => ({ 
    messages: [...(state.messages || []), message] 
  })),
  setActiveChat: (contact) => set({ activeChat: contact, activeChannel: null, messages: [] }),
  setActiveChannel: (channel) => set({ activeChannel: channel, activeChat: null, messages: [] }),
  setActiveView: (view) => set({ activeView: view }),
  setLoading: (loading) => set({ isLoading: loading }),
  updateContactLastMessage: (contactId, message) =>
    set((state) => ({
      contacts: (state.contacts || []).map((c) =>
        c.id === contactId ? { ...c, lastMessage: message } : c
      ),
    })),
  markMessagesAsRead: (contactId) =>
    set((state) => ({
      contacts: (state.contacts || []).map((c) =>
        c.id === contactId ? { ...c, unreadCount: 0 } : c
      ),
      messages: (state.messages || []).map((m) =>
        m.senderId === contactId ? { ...m, isRead: true } : m
      ),
    })),
  setTypingUser: (userId, username, isTyping) =>
    set((state) => {
      const filtered = state.typingUsers.filter(u => u.id !== userId);
      if (isTyping) {
        return { typingUsers: [...filtered, { id: userId, username, isTyping }] };
      }
      return { typingUsers: filtered };
    }),
  addReaction: (messageId, emoji) =>
    set((state) => ({
      messages: state.messages.map(m => {
        if (m.id === messageId) {
          const reactions = m.reactions || [];
          const existing = reactions.find(r => r.emoji === emoji);
          if (existing) {
            return {
              ...m,
              reactions: reactions.map(r => 
                r.emoji === emoji 
                  ? { ...r, count: r.reacted ? r.count - 1 : r.count + 1, reacted: !r.reacted }
                  : r
              ).filter(r => r.count > 0)
            };
          }
          return { ...m, reactions: [...reactions, { emoji, count: 1, reacted: true }] };
        }
        return m;
      })
    }))
}));
