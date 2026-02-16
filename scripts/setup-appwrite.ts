import { Client, Databases, Storage, ID, Permission, Role } from 'node-appwrite';

const client = new Client()
  .setEndpoint('https://fra.cloud.appwrite.io/v1')
  .setProject('69923291001c25654226')
  .setKey('standard_a89389c81e380b12111f2f16141bc23936864dd812791762294a8bc2936f62753744aa5735a0afce8f50dbcfa72b54b3222431478f4c7d5da20d38c0aa0d88e5e96fd26d289fc24fc632baa3d09aa6cb7f5282c51a5bee661b29d7b6e8c4582ed9e4b74786a4819e0310a3c8f0187d4f4c96129f096e47d0202326eb10bd11a1');

const databases = new Databases(client);
const storage = new Storage(client);

const DATABASE_ID = 'void-mes-db';
const MESSAGES_COLLECTION_ID = 'messages';
const UPLOADS_BUCKET_ID = 'uploads';

async function setup() {
  console.log('🚀 Starting Appwrite setup...\n');

  // 1. Create Database
  try {
    console.log('📦 Creating database...');
    await databases.create(DATABASE_ID, 'Void MES Database');
    console.log('✅ Database created!\n');
  } catch (e: any) {
    if (e.code === 409) {
      console.log('✅ Database already exists\n');
    } else {
      console.log('❌ Database error:', e.message);
    }
  }

  // 2. Create Messages Collection
  try {
    console.log('📝 Creating messages collection...');
    await databases.createCollection(
      DATABASE_ID,
      MESSAGES_COLLECTION_ID,
      'Messages',
      [
        Permission.read(Role.any()),
        Permission.create(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ]
    );
    console.log('✅ Messages collection created!\n');
  } catch (e: any) {
    if (e.code === 409) {
      console.log('✅ Messages collection already exists\n');
    } else {
      console.log('❌ Collection error:', e.message);
    }
  }

  // 3. Create Attributes for Messages
  const attributes = [
    { key: 'senderId', type: 'string', size: 255, required: true },
    { key: 'receiverId', type: 'string', size: 255, required: false },
    { key: 'channelId', type: 'string', size: 255, required: false },
    { key: 'content', type: 'string', size: 10000, required: false },
    { key: 'isVoice', type: 'boolean', required: false, def: false },
    { key: 'voiceDuration', type: 'integer', required: false, def: 0 },
    { key: 'voiceUrl', type: 'string', size: 500, required: false },
    { key: 'replyToId', type: 'string', size: 255, required: false },
    { key: 'attachments', type: 'string', size: 5000, required: false },
    { key: 'type', type: 'string', size: 50, required: false, def: 'message' },
  ];

  for (const attr of attributes) {
    try {
      console.log(`  Adding attribute: ${attr.key}...`);
      if (attr.type === 'string') {
        await databases.createStringAttribute(
          DATABASE_ID,
          MESSAGES_COLLECTION_ID,
          attr.key,
          attr.size || 255,
          attr.required || false
        );
      } else if (attr.type === 'boolean') {
        await databases.createBooleanAttribute(
          DATABASE_ID,
          MESSAGES_COLLECTION_ID,
          attr.key,
          attr.required || false,
          attr.def
        );
      } else if (attr.type === 'integer') {
        await databases.createIntegerAttribute(
          DATABASE_ID,
          MESSAGES_COLLECTION_ID,
          attr.key,
          attr.required || false,
          attr.def as number | undefined,
          undefined,
          undefined
        );
      }
      console.log(`  ✅ ${attr.key} added`);
    } catch (e: any) {
      if (e.code === 409) {
        console.log(`  ✅ ${attr.key} already exists`);
      } else {
        console.log(`  ⚠️ ${attr.key}: ${e.message}`);
      }
    }
  }

  // 4. Create Storage Bucket
  try {
    console.log('\n📁 Creating uploads bucket...');
    await storage.createBucket(
      UPLOADS_BUCKET_ID,
      'Uploads',
      [
        Permission.read(Role.any()),
        Permission.create(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ],
      false, // fileSecurity
      true, // enabled
      10485760, // maxFileSize (10MB)
      ['image/*', 'audio/*', 'video/*', 'application/*'], // allowedFileExtensions
      ['image/*', 'audio/*', 'video/*', 'application/pdf', 'application/*'], // compression
      true, // antivirus
      true // encryption
    );
    console.log('✅ Uploads bucket created!\n');
  } catch (e: any) {
    if (e.code === 409) {
      console.log('✅ Uploads bucket already exists\n');
    } else {
      console.log('❌ Bucket error:', e.message);
    }
  }

  // 5. Create indexes for better queries
  const indexes = [
    { key: 'idx_sender', attributes: ['senderId'] },
    { key: 'idx_receiver', attributes: ['receiverId'] },
    { key: 'idx_channel', attributes: ['channelId'] },
    { key: 'idx_created', attributes: ['$createdAt'] },
  ];

  for (const idx of indexes) {
    try {
      console.log(`  Creating index: ${idx.key}...`);
      await databases.createIndex(
        DATABASE_ID,
        MESSAGES_COLLECTION_ID,
        idx.key,
        'key',
        idx.attributes
      );
      console.log(`  ✅ ${idx.key} created`);
    } catch (e: any) {
      if (e.code === 409) {
        console.log(`  ✅ ${idx.key} already exists`);
      } else {
        console.log(`  ⚠️ ${idx.key}: ${e.message}`);
      }
    }
  }

  console.log('\n🎉 Setup complete!');
  console.log('\n📋 Summary:');
  console.log(`  Database ID: ${DATABASE_ID}`);
  console.log(`  Messages Collection: ${MESSAGES_COLLECTION_ID}`);
  console.log(`  Uploads Bucket: ${UPLOADS_BUCKET_ID}`);
}

setup().catch(console.error);
