import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import path from 'node:path';
import { createServer } from 'node:http';
import request from 'supertest';
import { io as socketClient } from 'socket.io-client';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApp } from './app.js';
import { ensureIndexes, User, Booking, BookingSlot, Restaurant, Table, Notification } from './models.js';
import { attachRealtime } from './realtime.js';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-that-is-longer-than-thirty-two-characters';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.MONGOMS_DOWNLOAD_DIR = path.resolve('.cache/mongodb-binaries');
process.env.MONGOMS_RESUME_DOWNLOAD = 'true';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
delete process.env.GEMINI_API_KEY;
delete process.env.RECOMMENDATION_PROVIDER;

let mongo;
let customer;
let secondCustomer;
let owner;
let otherOwner;
let admin;
let restaurant;
let table;
let httpServer;
let realtime;
let socketOrigin;
let geminiCreate;
let aiResponse;

const cloudinaryClient = {
  uploader: {
    upload_stream: vi.fn((_options, callback) => ({ end: () => callback(null, { secure_url: 'https://images.example.test/place.jpg', public_id: 'tableline/test-place' }) })),
    destroy: vi.fn(async () => ({ result: 'ok' })),
  },
};
const genAI = { interactions: { create: (...args) => geminiCreate(...args) } };
const app = createApp({ cloudinaryClient, genAI });

const register = async (agent, name, role = 'customer') => {
  const response = await agent.post('/api/auth/register').send({ name, email: `${name.toLowerCase().replaceAll(' ', '.')}@test.example`, password: 'tableline-test-password', role });
  expect(response.status).toBe(201);
  return response.body.user;
};

