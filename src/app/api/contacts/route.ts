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

    // Get contacts with user details
    const contactsList = await db.contact.findMany({
      where: { userId },
      include: {
        contact: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
            bio: true,
            status: true,
            isOnline: true,
            lastSeen: true,
          }
        }
      }
    });

    const contacts = contactsList.map(c => ({
      id: c.contact.id,
      username: c.contact.username,
      displayName: c.contact.displayName,
      avatar: c.contact.avatar,
      bio: c.contact.bio,
      status: c.contact.status,
      isOnline: c.contact.isOnline,
      lastSeen: c.contact.lastSeen,
    }));

    return NextResponse.json({ contacts });
  } catch (error) {
    console.error('Get contacts error:', error);
    return NextResponse.json({ contacts: [] });
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
    const { username } = body;
    const trimmedUsername = username?.trim().toLowerCase();

    // Find user by username
    const contactUser = await db.user.findUnique({
      where: { username: trimmedUsername }
    });

    if (!contactUser) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }

    if (contactUser.id === userId) {
      return NextResponse.json({ error: 'Нельзя добавить себя' }, { status: 400 });
    }

    // Check if already contact
    const existing = await db.contact.findUnique({
      where: {
        userId_contactId: {
          userId,
          contactId: contactUser.id
        }
      }
    });

    if (existing) {
      return NextResponse.json({ error: 'Уже в контактах' }, { status: 400 });
    }

    // Create contact (both directions)
    await db.contact.create({
      data: {
        userId,
        contactId: contactUser.id,
      }
    });

    // Create reverse contact
    await db.contact.create({
      data: {
        userId: contactUser.id,
        contactId: userId,
      }
    });

    return NextResponse.json({
      contact: {
        id: contactUser.id,
        username: contactUser.username,
        displayName: contactUser.displayName,
        avatar: contactUser.avatar,
        bio: contactUser.bio,
        status: contactUser.status,
        isOnline: contactUser.isOnline,
        lastSeen: contactUser.lastSeen,
      },
    });
  } catch (error) {
    console.error('Add contact error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
