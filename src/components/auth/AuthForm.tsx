'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/auth';
import { Eye, EyeOff, User, Lock, Zap, Sparkles } from 'lucide-react';
import { VoidLogo } from '@/components/common/VoidLogo';

interface AuthFormProps {
  onSuccess: () => void;
}

export function AuthForm({ onSuccess }: AuthFormProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const { setUser, setToken } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = mode === 'register' ? { username, password, displayName } : { username, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Ошибка');
        return;
      }

      setShowSuccess(true);
      setUser(data.user);
      setToken(data.token);
      setTimeout(onSuccess, 600);
    } catch (err) {
      setError('Ошибка сети');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e0e12] p-4">
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0e0e12]"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#a855f7] to-[#ec4899] flex items-center justify-center shadow-lg shadow-purple-500/30"
            >
              <Sparkles className="w-10 h-10 text-white" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <VoidLogo size="lg" />
        </div>

        {/* Card */}
        <div className="bg-[#131316] rounded-2xl overflow-hidden border border-white/5">
          {/* Tabs */}
          <div className="flex border-b border-white/5">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'login' ? 'bg-gradient-to-r from-[#a855f7] to-[#9333ea] text-white' : 'text-[#72767d] hover:text-[#dbdee1]'
              }`}
            >
              Вход
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'register' ? 'bg-gradient-to-r from-[#a855f7] to-[#9333ea] text-white' : 'text-[#72767d] hover:text-[#dbdee1]'
              }`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label className="text-[#72767d] text-xs font-medium uppercase tracking-wide">Никнейм</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#72767d]" />
                <Input
                  type="text"
                  placeholder="username"
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="pl-10 bg-[#1a1a1f] border-0 text-[#dbdee1] placeholder:text-[#72767d] focus:ring-2 focus:ring-[#a855f7]/30 rounded-xl h-11"
                  required
                />
              </div>
            </div>

            {/* Display Name */}
            {mode === 'register' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-1.5"
              >
                <label className="text-[#72767d] text-xs font-medium uppercase tracking-wide">Имя</label>
                <div className="relative">
                  <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#72767d]" />
                  <Input
                    type="text"
                    placeholder="Отображаемое имя"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="pl-10 bg-[#1a1a1f] border-0 text-[#dbdee1] placeholder:text-[#72767d] focus:ring-2 focus:ring-[#a855f7]/30 rounded-xl h-11"
                  />
                </div>
              </motion.div>
            )}

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[#72767d] text-xs font-medium uppercase tracking-wide">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#72767d]" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-[#1a1a1f] border-0 text-[#dbdee1] placeholder:text-[#72767d] focus:ring-2 focus:ring-[#a855f7]/30 rounded-xl h-11"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#72767d] hover:text-[#dbdee1]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#ed4245]/10 border border-[#ed4245]/20 rounded-xl p-3"
              >
                <p className="text-[#ed4245] text-sm">{error}</p>
              </motion.div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading || !username || !password}
              className="w-full bg-gradient-to-r from-[#a855f7] to-[#9333ea] hover:from-[#9333ea] hover:to-[#7c3aed] text-white font-medium py-3 rounded-xl h-11"
            >
              {isLoading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                />
              ) : (
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
                </span>
              )}
            </Button>
          </form>

          <div className="px-5 pb-5 text-center">
            <p className="text-[#72767d] text-xs">
              {mode === 'login' ? (
                <>
                  Нет аккаунта?{' '}
                  <button onClick={() => setMode('register')} className="text-[#a855f7] hover:underline">
                    Создать
                  </button>
                </>
              ) : (
                <>
                  Есть аккаунт?{' '}
                  <button onClick={() => setMode('login')} className="text-[#a855f7] hover:underline">
                    Войти
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
