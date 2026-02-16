// Simple XOR encryption for messages (client-side)
// In production, consider using Web Crypto API with AES-GCM

const ENCRYPTION_KEY = 'void-mes-secret-key-2024';

export function encrypt(text: string): string {
  if (!text) return text;
  
  try {
    const key = ENCRYPTION_KEY;
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    // Encode to base64 for safe storage
    return btoa(unescape(encodeURIComponent(result)));
  } catch {
    return text;
  }
}

export function decrypt(encrypted: string): string {
  if (!encrypted) return encrypted;
  
  try {
    // Decode from base64
    const text = decodeURIComponent(escape(atob(encrypted)));
    const key = ENCRYPTION_KEY;
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch {
    return encrypted;
  }
}

// Simple hash for user IDs
export function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
