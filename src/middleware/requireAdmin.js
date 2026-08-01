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

    console.log("==================================");
    console.log("Decoded Email :", decoded.email);
    console.log("Admin Email   :", process.env.ADMIN_EMAIL);
    console.log("UID           :", decoded.uid);
    console.log("==================================");

  } catch (err) {
    console.error(err);
    return res.status(401).json({
      error: 'Invalid or expired admin session.'
    });
  }

  const adminEmail = process.env.ADMIN_EMAIL;

  if (
    !adminEmail ||
    decoded.email?.trim().toLowerCase() !== adminEmail.trim().toLowerCase()
  ) {
    return res.status(403).json({
      error: 'Not authorized as admin.'
    });
  }

  req.admin = decoded;
  next();
}