import jwt from 'jsonwebtoken';
import { User } from './models.js';

export async function auth(req, res, next) {
  try {
    const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = req.cookies?.tableline_session || bearer;
    if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });

    const { id } = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'tableline' });
    const user = await User.findById(id);
    if (!user) return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: 'Your session is invalid or expired. Please sign in again.' });
  }
}

export const role = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission to do that.' });
  return next();
};

export const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
