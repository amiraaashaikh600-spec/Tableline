import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Restaurant, Table } from './models.js';
import { restaurants } from './seed-data.js';

if (process.env.NODE_ENV === 'production') throw new Error('The demo seed is disabled in production.');
if (Boolean(process.env.ADMIN_EMAIL) !== Boolean(process.env.ADMIN_PASSWORD)) throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to provision the admin account.');

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tableline?replicaSet=rs0');
  const owner = await User.findOneAndUpdate(
    { email: 'owner@tableline.demo' },
    { name: 'Alex Morgan', email: 'owner@tableline.demo', passwordHash: await bcrypt.hash('tableline123', 12), role: 'owner' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const customer = await User.findOneAndUpdate(
    { email: 'hello@tableline.demo' },
    { name: 'Jamie Taylor', email: 'hello@tableline.demo', passwordHash: await bcrypt.hash('tableline123', 12), role: 'customer' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  for (const data of restaurants) {
    const restaurant = await Restaurant.findOneAndUpdate(
      { name: data.name, ownerId: owner._id },
      { ...data, timeZone: 'Europe/London', ownerId: owner._id, status: 'active' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    for (const table of data.tables) {
      await Table.findOneAndUpdate(
        { restaurantId: restaurant._id, tableNumber: table.tableNumber },
        { restaurantId: restaurant._id, ...table, isActive: true },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
  }
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 16) throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must be at least 16 characters.');
    const existingAdmin = await User.findOne({ email }).select('+passwordHash');
    if (existingAdmin && existingAdmin.role !== 'admin') throw new Error('ADMIN_EMAIL already belongs to a non-admin account.');
    await User.findOneAndUpdate(
      { email },
      { name: 'Tableline Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  console.log(`Seeded ${restaurants.length} restaurants, ${owner.email}, ${customer.email}${process.env.ADMIN_EMAIL ? ` and admin ${process.env.ADMIN_EMAIL}` : ''}.`);
} finally {
  await mongoose.disconnect();
}
