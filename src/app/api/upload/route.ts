import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, addSecurityHeaders } from '@/lib/security';
import { db } from '@/lib/db';
import { createAppwriteClient, ID } from '@/lib/appwrite/server';

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

    // Determine file type
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    let type = 'file';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('video/')) type = 'video';
    else if (file.type.startsWith('audio/')) type = 'audio';
    
    // For audio files, also check extension
    if (type === 'file' && ['webm', 'mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
      type = 'audio';
    }

    // Upload to Appwrite Storage
    try {
      const { storage } = createAppwriteClient();
      
      // Generate unique filename
      const filename = `${Date.now()}-${file.name}`;
      
      // Create file in Appwrite Storage (bucket: uploads)
      const result = await storage.createFile(
        'uploads',
        ID.unique(),
        file
      );

      // Get the file URL
      const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
      const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '69923291001c25654226';
      const fileUrl = `${endpoint}/storage/buckets/uploads/files/${result.$id}/view?project=${projectId}`;

      console.log(`[Upload] File uploaded to Appwrite: ${result.$id}, type: ${type}, size: ${file.size}`);

      const response = NextResponse.json({
        url: fileUrl,
        fileId: result.$id,
        type,
        name: file.name,
        size: file.size,
      });
      
      return addSecurityHeaders(response);
    } catch (appwriteError) {
      console.error('[Upload] Appwrite error:', appwriteError);
      return NextResponse.json({ error: 'Ошибка при загрузке файла в хранилище' }, { status: 500 });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Ошибка при загрузке файла' }, { status: 500 });
  }
}
