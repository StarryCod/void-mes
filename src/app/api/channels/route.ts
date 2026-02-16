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

    // Get user's channel memberships with channel details
    const memberships = await db.channelMember.findMany({
      where: { userId },
      include: {
        channel: true
      }
    });

    const channels = memberships.map(m => ({
      id: m.channel.id,
      name: m.channel.name,
      description: m.channel.description,
      isPrivate: m.channel.isPrivate,
      createdAt: m.channel.createdAt,
      role: m.role,
    }));

    return NextResponse.json({ channels });
  } catch (error) {
    console.error('Get channels error:', error);
    return NextResponse.json({ channels: [] });
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
    const { name, description } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Название обязательно' }, { status: 400 });
    }

    // Create channel
    const channel = await db.channel.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        isPrivate: false,
      }
    });

    // Add creator as admin
    await db.channelMember.create({
      data: {
        channelId: channel.id,
        userId,
        role: 'admin',
      }
    });

    return NextResponse.json({
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        isPrivate: channel.isPrivate,
        createdAt: channel.createdAt,
      },
    });
  } catch (error) {
    console.error('Create channel error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
