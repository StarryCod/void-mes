import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomBytes } from 'crypto';
import { compare, hash } from 'bcrypt';
import { checkRateLimit, validateUsername, validateInput, getClientIp, addSecurityHeaders } from '@/lib/security';

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
    const { username, password } = body;
    const trimmedUsername = username?.trim().toLowerCase();

    // Validate username
    const usernameValidation = validateUsername(username || '');
    if (!usernameValidation.valid) {
      return NextResponse.json({ error: usernameValidation.error }, { status: 400 });
    }

    const passwordValidation = validateInput(password || '', 128);
    if (!passwordValidation.valid) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 400 });
    }

    // Find user
    const user = await db.user.findUnique({
      where: { username: trimmedUsername }
    });

    // Check password
    let passwordMatch = false;
    if (user) {
      try {
        // Check if bcrypt hash or legacy SHA256
        if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
          passwordMatch = await compare(password, user.password);
        } else {
          // Legacy SHA256
          const { createHash } = await import('crypto');
          const hashedPassword = createHash('sha256').update(password).digest('hex');
          passwordMatch = user.password === hashedPassword;
          
          // Upgrade to bcrypt
          if (passwordMatch) {
            const newHash = await hash(password, 12);
            await db.user.update({
              where: { id: user.id },
              data: { password: newHash }
            });
            console.log(`[Auth] Upgraded password hash for: ${user.username}`);
          }
        }
      } catch (e) {
        passwordMatch = false;
      }
    }

    if (!user || !passwordMatch) {
      return NextResponse.json({ error: 'Неверные учетные данные' }, { status: 401 });
    }

    // Update online status
    await db.user.update({
      where: { id: user.id },
      data: {
        isOnline: true,
        lastSeen: new Date()
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

    console.log(`[Auth] User logged in: ${user.username} (${user.id})`);

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        status: user.status,
        isOnline: true,
        lastSeen: user.lastSeen,
      },
      token,
    });
    
    return addSecurityHeaders(response);
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
