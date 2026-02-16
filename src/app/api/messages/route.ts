import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify session
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

    let messages: any[] = [];

    if (channelId) {
      // Channel messages
      messages = await db.message.findMany({
        where: { channelId },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          attachments: true
        }
      });
    } else if (contactId) {
      // Direct messages
      messages = await db.message.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: contactId, channelId: null },
            { senderId: contactId, receiverId: userId, channelId: null }
          ]
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          attachments: true
        }
      });
    }

    return NextResponse.json({ 
      messages: messages.map(m => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        receiverId: m.receiverId,
        channelId: m.channelId,
        replyToId: m.replyToId,
        isRead: m.isRead,
        readAt: m.readAt,
        createdAt: m.createdAt,
        isVoice: m.isVoice,
        voiceDuration: m.voiceDuration,
        voiceUrl: m.voiceUrl,
        attachments: m.attachments || [],
      }))
    });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify session
    const session = await db.session.findUnique({
      where: { token }
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;
    const body = await request.json();
    const { receiverId, channelId, content, replyToId, isVoice, voiceDuration, voiceUrl, attachments } = body;

    // Create message with attachments
    const message = await db.message.create({
      data: {
        content: content || '',
        senderId: userId,
        receiverId: receiverId || null,
        channelId: channelId || null,
        replyToId: replyToId || null,
        isRead: false,
        isVoice: isVoice || false,
        voiceDuration: voiceDuration || null,
        voiceUrl: voiceUrl || null,
        // Create attachments in database
        attachments: attachments && attachments.length > 0 ? {
          create: attachments.map((att: any) => ({
            url: att.url,
            type: att.type,
            name: att.name,
            size: att.size || 0,
          }))
        } : undefined,
      },
      include: {
        attachments: true,
      }
    });

    return NextResponse.json({
      message: {
        id: message.id,
        content: message.content,
        senderId: message.senderId,
        receiverId: message.receiverId,
        channelId: message.channelId,
        replyToId: message.replyToId,
        isRead: message.isRead,
        createdAt: message.createdAt,
        isVoice: message.isVoice,
        voiceDuration: message.voiceDuration,
        voiceUrl: message.voiceUrl,
        attachments: message.attachments || [],
      },
    });
  } catch (error) {
    console.error('Create message error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
