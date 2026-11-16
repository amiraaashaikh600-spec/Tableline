import nodemailer from 'nodemailer';
import { Notification } from './models.js';

let mailer;
const getMailer = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (![SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM].every(Boolean)) return null;
  mailer ||= nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return mailer;
};

export async function notifyUser({ user, type, title, message, bookingId, restaurantId }, io) {
  if (!user?._id) return;
  try {
    const notification = await Notification.create({ userId: user._id, type, title, message, bookingId, restaurantId });
    io?.to(`user:${user._id}`).emit('notification:new', notification.toObject());
  } catch {
    console.error('Tableline could not save an in-app notification.');
  }

  const transport = getMailer();
  if (transport && user.email) {
    void transport.sendMail({ from: process.env.SMTP_FROM, to: user.email, subject: title, text: message })
      .catch(() => console.error('Tableline could not send an email notification. Check SMTP configuration.'));
  }
}
