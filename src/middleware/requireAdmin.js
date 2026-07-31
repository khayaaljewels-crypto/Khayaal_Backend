import { firebaseAuth, isFirebaseAdminConfigured } from '../config/firebaseAdmin.js';

// Verifies the admin dashboard's existing Firebase ID token server-side —
// the frontend attaches it as `Authorization: Bearer <token>` on every
// /api/admin/* call (see apiClient.js's admin token provider). Replaces the
// interim ADMIN_API_KEY approach for anything reachable from browser JS
// (a shared secret can't be used there without shipping it in the bundle).
export async function requireAdmin(req, res, next) {
  if (!isFirebaseAdminConfigured) {
    return res.status(500).json({ error: 'Admin auth is not configured on this server.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing admin credentials.' });

  let decoded;
  try {
    decoded = await firebaseAuth.verifyIdToken(token);
  } catch (err) {
    console.warn('[requireAdmin] token verification failed:', err.message || err.code);
    return res.status(401).json({ error: 'Invalid or expired admin session.' });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || decoded.email?.toLowerCase() !== adminEmail.toLowerCase()) {
    return res.status(403).json({ error: 'Not authorized as admin.' });
  }

  req.admin = decoded;
  next();
}
