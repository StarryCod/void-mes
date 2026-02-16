import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;
    const { contactId, channelId } = await request.json();

    if (contactId) {
      // Delete messages between user and contact
      await db.message.deleteMany({
        where: {
          OR: [
            { senderId: userId, receiverId: contactId },
            { senderId: contactId, receiverId: userId }
          ]
        }
      });

      // Delete contact relationships (both directions)
      await db.contact.deleteMany({
        where: {
          OR: [
            { userId, contactId },
            { userId: contactId, contactId: userId }
          ]
        }
      });
    } else if (channelId) {
      // Check if user is member of channel
      const membership = await db.channelMember.findFirst({
        where: { channelId, userId }
      });

      if (!membership) {
        return NextResponse.json({ error: 'Not a member' }, { status: 403 });
      }

      // If admin, delete entire channel
      if (membership.role === 'admin') {
        // Delete all channel messages
        await db.message.deleteMany({
          where: { channelId }
        });

        // Delete all channel members
        await db.channelMember.deleteMany({
          where: { channelId }
        });

        // Delete channel
        await db.channel.delete({
          where: { id: channelId }
        });
      } else {
        // Just leave the channel
        await db.channelMember.delete({
          where: { id: membership.id }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete chat error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
