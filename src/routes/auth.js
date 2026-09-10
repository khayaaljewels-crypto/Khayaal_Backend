import { Router } from 'express';
import jwt from 'jsonwebtoken';
import passport, { isGoogleAuthConfigured } from '../config/passport.js';
import { issueToken, setAuthCookie, clearAuthCookie, requireAuth } from '../middleware/auth.js';

const router = Router();

function requireGoogleConfigured(req, res, next) {
  if (!isGoogleAuthConfigured) {
    return res.status(503).json({
      error: 'Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL in server/.env.',
    });
  }
  next();
}

function requestedPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/my-account';
  try {
    const url = new URL(value, 'https://khayaal.invalid');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/my-account';
  }
}

function frontendUrl(path, error) {
  const origin = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const url = new URL(`${origin}${path}`);
  if (error) url.searchParams.set('error', error);
  return url.toString();
}

function createOAuthState(returnTo) {
  return jwt.sign(
    { purpose: 'google-oauth', returnTo: requestedPath(returnTo) },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function callbackDestination(state) {
  const payload = jwt.verify(state, process.env.JWT_SECRET);
  if (payload.purpose !== 'google-oauth') throw new Error('Invalid OAuth state');
  return requestedPath(payload.returnTo);
}

router.get(
  '/google',
  requireGoogleConfigured,
  (req, res, next) => {
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ error: 'Google sign-in is not configured yet.' });
    }
    return passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
      state: createOAuthState(req.query.returnTo),
    })(req, res, next);
  }
);

// Custom callback (instead of `failureRedirect`) so every possible outcome
// — a real server/DB error, Google denying/cancelling, or success — ends
// with the browser redirected back into the frontend SPA. Passport's
// built-in `failureRedirect` only covers the "auth failed" case; a thrown
// error (e.g. the database being unreachable) would otherwise fall through
// to Express's JSON error handler, which is correct for API calls but wrong
// here — this route is a full-page browser navigation target, so a JSON
// response looks like a broken/blank page, not a controlled failure.
router.get('/google/callback', requireGoogleConfigured, (req, res) => {
  const ua = req.headers['user-agent'] ?? '(none)';
  let returnTo;
  try {
    returnTo = callbackDestination(req.query.state);
  } catch {
    console.warn(`[auth] Google OAuth callback rejected invalid or expired state (ua="${ua}")`);
    return res.redirect(frontendUrl('/my-account', 'auth_expired'));
  }
  console.log("================================");
  console.log("GOOGLE CALLBACK RECEIVED");
  console.log("GOOGLE CALLBACK UA:", ua);
  console.log("================================");

  passport.authenticate('google', { session: false }, (err, user, info) => {
    const accountUrl = frontendUrl(returnTo);

    if (err) {
      console.error(`[auth] Google OAuth callback error (ua="${ua}"):`, err.message || err.code, err.stack);
      const reason = err.status === 503 ? 'server_unavailable' : 'server_error';
      return res.redirect(frontendUrl(returnTo, reason));
    }

    if (!user) {
      console.warn(`[auth] Google OAuth callback: authentication failed (ua="${ua}") —`, info?.message || 'no user returned');
      return res.redirect(frontendUrl(returnTo, 'auth_failed'));
    }

    try {
      const token = issueToken(user);
      setAuthCookie(req, res, token);
      console.log(`[auth] Google OAuth success — customerId=${user.id} email=${user.email} ua="${ua}" — redirecting to ${accountUrl}`);
      return res.redirect(accountUrl);
    } catch (tokenErr) {
      console.error(`[auth] Failed to issue JWT after successful Google auth (ua="${ua}"):`, tokenErr.message, tokenErr.stack);
      return res.redirect(frontendUrl(returnTo, 'server_error'));
    }
  })(req, res);
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ customer: sanitizeCustomer(req.customer) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

export function sanitizeCustomer(customer) {
  return {
    id: customer.id,
    fullName: customer.full_name,
    email: customer.email,
    profileImage: customer.profile_image,
    phone: customer.phone,
    status: customer.status,
    createdAt: customer.created_at,
    lastLogin: customer.last_login,
  };
}

export default router;
