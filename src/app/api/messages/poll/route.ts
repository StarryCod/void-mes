import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * УМНЫЙ Polling - возвращает только НОВЫЕ сообщения
 * 
 * Работает ТОЛЬКО когда указан contactId или channelId
 * Возвращает сообщения с id > lastMessageId
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await db.session.findUnique({
      where: { token }
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contactId');
    const channelId = searchParams.get('channelId');
    const lastMessageId = searchParams.get('lastMessageId');

    // УМНОСТЬ: Требуется contactId или channelId!
    if (!contactId && !channelId) {
      return NextResponse.json({ messages: [], lastMessageId: null });
    }

    let messages: any[] = [];

    if (contactId) {
      // Direct messages - только от собеседника
      messages = await db.message.findMany({
        where: {
          senderId: contactId,
          receiverId: userId,
          ...(lastMessageId ? { id: { gt: lastMessageId } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        include: {
          sender: {
            select: { id: true, username: true, displayName: true, avatar: true }
          }
        }
      });
    } else if (channelId) {
      // Channel messages - не свои
      messages = await db.message.findMany({
        where: {
          channelId,
          senderId: { not: userId },
          ...(lastMessageId ? { id: { gt: lastMessageId } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        include: {
          sender: {
            select: { id: true, username: true, displayName: true, avatar: true }
          }
        }
      });
    }

    return NextResponse.json({
      messages,
      lastMessageId: messages.length > 0 ? messages[messages.length - 1].id : lastMessageId,
    });

  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ messages: [], lastMessageId: null });
  }
}
