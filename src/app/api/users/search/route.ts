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
      where: { token },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.userId;
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim().toLowerCase() || '';

    if (!q || q.length < 2) {
      return NextResponse.json({ users: [] });
    }

    // Search users by username (case-insensitive)
    const users = await db.user.findMany({
      where: {
        username: {
          contains: q.toLowerCase()
        },
        NOT: {
          id: userId
        }
      },
      take: 10
    });

    // Get user's contacts
    const contacts = await db.contact.findMany({
      where: { userId },
      select: { contactId: true }
    });

    const contactIds = new Set(contacts.map(c => c.contactId));

    return NextResponse.json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        isOnline: u.isOnline,
        isContact: contactIds.has(u.id),
      }))
    });
  } catch (error) {
    console.error('Search users error:', error);
    return NextResponse.json({ users: [] });
  }
}
