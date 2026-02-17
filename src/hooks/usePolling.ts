'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';

/**
 * УМНЫЙ Polling для real-time сообщений
 * 
 * Работает ТОЛЬКО когда:
 * 1. Вкладка видима (visibilityState === 'visible')
 * 2. Открыт чат (activeChat или activeChannel)
 * 
 * НЕ работает когда:
 * - Пользователь на другой вкладке
 * - Чат не открыт
 * 
 * Результат: минимум запросов, только когда нужно!
 */
export function usePolling() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const activeChat = useChatStore((state) => state.activeChat);
  const activeChannel = useChatStore((state) => state.activeChannel);
  const addMessage = useChatStore((state) => state.addMessage);

  const lastMessageIdRef = useRef<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);

  // Poll for new messages
  const poll = useCallback(async () => {
    // УМНОСТЬ: Не опрашиваем если нет активного чата!
    if (!activeChat && !activeChannel) {
      console.log('[Polling] No active chat, skipping');
      return;
    }

    // УМНОСТЬ: Не опрашиваем если вкладка скрыта!
    if (document.visibilityState !== 'visible') {
      console.log('[Polling] Tab hidden, skipping');
      return;
    }

    if (!token || !user || isPollingRef.current) return;

    isPollingRef.current = true;

    try {
      const params = new URLSearchParams();
      
      // Запрашиваем только для текущего чата
      if (activeChat) {
        params.set('contactId', activeChat.id);
      } else if (activeChannel) {
        params.set('channelId', activeChannel.id);
      }
      
      if (lastMessageIdRef.current) {
        params.set('lastMessageId', lastMessageIdRef.current);
      }

      const response = await fetch(`/api/messages/poll?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        isPollingRef.current = false;
        return;
      }

      const data = await response.json();

      // Update lastMessageId
      if (data.lastMessageId) {
        lastMessageIdRef.current = data.lastMessageId;
      }

      // Add new messages to UI
      if (data.messages && data.messages.length > 0) {
        console.log('[Polling] 📩 New messages:', data.messages.length);

        for (const msg of data.messages) {
          // Add to UI if it's for current chat
          if (activeChat && msg.senderId === activeChat.id) {
            addMessage(msg);
          } else if (activeChannel && msg.channelId === activeChannel.id) {
            addMessage(msg);
          }
        }
      }

    } catch (error) {
      console.error('[Polling] Error:', error);
    } finally {
      isPollingRef.current = false;
    }
  }, [token, user, activeChat, activeChannel, addMessage]);

  // Start/Stop polling based on active chat
  useEffect(() => {
    // УМНОСТЬ: Запускаем ТОЛЬКО если есть активный чат
    if (!user?.id || !token || (!activeChat && !activeChannel)) {
      // Останавливаем polling если чат закрыт
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        console.log('[Polling] Stopped - no active chat');
      }
      return;
    }

    // Уже запущен?
    if (intervalRef.current) return;

    // Запускаем polling
    poll(); // Первый раз сразу
    intervalRef.current = setInterval(poll, 2000);
    console.log('[Polling] Started for', activeChat?.id || activeChannel?.id);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        console.log('[Polling] Stopped');
      }
    };
  }, [user?.id, token, activeChat?.id, activeChannel?.id, poll]);

  // Pause when tab is hidden, resume when visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Возобновляем ТОЛЬКО если есть активный чат
        if (user?.id && token && (activeChat || activeChannel) && !intervalRef.current) {
          poll();
          intervalRef.current = setInterval(poll, 2000);
          console.log('[Polling] Resumed');
        }
      } else {
        // Приостанавливаем
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          console.log('[Polling] Paused - tab hidden');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id, token, activeChat, activeChannel, poll]);

  return { lastMessageId: lastMessageIdRef.current };
}
