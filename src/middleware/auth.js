import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

export const COOKIE_NAME = 'khayaal_token';

export function issueToken(customer) {
  return jwt.sign({ customerId: customer.id, email: customer.email }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

// SameSite=None;Secure is required for the cookie to be sent at all when the
// frontend and backend are on different domains (Vercel + Render) — true for
// both desktop and mobile browsers, since this is a first-party cookie set
// via a top-level redirect (see routes/auth.js), not a third-party/iframe
// context, so it isn't affected by Safari/Chrome's third-party cookie
// blocking.
//
// Derived from req.secure (not NODE_ENV): index.js sets `trust proxy`, so
// Express reads Render's `X-Forwarded-Proto: https` correctly and req.secure
// is accurate regardless of whether NODE_ENV happens to be configured on the
// host. Only false for genuine local http://localhost dev, where a `Secure`
// cookie would be silently refused by the browser and `SameSite=None`
// without `Secure` is rejected outright — falling back to Lax there is what
// actually lets the cookie be set at all.
function cookieOptions(req) {
  const secure = Boolean(req.secure);
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
  };
}

export function setAuthCookie(req, res, token) {
  const options = cookieOptions(req);
  // Mobile-vs-desktop redirect-loop reports need to confirm exactly what
  // attributes actually went out on Set-Cookie for a given device, without
  // guessing from req.secure alone — logged here, at the point of the real
  // res.cookie() call, not derived separately.
  console.log(
    `[auth] setAuthCookie — secure=${options.secure} sameSite=${options.sameSite} origin=${req.headers.origin ?? '(none)'} ua="${req.headers['user-agent'] ?? '(none)'}"`
  );
  res.cookie(COOKIE_NAME, token, { ...options, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookie(req, res) {
  // Must be called with the exact same attributes the cookie was set with —
  // otherwise the browser treats it as a different cookie and never clears
  // the real one, leaving the customer silently still "logged in".
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Attaches req.customer if a valid token cookie is present; does not reject
// the request either way. Use `requireAuth` on routes that must be protected.
export async function attachCustomer(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];

  // Enough to diagnose "cookie not arriving" / "cross-site auth failing"
  // reports (which browser/origin, whether a cookie made it to the server
  // at all) without ever printing the token itself — it's a 30-day bearer
  // credential, and logs (Render's dashboard, log drains) are readable by
  // more people than just this admin.
  console.log(
    `[auth] ${req.method} ${req.originalUrl} — origin=${req.headers.origin ?? '(none)'} secure=${req.secure} cookiePresent=${Boolean(token)} ua="${req.headers['user-agent'] ?? '(none)'}"`
  );

  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [payload.customerId]);
    if (result.rows[0] && result.rows[0].status !== 'disabled') {
      req.customer = result.rows[0];
    }
  } catch (err) {
    // Invalid/expired token, or the DB briefly unreachable — treat the
    // request as signed-out rather than failing it outright.
    console.warn(`[auth] attachCustomer: session not resolved for ${req.method} ${req.originalUrl} — ${err.message || err.code}`);
  }

  next();
}

// A customer can only ever access their own data — every protected route
// reads req.customer.id, never a customer id supplied by the client.
export function requireAuth(req, res, next) {
  if (!req.customer) return res.status(401).json({ error: 'Not signed in.' });
  next();
}
