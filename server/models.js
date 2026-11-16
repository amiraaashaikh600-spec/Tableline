import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  phone: { type: String, trim: true, maxlength: 30 },
  role: { type: String, enum: ['customer', 'owner', 'admin'], default: 'customer', required: true },
}, { timestamps: true });

const restaurantSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 1500, default: '' },
  cuisine: { type: String, required: true, trim: true, maxlength: 60 },
  address: { type: String, required: true, trim: true, maxlength: 200 },
  phone: { type: String, trim: true, maxlength: 30, default: '' },
  openingTime: { type: String, required: true, default: '12:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  closingTime: { type: String, required: true, default: '22:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  timeZone: { type: String, required: true, default: 'UTC', maxlength: 60 },
  imageUrl: { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending', index: true },
}, { timestamps: true });

const tableSchema = new Schema({
  restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  tableNumber: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
  capacity: { type: Number, required: true, min: 1, max: 30 },
  isActive: { type: Boolean, default: true },
  reservationVersion: { type: Number, default: 0, select: false },
}, { timestamps: true });
tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });

const bookingSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
  partySize: { type: Number, required: true, min: 1, max: 30 },
  bookingDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'], default: 'pending', index: true },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true });
bookingSchema.index({ customerId: 1, bookingDate: 1, startTime: 1 });
bookingSchema.index({ restaurantId: 1, bookingDate: 1, status: 1, startTime: 1 });

const bookingSlotSchema = new Schema({
  tableId: { type: Schema.Types.ObjectId, required: true },
  bookingDate: { type: String, required: true },
  slot: { type: String, required: true },
  bookingId: { type: Schema.Types.ObjectId, required: true, index: true },
});
bookingSlotSchema.index({ tableId: 1, bookingDate: 1, slot: 1 }, { unique: true });

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['booking_created', 'booking_updated', 'restaurant_review'], required: true },
  title: { type: String, required: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 500 },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant' },
  readAt: { type: Date, default: null },
}, { timestamps: true });
notificationSchema.index({ userId:  1, createdAt: -1 });

export const User = model('User', userSchema);
export const Restaurant = model('Restaurant', restaurantSchema);
export const Table = model('Table', tableSchema);
export const Booking = model('Booking', bookingSchema);
export const BookingSlot = model('BookingSlot', bookingSlotSchema);
export const Notification = model('Notification', notificationSchema);

export async function ensureIndexes() {
  await Promise.all([User.init(), Restaurant.init(), Table.init(), Booking.init(), BookingSlot.init(), Notification.init()]);
}
