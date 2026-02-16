import { NextRequest, NextResponse } from 'next/server';

// Rate limiting store (in-memory, resets on server restart)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration
const RATE_LIMITS = {
  auth: { maxRequests: 5, windowMs: 60 * 1000 }, // 5 requests per minute (stricter)
  message: { maxRequests: 100, windowMs: 60 * 1000 }, // 100 messages per minute
  upload: { maxRequests: 20, windowMs: 60 * 1000 }, // 20 uploads per minute
  call: { maxRequests: 30, windowMs: 60 * 1000 }, // 30 call actions per minute
  default: { maxRequests: 60, windowMs: 60 * 1000 }, // 60 requests per minute
};

export function checkRateLimit(
  identifier: string,
  type: keyof typeof RATE_LIMITS = 'default'
): { success: boolean; remaining: number; resetTime: number } {
  const config = RATE_LIMITS[type];
  const now = Date.now();
  const key = `${type}:${identifier}`;
  
  const record = rateLimitStore.get(key);
  
  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
    };
  }
  
  if (record.count >= config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: record.resetTime,
    };
  }
  
  record.count++;
  return {
    success: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime,
  };
}

// Input validation with enhanced security
export function validateInput(input: string, maxLength: number = 5000): { valid: boolean; sanitized: string; error?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, sanitized: '', error: 'Invalid input' };
  }
  
  // Trim whitespace
  let sanitized = input.trim();
  
  // Check length
  if (sanitized.length > maxLength) {
    return { valid: false, sanitized: '', error: `Input too long (max ${maxLength} characters)` };
  }
  
  // Remove null bytes and control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Check for suspicious patterns (XSS prevention)
  const suspiciousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:\s*text\/html/gi,
    /vbscript:/gi,
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      return { valid: false, sanitized: '', error: 'Suspicious content detected' };
    }
  }
  
  return { valid: true, sanitized };
}

// Username validation with enhanced rules
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  
  // Trim whitespace first
  const trimmed = username.trim();
  
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { valid: false, error: 'Username must be 3-30 characters' };
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }
  
  // Check for reserved usernames
  const reserved = ['admin', 'root', 'system', 'void', 'api', 'www', 'mail', 'support', 'help'];
  if (reserved.includes(trimmed.toLowerCase())) {
    return { valid: false, error: 'This username is reserved' };
  }
  
  return { valid: true };
}

// Password validation with strength requirements
export function validatePassword(password: string): { valid: boolean; error?: string; strength?: 'weak' | 'medium' | 'strong' } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  if (password.length > 128) {
    return { valid: false, error: 'Password too long' };
  }
  
  // Check for at least one letter and one number
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter and one number' };
  }
  
  // Calculate strength
  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const isLong = password.length >= 12;
  
  if ((hasLower && hasUpper && hasNumbers && hasSpecial) || (isLong && hasSpecial)) {
    strength = 'strong';
  } else if ((hasLower && hasUpper && hasNumbers) || (isLong)) {
    strength = 'medium';
  }
  
  return { valid: true, strength };
}

// Get client IP from request with proxy support
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  
  return 'unknown';
}

// Security headers middleware with enhanced headers
export function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  
  // Content Security Policy for API routes
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  
  return response;
}

// Token validation helper
export function validateToken(token: string): { valid: boolean; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token required' };
  }
  
  if (token.length !== 64) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  return { valid: true };
}

// Sanitize filename for uploads
export function sanitizeFilename(filename: string): string {
  // Remove path separators and null bytes
  let sanitized = filename.replace(/[\/\\:\x00]/g, '');
  
  // Remove leading dots (hidden files)
  sanitized = sanitized.replace(/^\.+/, '');
  
  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop() || '';
    sanitized = sanitized.substring(0, 255 - ext.length - 1) + '.' + ext;
  }
  
  return sanitized || 'file';
}

// Validate file type
export function validateFileType(mimetype: string, allowedTypes: string[]): boolean {
  return allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      return mimetype.startsWith(type.slice(0, -1));
    }
    return mimetype === type;
  });
}

// Generate secure random string
export function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

// Clean up expired rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

// Log security events (for monitoring)
export function logSecurityEvent(event: string, details: Record<string, any>) {
  console.log(JSON.stringify({
    type: 'security',
    event,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}
