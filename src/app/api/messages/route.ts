import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Notify user via Cloudflare Worker WebSocket with retry
async function notifyUser(userId: string, message: any, retries = 3): Promise<boolean> {
  const WORKER_URL = process.env.NEXT_PUBLIC_CF_WORKERS_URL || 'https://void-time.mr-starred09.workers.dev';
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${WORKER_URL}/ws/user/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          action: 'new',
          data: message,
          senderId: message.senderId,
          messageId: message.id,
          timestamp: Date.now()
        })
      });
      
      if (response.ok) {
        console.log(`[API] ✅ WebSocket notification sent to ${userId} (attempt ${attempt})`);
        return true;
      } else {
        console.warn(`[API] ⚠️ WebSocket notification failed for ${userId} (attempt ${attempt}): ${response.status}`);
      }
    } catch (error) {
      console.error(`[API] ❌ WebSocket notification error (attempt ${attempt}):`, error);
    }
    
    // Wait before retry
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  
  return false;
}

// Notify multiple users in parallel
async function notifyUsers(userIds: string[], message: any): Promise<void> {
  const notifications = userIds.map(userId => notifyUser(userId, message));
  await Promise.allSettled(notifications);
}

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

    // Create message with attachments in Neon (primary storage)
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

    // Get sender info for notification
    const sender = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, avatar: true }
    });

    // Prepare message for response and notification
    const messageResponse = {
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
      sender: sender,
    };

    // Notify via WebSocket (non-blocking but tracked)
    if (receiverId) {
      // Direct message - notify receiver
      notifyUser(receiverId, messageResponse).catch(console.error);
    } else if (channelId) {
      // Channel message - notify all channel members
      db.channelMember.findMany({
        where: { channelId },
        select: { userId: true }
      }).then(members => {
        const userIds = members
          .filter(m => m.userId !== userId)
          .map(m => m.userId);
        notifyUsers(userIds, messageResponse).catch(console.error);
      }).catch(console.error);
    }

    return NextResponse.json({ message: messageResponse });
  } catch (error) {
    console.error('Create message error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
