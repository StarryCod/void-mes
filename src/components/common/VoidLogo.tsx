'use client';

import { motion } from 'framer-motion';

interface VoidLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  animated?: boolean;
}

export function VoidLogo({ size = 'md', showText = true, animated = true }: VoidLogoProps) {
  const sizes = {
    sm: { container: 'w-10 h-10', ghost: 'w-6 h-6', text: 'text-lg' },
    md: { container: 'w-16 h-16', ghost: 'w-10 h-10', text: 'text-2xl' },
    lg: { container: 'w-20 h-20', ghost: 'w-12 h-12', text: 'text-3xl' },
    xl: { container: 'w-24 h-24', ghost: 'w-14 h-14', text: 'text-4xl' },
  };

  const s = sizes[size];

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        className={`${s.container} relative`}
        animate={animated ? {
          filter: ['drop-shadow(0 0 12px rgba(168, 85, 247, 0.4))', 'drop-shadow(0 0 24px rgba(236, 72, 153, 0.6))', 'drop-shadow(0 0 12px rgba(168, 85, 247, 0.4))']
        } : {}}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Gradient ring */}
        <motion.div
          className="absolute inset-0 rounded-2xl"
          style={{ background: 'conic-gradient(from 0deg, #a855f7, #ec4899, #a855f7)' }}
          animate={animated ? { rotate: 360 } : {}}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        />

        {/* Inner */}
        <div className="absolute inset-[2px] rounded-xl bg-[#0e0e12] flex items-center justify-center overflow-hidden">
          <svg viewBox="0 0 24 24" fill="none" className={`${s.ghost} relative z-10`}>
            <defs>
              <linearGradient id="voidGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <path
              d="M12 2C7.58 2 4 5.58 4 10v8c0 1.1.9 2 2 2h1c.55 0 1-.45 1-1v-1c0-.55.45-1 1-1s1 .45 1 1v1c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1c0-.55.45-1 1-1s1 .45 1 1v1c0 .55.45 1 1 1h1c1.1 0 2-.9 2-2v-8c0-4.42-3.58-8-8-8z"
              fill="url(#voidGrad)"
            />
            <ellipse cx="8.5" cy="9.5" rx="2" ry="2.5" fill="#0e0e12" />
            <ellipse cx="15.5" cy="9.5" rx="2" ry="2.5" fill="#0e0e12" />
          </svg>
        </div>
      </motion.div>

      {showText && (
        <div className="text-center">
          <h1
            className={`${s.text} font-bold tracking-wider`}
            style={{
              background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            VOID MES
          </h1>
          <p className="text-[#72767d] text-xs tracking-widest uppercase mt-0.5">Теневой мессенджер</p>
        </div>
      )}
    </div>
  );
}
