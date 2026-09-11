import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

export const COOKIE_NAME = 'khayaal_token';

// Enable only while diagnosing a live authentication incident (for example in
// Render: AUTH_DEBUG=true). Authentication runs on every request, so this is
// deliberately opt-in and never logs a bearer token.
const authDebugEnabled = process.env.AUTH_DEBUG === 'true';

function authDebug(req, message, extra = {}) {
  if (!authDebugEnabled) return;
  console.log('[AUTH DEBUG]', {
    method: req.method,
    path: req.originalUrl,
    origin: req.headers.origin,
    host: req.headers.host,
    secure: req.secure,
    cookiePresent: Boolean(req.cookies?.[COOKIE_NAME]),
    message,
    ...extra,
  });
}

export function issueToken(customer) {
  return jwt.sign({ customerId: customer.id, email: customer.email }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

// Render is behind a TLS proxy. index.js enables trust proxy, so req.secure
// correctly determines whether this response is HTTPS. In production the
// callback is served to the browser through the HTTPS frontend origin, even
// though Vercel forwards it to Render. Keep the cookie same-site: it is a
// host-only cookie for that frontend origin, not a cross-site Render cookie.
function cookieOptions(req) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(req.secure);
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  };
}

export function setAuthCookie(req, res, token) {
  const options = cookieOptions(req);
  authDebug(req, 'issuing auth cookie', {
    cookieSecure: options.secure,
    cookieSameSite: options.sameSite,
  });
  res.cookie(COOKIE_NAME, token, { ...options, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookie(req, res) {
  // The attributes must match the cookie being removed, otherwise browsers
  // treat the clearing response as a different cookie.
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Attaches req.customer if a valid token cookie is present; does not reject
// the request either way. Use requireAuth on routes that must be protected.
export async function attachCustomer(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  authDebug(req, 'authentication middleware entered');

  if (!token) return next();

  try {
    authDebug(req, 'JWT verification started');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [payload.customerId]);
    if (result.rows[0] && result.rows[0].status !== 'disabled') {
      req.customer = result.rows[0];
      authDebug(req, 'JWT verification successful');
    } else {
      authDebug(req, 'JWT verified but customer is unavailable', {
        customerFound: Boolean(result.rows[0]),
        customerDisabled: result.rows[0]?.status === 'disabled',
      });
    }
  } catch (err) {
    // Invalid/expired JWT or a database failure both leave the request
    // unauthenticated. Do not expose operational details to the client.
    if (authDebugEnabled) {
      console.error('[AUTH DEBUG] JWT verification failed:', err.message || err.code);
    }
  }

  next();
}

// A customer can only access their own data; protected routes use
// req.customer.id, never a customer id supplied by the client.
export function requireAuth(req, res, next) {
  if (!req.customer) return res.status(401).json({ error: 'Not signed in.' });
  next();
}
