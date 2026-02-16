import { Client, Databases } from 'node-appwrite';

const client = new Client()
  .setEndpoint('https://fra.cloud.appwrite.io/v1')
  .setProject('69923291001c25654226')
  .setKey('standard_a89389c81e380b12111f2f16141bc23936864dd812791762294a8bc2936f62753744aa5735a0afce8f50dbcfa72b54b3222431478f4c7d5da20d38c0aa0d88e5e96fd26d289fc24fc632baa3d09aa6cb7f5282c51a5bee661b29d7b6e8c4582ed9e4b74786a4819e0310a3c8f0187d4f4c96129f096e47d0202326eb10bd11a1');

const databases = new Databases(client);

const DATABASE_ID = 'void-mes-db';

async function setupDatabase() {
  console.log('🚀 Setting up Appwrite database...\n');

  // Create database
  try {
    await databases.create(DATABASE_ID, 'Void Mes Database');
    console.log('✅ Created database: void-mes-db');
  } catch (e: any) {
    console.log('ℹ️  Database status:', e.message);
  }

  // Create Users collection
  console.log('\n📁 Creating Users collection...');
  try {
    await databases.createCollection(DATABASE_ID, 'users', 'Users');
  } catch (e: any) {
    console.log('  Collection status:', e.message?.substring(0, 50));
  }

  // User attributes
  const userAttrs = [
    ['username', 'string', 50, true],
    ['password', 'string', 255, true],
    ['displayName', 'string', 100, false],
    ['avatar', 'string', 500, false],
    ['bio', 'string', 500, false],
    ['status', 'string', 100, false],
    ['isOnline', 'boolean', null, true],
  ];

  for (const [key, type, size, required] of userAttrs) {
    try {
      if (type === 'string') {
        await databases.createStringAttribute(DATABASE_ID, 'users', key as string, size as number, required as boolean);
      } else {
        await databases.createBooleanAttribute(DATABASE_ID, 'users', key as string, required as boolean, false);
      }
      console.log(`  ✅ ${key}`);
    } catch (e: any) {
      console.log(`  ℹ️  ${key}: ${e.message?.substring(0, 30)}`);
    }
  }

  // Create Sessions collection
  console.log('\n📁 Creating Sessions collection...');
  try {
    await databases.createCollection(DATABASE_ID, 'sessions', 'Sessions');
  } catch (e: any) {}
  
  const sessionAttrs = [
    ['userId', 'string', 100, true],
    ['token', 'string', 128, true],
    ['expiresAt', 'datetime', null, true],
  ];
  for (const [key, type, size, required] of sessionAttrs) {
    try {
      if (type === 'string') {
        await databases.createStringAttribute(DATABASE_ID, 'sessions', key as string, size as number, required as boolean);
      } else {
        await databases.createDatetimeAttribute(DATABASE_ID, 'sessions', key as string, required as boolean);
      }
      console.log(`  ✅ ${key}`);
    } catch (e: any) {}
  }

  // Create Messages collection
  console.log('\n📁 Creating Messages collection...');
  try {
    await databases.createCollection(DATABASE_ID, 'messages', 'Messages');
  } catch (e: any) {}
  
  const msgAttrs = [
    ['content', 'string', 10000, true],
    ['senderId', 'string', 100, true],
    ['receiverId', 'string', 100, false],
    ['channelId', 'string', 100, false],
    ['replyToId', 'string', 100, false],
    ['isRead', 'boolean', null, true],
    ['isVoice', 'boolean', null, true],
    ['voiceDuration', 'integer', null, false],
    ['voiceUrl', 'string', 500, false],
  ];
  for (const [key, type, size, required] of msgAttrs) {
    try {
      if (type === 'string') {
        await databases.createStringAttribute(DATABASE_ID, 'messages', key as string, size as number, required as boolean);
      } else if (type === 'boolean') {
        await databases.createBooleanAttribute(DATABASE_ID, 'messages', key as string, required as boolean, false);
      } else {
        await databases.createIntegerAttribute(DATABASE_ID, 'messages', key as string, required as boolean);
      }
      console.log(`  ✅ ${key}`);
    } catch (e: any) {}
  }

  // Create Contacts collection
  console.log('\n📁 Creating Contacts collection...');
  try {
    await databases.createCollection(DATABASE_ID, 'contacts', 'Contacts');
  } catch (e: any) {}
  const contactAttrs = [
    ['userId', 'string', 100, true],
    ['contactId', 'string', 100, true],
  ];
  for (const [key, type, size, required] of contactAttrs) {
    try {
      await databases.createStringAttribute(DATABASE_ID, 'contacts', key as string, size as number, required as boolean);
      console.log(`  ✅ ${key}`);
    } catch (e: any) {}
  }

  // Create Channels collection
  console.log('\n📁 Creating Channels collection...');
  try {
    await databases.createCollection(DATABASE_ID, 'channels', 'Channels');
  } catch (e: any) {}
  const channelAttrs = [
    ['name', 'string', 100, true],
    ['description', 'string', 500, false],
    ['isPrivate', 'boolean', null, true],
  ];
  for (const [key, type, size, required] of channelAttrs) {
    try {
      if (type === 'string') {
        await databases.createStringAttribute(DATABASE_ID, 'channels', key as string, size as number, required as boolean);
      } else {
        await databases.createBooleanAttribute(DATABASE_ID, 'channels', key as string, required as boolean, false);
      }
      console.log(`  ✅ ${key}`);
    } catch (e: any) {}
  }

  // Create ChannelMembers collection
  console.log('\n📁 Creating ChannelMembers collection...');
  try {
    await databases.createCollection(DATABASE_ID, 'channel_members', 'Channel Members');
  } catch (e: any) {}
  const cmAttrs = [
    ['channelId', 'string', 100, true],
    ['userId', 'string', 100, true],
    ['role', 'string', 50, true],
  ];
  for (const [key, type, size, required] of cmAttrs) {
    try {
      await databases.createStringAttribute(DATABASE_ID, 'channel_members', key as string, size as number, required as boolean);
      console.log(`  ✅ ${key}`);
    } catch (e: any) {}
  }

  console.log('\n🎉 Setup complete!');
}

setupDatabase().catch(console.error);
