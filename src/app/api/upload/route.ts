import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { checkRateLimit, getClientIp, addSecurityHeaders } from '@/lib/security';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    
    // Rate limiting
    const rateLimit = checkRateLimit(clientIp, 'upload');
    if (!rateLimit.success) {
      const response = NextResponse.json(
        { error: 'Слишком много загрузок. Подождите.' },
        { status: 429 }
      );
      return addSecurityHeaders(response);
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    // Verify session
    const session = await db.session.findUnique({
      where: { token }
    });

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Файл не предоставлен' }, { status: 400 });
    }

    // Check file size (max 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Файл слишком большой (макс 10MB)' }, { status: 400 });
    }

    // Generate unique filename
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const filename = `${randomUUID()}-${Date.now()}.${ext}`;
    
    // Ensure upload directory exists
    const uploadDir = join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }

    // Write file
    const filepath = join(uploadDir, filename);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    writeFileSync(filepath, buffer);

    // Determine file type
    let type = 'file';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('video/')) type = 'video';
    else if (file.type.startsWith('audio/')) type = 'audio';
    
    // For audio files, also check extension
    if (type === 'file' && ['webm', 'mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
      type = 'audio';
    }

    console.log(`[Upload] File saved: ${filename}, type: ${type}, size: ${file.size}`);

    const response = NextResponse.json({
      url: `/uploads/${filename}`,
      type,
      name: file.name,
      size: file.size,
    });
    
    return addSecurityHeaders(response);
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Ошибка при загрузке файла' }, { status: 500 });
  }
}
