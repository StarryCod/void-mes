import { Client, Storage, Permission, Role } from 'node-appwrite';

const client = new Client()
  .setEndpoint('https://fra.cloud.appwrite.io/v1')
  .setProject('69923291001c25654226')
  .setKey('standard_a89389c81e380b12111f2f16141bc23936864dd812791762294a8bc2936f62753744aa5735a0afce8f50dbcfa72b54b3222431478f4c7d5da20d38c0aa0d88e5e96fd26d289fc24fc632baa3d09aa6cb7f5282c51a5bee661b29d7b6e8c4582ed9e4b74786a4819e0310a3c8f0187d4f4c96129f096e47d0202326eb10bd11a1');

const storage = new Storage(client);

async function setupBucket() {
  try {
    console.log('📁 Creating uploads bucket...');
    const bucket = await storage.createBucket(
      'uploads',
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
      [], // allowedFileExtensions (empty = all)
      'none', // compression
      true, // antivirus
      true // encryption
    );
    console.log('✅ Uploads bucket created!', bucket.$id);
  } catch (e: any) {
    if (e.code === 409) {
      console.log('✅ Uploads bucket already exists');
    } else {
      console.log('❌ Error:', e.message);
    }
  }
}

setupBucket();
