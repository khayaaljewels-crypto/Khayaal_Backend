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
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
}

// Attaches req.customer if a valid token cookie is present; does not reject
// the request either way. Use `requireAuth` on routes that must be protected.
export async function attachCustomer(req, _res, next) {
  console.log("==================================");
  console.log("URL:", req.originalUrl);
  console.log("Origin:", req.headers.origin);
  console.log("Cookie Header:", req.headers.cookie);

  const token = req.cookies?.[COOKIE_NAME];

  console.log("JWT Token:", token);
  console.log("==================================");

  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [payload.customerId]
    );

    if (result.rows[0]) {
      req.customer = result.rows[0];
    }
  } catch (err) {
    console.error(err);
  }

  next();
}

// A customer can only ever access their own data — every protected route
// reads req.customer.id, never a customer id supplied by the client.
export function requireAuth(req, res, next) {
  if (!req.customer) return res.status(401).json({ error: 'Not signed in.' });
  next();
}