describe('Tableline API workflows', () => {
  beforeAll(async () => {
    if (process.env.MONGODB_TEST_URI) {
      const testDatabaseName = new URL(process.env.MONGODB_TEST_URI).pathname.split('/').filter(Boolean)[0] || '';
      if (!testDatabaseName.toLowerCase().includes('test')) {
        throw new Error('MONGODB_TEST_URI must point to a disposable database whose name includes "test".');
      }
      await mongoose.connect(process.env.MONGODB_TEST_URI);
    } else {
      mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
      await mongoose.connect(mongo.getUri());
    }
    await ensureIndexes();
    httpServer = createServer(app);
    realtime = attachRealtime(httpServer);
    app.set('io', realtime);
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    socketOrigin = `http://127.0.0.1:${httpServer.address().port}`;
  }, 900_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
    await new Promise(resolve => realtime?.close(() => resolve()));
    if (httpServer?.listening) await new Promise(resolve => httpServer.close(resolve));
  }, 30_000);

  beforeEach(async () => {
    await Promise.all([User, Booking, BookingSlot, Restaurant, Table, Notification].map(model => model.deleteMany({})));
    customer = request.agent(app);
    secondCustomer = request.agent(app);
    owner = request.agent(app);
    otherOwner = request.agent(app);
    admin = request.agent(app);
    geminiCreate = vi.fn(async () => ({ output_text: JSON.stringify(aiResponse) }));

    const customerUser = await register(customer, 'Jamie Taylor');
    await register(secondCustomer, 'Alex Rivera');
    const ownerUser = await register(owner, 'Morgan Lee', 'owner');
    await register(otherOwner, 'Taylor Quinn', 'owner');
    await User.create({ name: 'Tableline Admin', email: 'admin@test.example', passwordHash: await bcrypt.hash('tableline-test-password', 4), role: 'admin' });
    await admin.post('/api/auth/login').send({ email: 'admin@test.example', password: 'tableline-test-password' });
    restaurant = await Restaurant.create({
      ownerId: ownerUser.id,
      name: 'Juniper House',
      cuisine: 'Modern British',
      address: 'Soho, London',
      description: 'Seasonal cooking in a warm neighbourhood dining room.',
      openingTime: '12:00',
      closingTime: '23:00',
      status: 'active',
    });
    table = await Table.create({ restaurantId: restaurant._id, tableNumber: 'Window 01', capacity: 4 });
    expect(customerUser.role).toBe('customer');
  });

  it('registers and logs in with an HttpOnly session and enforces roles', async () => {
    const registration = await request(app).post('/api/auth/register').send({ name: 'Casey Example', email: 'Casey@Example.test', password: 'tableline-test-password', role: 'customer' });
    expect(registration.status).toBe(201);
    expect(registration.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(registration.body.user).not.toHaveProperty('passwordHash');
    const login = await request.agent(app).post('/api/auth/login').send({ email: 'casey@example.test', password: 'tableline-test-password' });
    expect(login.status).toBe(200);
    expect((await customer.get('/api/auth/me')).body.user.role).toBe('customer');
    expect((await customer.get('/api/owner/restaurants')).status).toBe(403);
    expect((await owner.get('/api/bookings/mine')).status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ email: 'casey@example.test', password: 'incorrect-password' })).status).toBe(401);
    const forgedAdmin = await request(app).post('/api/auth/register').send({ name: 'Public Admin', email: 'public-admin@test.example', password: 'tableline-test-password', role: 'admin' });
    expect(forgedAdmin.status).toBe(201);
    expect(forgedAdmin.body.user.role).toBe('customer');
  });

  it('keeps new restaurants private until an authorized administrator approves them', async () => {
    const submitted = await owner.post('/api/restaurants').send({ name: 'Pending House', cuisine: 'French', address: 'Chelsea, London', openingTime: '12:00', closingTime: '22:00' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe('pending');
    expect((await request(app).get('/api/restaurants?search=Pending House')).body).toHaveLength(0);
    expect((await owner.get('/api/admin/restaurants')).status).toBe(403);
    expect((await otherOwner.patch(`/api/admin/restaurants/${submitted.body._id}/status`).send({ status: 'active' })).status).toBe(403);
    expect((await owner.patch(`/api/admin/restaurants/${submitted.body._id}/status`).send({ status: 'active' })).status).toBe(403);
    const pending = await admin.get('/api/admin/restaurants?status=pending');
    expect(pending.status).toBe(200);
    expect(pending.body[0].ownerId.email).toBe('morgan.lee@test.example');
    expect((await admin.patch(`/api/admin/restaurants/${submitted.body._id}/status`).send({ status: 'active' })).body.status).toBe('active');
    expect((await request(app).get('/api/restaurants?search=Pending House')).body).toHaveLength(1);
    expect((await admin.patch(`/api/admin/restaurants/${submitted.body._id}/status`).send({ status: 'rejected' })).status).toBe(409);
    expect((await owner.get('/api/notifications/mine')).body.some(item => item.title === 'Restaurant approved')).toBe(true);
    const rejected = await owner.post('/api/restaurants').send({ name: 'Second Review House', cuisine: 'Greek', address: 'Camden, London' });
    expect(rejected.body.status).toBe('pending');
    expect((await admin.patch(`/api/admin/restaurants/${rejected.body._id}/status`).send({ status: 'rejected' })).body.status).toBe('rejected');
    expect((await owner.patch(`/api/restaurants/${rejected.body._id}`).field('description', 'Updated after review.')).body.status).toBe('pending');
    expect((await admin.get('/api/admin/restaurants')).body.some(item => item._id === rejected.body._id)).toBe(true);
  });

  it('safely removes a restaurant image after clearing its MongoDB metadata', async () => {
    const created = await owner.post('/api/restaurants')
      .field('name', 'Image Removal Kitchen').field('cuisine', 'Italian').field('address', 'Mayfair, London')
      .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), { filename: 'kitchen.png', contentType: 'image/png' });
    expect(created.status).toBe(201);
    const removed = await owner.patch(`/api/restaurants/${created.body._id}`).field('removeImage', 'true');
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ imageUrl: '', imagePublicId: '' });
    expect(cloudinaryClient.uploader.destroy).toHaveBeenCalledWith('tableline/test-place');
  });

  it('delivers user-scoped in-app notifications when bookings are created and updated', async () => {
    const payload = { restaurantId: restaurant.id, tableId: table.id, partySize: 2, bookingDate: '2032-05-12', startTime: '19:00' };
    const created = await customer.post('/api/bookings').send(payload);
    expect(created.status).toBe(201);
    const ownerNotifications = await owner.get('/api/notifications/mine');
    expect(ownerNotifications.body[0]).toMatchObject({ type: 'booking_created', bookingId: created.body._id });
    expect((await secondCustomer.get('/api/notifications/mine')).body).toEqual([]);
    const notificationId = ownerNotifications.body[0]._id;
    expect((await secondCustomer.patch(`/api/notifications/${notificationId}/read`).send({})).status).toBe(404);
    expect((await owner.patch(`/api/notifications/${notificationId}/read`).send({})).body.readAt).toBeTruthy();
    expect((await owner.patch(`/api/bookings/${created.body._id}/status`).send({ status: 'confirmed' })).status).toBe(200);
    expect((await customer.get('/api/notifications/mine')).body[0].message).toContain('confirmed');
  });

  it('pushes availability changes to connected restaurant watchers', async () => {
    const socket = socketClient(socketOrigin, { transports: ['websocket'], autoConnect: false });
    try {
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
      await new Promise((resolve, reject) => {
        socket.emit('availability:watch', { restaurantId: restaurant.id }, accepted => accepted ? resolve() : reject(new Error('Restaurant watch was rejected.')));
      });
      const changed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Availability update did not arrive.')), 3000);
        socket.once('availability:changed', event => { clearTimeout(timer); resolve(event); });
      });
      const response = await customer.post('/api/bookings').send({ restaurantId: restaurant.id, tableId: table.id, partySize: 2, bookingDate: '2032-08-10', startTime: '19:00' });
      expect(response.status).toBe(201);
      await expect(changed).resolves.toMatchObject({ restaurantId: restaurant.id, bookingDate: '2032-08-10' });
    } finally { socket.disconnect(); }
  });

  it('limits customer access to their own bookings', async () => {
    const payload = { restaurantId: restaurant.id, tableId: table.id, partySize: 2, bookingDate: '2030-05-12', startTime: '19:00', notes: '' };
    const created = await customer.post('/api/bookings').send(payload);
    expect(created.status).toBe(201);
    const id = created.body._id;
    expect((await secondCustomer.patch(`/api/bookings/${id}/status`).send({ status: 'cancelled' })).status).toBe(403);
    expect((await customer.get('/api/bookings/mine')).body).toHaveLength(1);
    expect((await secondCustomer.get('/api/bookings/mine')).body).toHaveLength(0);
  });

  it('filters public restaurant searches through MongoDB and omits owner-only fields', async () => {
    const response = await request(app).get('/api/restaurants?cuisine=british&location=soho&partySize=2');
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ name: 'Juniper House', cuisine: 'Modern British' });
    expect(response.body[0]).not.toHaveProperty('ownerId');
    expect(response.body[0]).not.toHaveProperty('imagePublicId');
    const details = await request(app).get(`/api/restaurants/${restaurant.id}`);
    expect(details.body.tables).toMatchObject([{ tableNumber: 'Window 01', capacity: 4 }]);
    expect(details.body.tables[0]).not.toHaveProperty('restaurantId');
  });

  it('rejects restaurant and table mutations by a different owner', async () => {
    expect((await otherOwner.patch(`/api/restaurants/${restaurant.id}`).field('name', 'Not yours')).status).toBe(404);
    expect((await otherOwner.patch(`/api/tables/${table.id}`).send({ capacity: 9 })).status).toBe(404);
    expect((await otherOwner.post(`/api/restaurants/${restaurant.id}/tables`).send({ tableNumber: 'Borrowed', capacity: 2 })).status).toBe(404);
  });

  it('lets owners manage their restaurant and tables without invalidating upcoming bookings', async () => {
    const createdRestaurant = await owner.post('/api/restaurants').send({
      name: 'Owner Created', cuisine: 'Italian', address: 'Mayfair, London',
      openingTime: '11:30', closingTime: '22:30', timeZone: 'Europe/London',
    });
    expect(createdRestaurant.status).toBe(201);
    expect(createdRestaurant.body.timeZone).toBe('Europe/London');
    const createdTable = await owner.post(`/api/restaurants/${createdRestaurant.body._id}/tables`).send({ tableNumber: 'Patio 01', capacity: 4 });
    expect(createdTable.status).toBe(201);
    const reservation = await customer.post('/api/bookings').send({ restaurantId: restaurant.id, tableId: table.id, partySize: 4, bookingDate: '2030-09-16', startTime: '19:00' });
    expect(reservation.status).toBe(201);
    expect((await owner.patch(`/api/tables/${table.id}`).send({ capacity: 2 })).status).toBe(409);
    expect((await owner.patch(`/api/tables/${table.id}`).send({ isActive: false })).status).toBe(409);
    const updated = await owner.patch(`/api/tables/${createdTable.body._id}`).send({ tableNumber: 'Terrace 01', capacity: 6, isActive: true });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ tableNumber: 'Terrace 01', capacity: 6, isActive: true });
    const profile = await owner.patch(`/api/restaurants/${createdRestaurant.body._id}`).field('name', 'Owner Created Again').field('timeZone', 'Europe/Paris');
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ name: 'Owner Created Again', timeZone: 'Europe/Paris' });
  });

  it('rejects malformed image contents even when the claimed mime type is allowed', async () => {
    const response = await owner.post('/api/restaurants')
      .field('name', 'Bad Image Kitchen').field('cuisine', 'Italian').field('address', 'Mayfair, London')
      .attach('image', Buffer.from('this is not a png'), { filename: 'fake.png', contentType: 'image/png' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('does not match');
  });

  it('stores secure Cloudinary image metadata when an owner creates a restaurant', async () => {
    const response = await owner.post('/api/restaurants')
      .field('name', 'Image Test Kitchen').field('cuisine', 'Italian').field('address', 'Mayfair, London')
      .field('openingTime', '12:00').field('closingTime', '22:00')
      .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), { filename: 'kitchen.png', contentType: 'image/png' });
    expect(response.status).toBe(201);
    expect(response.body.imageUrl).toBe('https://images.example.test/place.jpg');
    expect(response.body.imagePublicId).toBe('tableline/test-place');
    expect(cloudinaryClient.uploader.upload_stream).toHaveBeenCalledOnce();
  });

  it('returns only eligible database restaurants to the Gemini recommender', async () => {
    aiResponse = { ids: [restaurant.id, 'not-a-database-id'], message: 'A relaxed evening with seasonal British cooking.' };
    const response = await request(app).post('/api/assistant/recommend').send({ cuisine: 'British', location: 'Soho', partySize: 2, preference: 'A quiet dinner with seasonal food' });
    expect(response.status).toBe(200);
    expect(response.body.restaurants.map(item => item._id)).toEqual([restaurant.id]);
    expect(geminiCreate).toHaveBeenCalledOnce();
    expect(geminiCreate.mock.calls[0][0].input).toContain('Juniper House');
  });

  it('only recommends returned IDs from its eligible database shortlist', async () => {
    aiResponse = { ids: ['invented-id'], message: 'Some invented place.' };
    const response = await request(app).post('/api/assistant/recommend').send({ partySize: 2, preference: 'Somewhere calm' });
    expect(response.status).toBe(200);
    expect(response.body.restaurants).toEqual([]);
  });

  it('ranks only active restaurants with suitable tables in the no-key database demo mode', async () => {
    const sora = await Restaurant.create({
      ownerId: restaurant.ownerId,
      name: 'Sora House',
      cuisine: 'Japanese',
      address: 'Canary Wharf, London',
      description: 'Fresh sushi and a calm counter for an unhurried meal.',
      openingTime: '12:00',
      closingTime: '22:00',
      status: 'active',
    });
    const hidden = await Restaurant.create({
      ownerId: restaurant.ownerId,
      name: 'Hidden Sushi Room',
      cuisine: 'Japanese',
      address: 'Canary Wharf, London',
      status: 'rejected',
    });
    await Table.create([
      { restaurantId: sora._id, tableNumber: 'Counter 02', capacity: 6 },
      { restaurantId: hidden._id, tableNumber: 'Hidden 01', capacity: 8 },
    ]);
    const demoApp = createApp({ cloudinaryClient, recommendationProvider: 'demo' });
    const ranked = await request(demoApp).post('/api/assistant/recommend').send({ partySize: 2, preference: 'A warm, seasonal dinner' });
    expect(ranked.status).toBe(200);
    expect(ranked.body.mode).toBe('demo');
    expect(ranked.body.message).toContain('not AI-generated');
    expect(ranked.body.restaurants.map(item => item._id)[0]).toBe(String(restaurant._id));
    expect(ranked.body.restaurants.map(item => item._id)).not.toContain(String(hidden._id));

    const filtered = await request(demoApp).post('/api/assistant/recommend').send({ cuisine: 'Japanese', location: 'Canary Wharf', partySize: 6, preference: 'calm sushi' });
    expect(filtered.body.restaurants.map(item => item._id)).toEqual([String(sora._id)]);
    const tooLarge = await request(demoApp).post('/api/assistant/recommend').send({ partySize: 7, preference: 'seasonal dinner' });
    expect(tooLarge.body.mode).toBe('demo');
    expect(tooLarge.body.restaurants).toEqual([]);
    expect(geminiCreate).not.toHaveBeenCalled();
  });

  it('defaults to database demo mode without a Gemini key', async () => {
    const noKeyApp = createApp({ cloudinaryClient });
    const response = await request(noKeyApp).post('/api/assistant/recommend').send({ partySize: 2, preference: 'A table near the window' });
    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('demo');
    expect(response.body.message).toContain('not AI-generated');
    expect(response.body.restaurants).toHaveLength(1);
  });

  it('keeps Gemini available when selected without a key, with a clear setup response', async () => {
    const noAiApp = createApp({ cloudinaryClient, recommendationProvider: 'gemini' });
    const response = await request(noAiApp).post('/api/assistant/recommend').send({ partySize: 2, preference: 'A table near the window' });
    expect(response.status).toBe(503);
    expect(response.body.message).toContain('GEMINI_API_KEY');
  });

  it('serializes simultaneous and overlapping table requests and releases claims atomically on cancellation', async () => {
    const payload = { restaurantId: restaurant.id, tableId: table.id, partySize: 2, bookingDate: '2030-07-08', startTime: '19:00', notes: '' };
    const [first, second] = await Promise.all([customer.post('/api/bookings').send(payload), secondCustomer.post('/api/bookings').send(payload)]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winningAgent = first.status === 201 ? customer : secondCustomer;
    const booking = first.status === 201 ? first.body : second.body;
    expect(await Booking.countDocuments({ bookingDate: payload.bookingDate })).toBe(1);
    expect(await BookingSlot.countDocuments({ bookingId: booking._id })).toBe(3);
    expect((await request(app).get(`/api/availability?restaurantId=${restaurant.id}&date=${payload.bookingDate}&time=19:30&partySize=2`)).body).toHaveLength(0);
    const overlap = await customer.post('/api/bookings').send({ ...payload, startTime: '20:00' });
    expect(overlap.status).toBe(409);
    const adjacent = await request(app).get(`/api/availability?restaurantId=${restaurant.id}&date=${payload.bookingDate}&time=20:30&partySize=2`);
    expect(adjacent.body.map(item => item._id)).toContain(table.id);
    expect((await owner.patch(`/api/bookings/${booking._id}/status`).send({ status: 'confirmed' })).status).toBe(200);
    expect((await winningAgent.patch(`/api/bookings/${booking._id}/status`).send({ status: 'cancelled' })).status).toBe(200);
    expect(await BookingSlot.countDocuments({ bookingId: booking._id })).toBe(0);
    expect((await request(app).get(`/api/availability?restaurantId=${restaurant.id}&date=${payload.bookingDate}&time=19:00&partySize=2`)).body).toHaveLength(1);
    expect((await winningAgent.patch(`/api/bookings/${booking._id}/status`).send({ status: 'cancelled' })).status).toBe(409);
  });

  it('rejects past dates, invalid slot boundaries and capacity overflow', async () => {
    const base = { restaurantId: restaurant.id, tableId: table.id, partySize: 2, bookingDate: '2030-07-08', startTime: '19:00' };
    expect((await customer.post('/api/bookings').send({ ...base, bookingDate: '2020-01-01' })).status).toBe(400);
    expect((await customer.post('/api/bookings').send({ ...base, startTime: '19:10' })).status).toBe(400);
    expect((await customer.post('/api/bookings').send({ ...base, partySize: 6 })).status).toBe(400);
  });
});
