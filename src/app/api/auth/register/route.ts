import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomBytes } from 'crypto';
import { hash } from 'bcrypt';
import { checkRateLimit, validateUsername, validatePassword, getClientIp, addSecurityHeaders } from '@/lib/security';

const SALT_ROUNDS = 12;

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    
    // Rate limiting
    const rateLimit = checkRateLimit(clientIp, 'auth');
    if (!rateLimit.success) {
      const response = NextResponse.json(
        { error: 'Слишком много попыток. Попробуйте позже.' },
        { status: 429 }
      );
      return addSecurityHeaders(response);
    }

    const body = await request.json();
    const { username, password, displayName } = body;
    const trimmedUsername = username?.trim().toLowerCase();

    // Validate username
    const usernameValidation = validateUsername(username || '');
    if (!usernameValidation.valid) {
      return NextResponse.json({ error: usernameValidation.error }, { status: 400 });
    }

    // Validate password
    const passwordValidation = validatePassword(password || '');
    if (!passwordValidation.valid) {
      return NextResponse.json({ error: passwordValidation.error }, { status: 400 });
    }

    // Sanitize displayName
    let sanitizedDisplayName = trimmedUsername;
    if (displayName) {
      if (displayName.length > 50) {
        return NextResponse.json({ error: 'Имя слишком длинное' }, { status: 400 });
      }
      sanitizedDisplayName = displayName.trim().replace(/<[^>]*>/g, '');
    }

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { username: trimmedUsername }
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Это имя пользователя уже занято' }, { status: 400 });
    }

    // Hash password
    const hashedPassword = await hash(password, SALT_ROUNDS);

    // Create user
    const user = await db.user.create({
      data: {
        username: trimmedUsername,
        password: hashedPassword,
        displayName: sanitizedDisplayName,
        isOnline: true,
      }
    });

    // Create session
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      }
    });

    console.log(`[Auth] User registered: ${user.username} (${user.id})`);

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        status: user.status,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
      },
      token,
    });
    
    return addSecurityHeaders(response);
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
