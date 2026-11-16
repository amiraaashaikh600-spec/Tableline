import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from './models.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in the server environment before provisioning an admin.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 16) throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must be at least 16 characters.');

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tableline?replicaSet=rs0');
  const existing = await User.findOne({ email });
  if (existing && existing.role !== 'admin') throw new Error('ADMIN_EMAIL already belongs to a non-admin account. Choose a separate administrator address.');
  await User.findOneAndUpdate(
    { email },
    { name: existing?.name || 'Tableline Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`Administrator account provisioned for ${email}.`);
} finally {
  await mongoose.disconnect();
}
