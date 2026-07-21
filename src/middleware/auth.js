import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

export const COOKIE_NAME = 'khayaal_token';

export function issueToken(customer) {
  return jwt.sign({ customerId: customer.id, email: customer.email }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Attaches req.customer if a valid token cookie is present; does not reject
// the request either way. Use `requireAuth` on routes that must be protected.
export async function attachCustomer(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [payload.customerId]);
    if (result.rows[0] && result.rows[0].status !== 'disabled') {
      req.customer = result.rows[0];
    }
  } catch {
    // invalid/expired token — treat as signed out, don't throw
  }
  next();
}

// A customer can only ever access their own data — every protected route
// reads req.customer.id, never a customer id supplied by the client.
export function requireAuth(req, res, next) {
  if (!req.customer) return res.status(401).json({ error: 'Not signed in.' });
  next();
}
