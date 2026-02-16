'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { VoidLogo } from '@/components/common/VoidLogo';
import {
  MessageSquare, Hash, Compass, Plus, Settings,
  LogOut, User, Moon, Sun, Bell, Volume2
} from 'lucide-react';

interface ServerListProps {
  onOpenSettings: () => void;
  onOpenProfile: () => void;
}

export function ServerList({ onOpenSettings, onOpenProfile }: ServerListProps) {
  const { user, logout } = useAuthStore();
  const { activeView, setActiveView } = useChatStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = (n: string | null, u: string) => 
    n?.[0]?.toUpperCase() || u?.[0]?.toUpperCase() || '?';

  const navItems = [
    { 
      id: 'dms', 
      icon: MessageSquare, 
      label: 'Личные сообщения',
      onClick: () => setActiveView('dms')
    },
    { 
      id: 'channels', 
      icon: Hash, 
      label: 'Каналы',
      onClick: () => setActiveView('channels')
    },
    { 
      id: 'discover', 
      icon: Compass, 
      label: 'Обзор',
      onClick: () => {}
    },
  ];

  return (
    <div className="w-[72px] bg-[#0f0f14] flex flex-col items-center py-3 gap-2">
      {/* Logo */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-2 shadow-lg shadow-purple-500/20"
      >
        <VoidLogo size="sm" showText={false} animated={false} />
      </motion.button>

      {/* Divider */}
      <div className="w-8 h-0.5 bg-white/10 rounded-full mb-2" />

      {/* Navigation buttons */}
      {navItems.map((item) => {
        const isActive = activeView === item.id;
        return (
          <motion.button
            key={item.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={item.onClick}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all relative group ${
              isActive 
                ? 'bg-purple-500/20 text-purple-400' 
                : 'bg-[#1a1a24] text-gray-400 hover:bg-[#242430] hover:text-white'
            }`}
          >
            <item.icon className="w-5 h-5" />
            
            {/* Active indicator */}
            {isActive && (
              <motion.div
                layoutId="activeIndicator"
                className="absolute -left-1 w-1 h-8 bg-purple-500 rounded-r-full"
              />
            )}

            {/* Tooltip */}
            <div className="absolute left-full ml-4 px-3 py-1.5 bg-[#1a1a24] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl">
              {item.label}
            </div>
          </motion.button>
        );
      })}

      {/* Add server */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-12 h-12 rounded-2xl bg-[#1a1a24] flex items-center justify-center text-green-400 hover:bg-green-500/10 transition-colors group relative"
      >
        <Plus className="w-5 h-5" />
        <div className="absolute left-full ml-4 px-3 py-1.5 bg-[#1a1a24] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl">
          Создать сервер
        </div>
      </motion.button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom buttons */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setDarkMode(!darkMode)}
        className="w-12 h-12 rounded-2xl bg-[#1a1a24] flex items-center justify-center text-gray-400 hover:text-white transition-colors group relative"
      >
        {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        <div className="absolute left-full ml-4 px-3 py-1.5 bg-[#1a1a24] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl">
          {darkMode ? 'Светлая тема' : 'Тёмная тема'}
        </div>
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-12 h-12 rounded-2xl bg-[#1a1a24] flex items-center justify-center text-gray-400 hover:text-white transition-colors group relative"
      >
        <Bell className="w-5 h-5" />
        <div className="absolute left-full ml-4 px-3 py-1.5 bg-[#1a1a24] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl">
          Уведомления
        </div>
      </motion.button>

      {/* User avatar with dropdown */}
      <div className="relative" ref={menuRef}>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="w-12 h-12 rounded-2xl overflow-hidden bg-[#1a1a24] p-0.5 group relative"
        >
          <Avatar className="w-full h-full">
            <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm font-medium">
              {initials(user?.displayName || null, user?.username || '')}
            </AvatarFallback>
          </Avatar>
          <div className="absolute left-full ml-4 px-3 py-1.5 bg-[#1a1a24] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl">
            {user?.displayName || user?.username}
          </div>
        </motion.button>

        {/* User menu dropdown */}
        <AnimatePresence>
          {showUserMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-full ml-2 mb-2 w-52 bg-[#1a1a24] rounded-xl border border-white/5 shadow-2xl overflow-hidden z-50"
            >
              <div className="p-3 border-b border-white/5">
                <p className="text-white font-medium text-sm">{user?.displayName || user?.username}</p>
                <p className="text-gray-500 text-xs">@{user?.username}</p>
              </div>
              <div className="p-1.5">
                <button 
                  onClick={() => { onOpenProfile(); setShowUserMenu(false); }}
                  className="w-full px-3 py-2 text-left text-gray-300 text-sm hover:bg-white/5 rounded-lg flex items-center gap-3"
                >
                  <User className="w-4 h-4" /> Профиль
                </button>
                <button 
                  onClick={() => { onOpenSettings(); setShowUserMenu(false); }}
                  className="w-full px-3 py-2 text-left text-gray-300 text-sm hover:bg-white/5 rounded-lg flex items-center gap-3"
                >
                  <Settings className="w-4 h-4" /> Настройки
                </button>
                <div className="my-1 h-px bg-white/5" />
                <button
                  onClick={() => { logout(); setShowUserMenu(false); }}
                  className="w-full px-3 py-2 text-left text-red-400 text-sm hover:bg-red-500/10 rounded-lg flex items-center gap-3"
                >
                  <LogOut className="w-4 h-4" /> Выйти
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
