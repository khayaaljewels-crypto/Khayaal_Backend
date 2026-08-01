import { firebaseAuth, isFirebaseAdminConfigured } from '../config/firebaseAdmin.js';

export async function requireAdmin(req, res, next) {
  if (!isFirebaseAdminConfigured) {
    return res.status(503).json({ error: 'Admin auth is not configured on this server.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing admin credentials.' });
  }

  let decoded;

  try {
    decoded = await firebaseAuth.verifyIdToken(token);
  } catch (err) {
    console.warn(`[requireAdmin] token verification failed for ${req.method} ${req.originalUrl}:`, err.message || err.code);
    return res.status(401).json({
      error: 'Invalid or expired admin session.'
    });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const authorized = Boolean(adminEmail) && decoded.email?.trim().toLowerCase() === adminEmail.trim().toLowerCase();

  console.log(`[requireAdmin] ${req.method} ${req.originalUrl} — decodedEmail=${decoded.email} authorized=${authorized}`);

  if (!authorized) {
    return res.status(403).json({
      error: 'Not authorized as admin.'
    });
  }

  req.admin = decoded;
  next();
}