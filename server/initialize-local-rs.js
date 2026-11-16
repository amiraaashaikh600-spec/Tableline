import 'dotenv/config';
import mongoose from 'mongoose';

const configuredUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tableline?replicaSet=rs0';
const configured = new URL(configuredUri);
if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname)) {
  throw new Error('This helper only initializes a local MongoDB service.');
}
const port = configured.port || '27017';
configured.pathname = '/admin';
configured.searchParams.delete('replicaSet');
configured.searchParams.set('directConnection', 'true');

let connection;
try {
  connection = await mongoose.createConnection(configured.toString(), { serverSelectionTimeoutMS: 8000 }).asPromise();
  const admin = connection.db.admin();
  let status;
  try {
    status = await admin.command({ replSetGetStatus: 1 });
  } catch (error) {
    if (error.codeName === 'NoReplicationEnabled' || error.code === 76) {
      throw new Error('MongoDB is reachable but replication is not enabled. Run the administrator setup script to add replSetName: rs0, then retry.');
    }
    if (error.codeName !== 'NotYetInitialized' && error.code !== 94) throw error;
    await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    console.log('Initialized rs0 on the existing local MongoDB data directory. Waiting for PRIMARY...');
  }

  if (status && status.set !== 'rs0') throw new Error(`This MongoDB instance already belongs to replica set ${status.set}; no changes were made.`);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const hello = await admin.command({ hello: 1 });
    if (hello.setName && hello.setName !== 'rs0') throw new Error(`MongoDB reports replica set ${hello.setName}, expected rs0.`);
    if (hello.isWritablePrimary) {
      console.log(`MongoDB replica set rs0 is PRIMARY at 127.0.0.1:${port}. Existing databases and collections were preserved.`);
      process.exitCode = 0;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (process.exitCode !== 0) throw new Error('MongoDB did not become PRIMARY within 45 seconds. Inspect the MongoDB service log before retrying.');
} catch (error) {
  console.error(`Local MongoDB setup did not complete: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection?.close();
}
