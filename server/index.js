import 'dotenv/config';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { attachRealtime } from './realtime.js';
import { createApp } from './app.js';
import { ensureIndexes } from './models.js';

const port = Number(process.env.PORT || 5000);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is required and must contain at least 32 characters.');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tableline?replicaSet=rs0', { serverSelectionTimeoutMS: 8000 });
  await ensureIndexes();
  const app = createApp();
  const server = createServer(app);
  app.set('io', attachRealtime(server));
  server.on('error', async error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Tableline could not start because port ${port} is already in use. Stop the other process or set PORT to an unused port.`);
    } else {
      console.error(`Tableline HTTP server failed: ${error.message}`);
    }
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
  server.listen(port, () => console.log(`Tableline is listening on port ${port}.`));
} catch (error) {
  if (error.name === 'MongooseServerSelectionError') {
    console.error('Tableline could not connect to MongoDB. Verify the local MongoDB service is running, rs0 is PRIMARY, and MONGODB_URI targets tableline on port 27017.');
  } else {
    console.error(`Tableline could not start: ${error.message}`);
  }
  process.exit(1);
}
