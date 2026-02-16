# Void Realtime - Cloudflare Workers Backend

Real-time messaging and WebRTC signaling backend using Cloudflare Workers + Durable Objects.

## Features

- ✅ WebSocket for real-time messaging
- ✅ WebRTC signaling for audio/video calls
- ✅ Durable Objects for stateful connections
- ✅ PostgreSQL (Neon) for data storage
- ✅ Online/offline presence tracking

## Deploy

1. Install dependencies:
```bash
bun install
```

2. Set secrets:
```bash
wrangler secret put DATABASE_URL
wrangler secret put APPWRITE_API_KEY
```

3. Deploy:
```bash
bun run deploy
```

## Endpoints

### WebSocket
- `GET /ws/user/:userId` - User events (messages, contacts, presence)
- `GET /ws/channel/:channelId` - Channel events
- `GET /ws/call/:callId?userId=xxx` - Call signaling

### API
- `GET /api/auth/me` - Get current user
- `GET /api/contacts` - Get contacts
- `POST /api/contacts` - Add contact
- `GET /api/messages?contactId=xxx` - Get messages
- `POST /api/messages` - Send message
- `GET /api/channels` - Get channels
- `POST /api/channels` - Create channel
- `GET /api/users/search?q=xxx` - Search users

## Environment Variables

```env
DATABASE_URL=postgresql://...
APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-api-key
```
