import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { Restaurant, User } from './models.js';

export function attachRealtime(httpServer) {
  const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(origin => origin.trim()).filter(Boolean);
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    serveClient: false,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  });

  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const token = cookieHeader.match(/(?:^|;\s*)tableline_session=([^;]+)/)?.[1];
    if (!token) return next();
    try {
      const { id } = jwt.verify(decodeURIComponent(token), process.env.JWT_SECRET, { issuer: 'tableline' });
      const user = await User.findById(id).select('_id role');
      if (!user) return next(new Error('Your session has expired.'));
      socket.data.userId = String(user._id);
      return next();
    } catch {
      return next(new Error('Your session is invalid or expired.'));
    }
  });

  io.on('connection', socket => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    socket.on('availability:watch', async (payload, acknowledge) => {
      const id = String(payload?.restaurantId || '');
      if (!/^[a-f\d]{24}$/i.test(id)) return acknowledge?.(false);
      const exists = await Restaurant.exists({ _id: id, status: 'active' });
      if (exists) socket.join(`restaurant:${id}`);
      acknowledge?.(Boolean(exists));
    });
  });

  return io;
}

export function emitAvailability(io, restaurantId, bookingDate) {
  io?.to(`restaurant:${restaurantId}`).emit('availability:changed', { restaurantId: String(restaurantId), bookingDate });
}
