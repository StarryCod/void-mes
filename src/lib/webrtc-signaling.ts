'use client';

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Create Supabase client for signaling
export const createSignalingClient = () => {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
      params: {
        eventsPerSecond: 100,
      },
    },
  });
};

// Signaling channel name
export const SIGNALING_CHANNEL = 'webrtc-signaling';

// Message types for signaling
export type SignalingMessage = {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-request' | 'call-accept' | 'call-reject' | 'call-end' | 'screen-start' | 'screen-stop' | 'canvas-draw' | 'document-update' | 'typing' | 'user-online' | 'user-offline';
  from: string;
  to: string;
  payload: any;
  timestamp: number;
};

// WebRTC configuration with STUN/TURN servers
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Add TURN servers for better NAT traversal in production
  ],
  iceCandidatePoolSize: 10,
};

// Helper to generate unique call ID
export const generateCallId = () => {
  return `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
