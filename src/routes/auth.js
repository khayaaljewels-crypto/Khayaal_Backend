import { Router } from 'express';
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

router.get(
  '/google',
  requireGoogleConfigured,
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
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
  passport.authenticate('google', { session: false }, (err, user, info) => {
    const accountUrl = `${process.env.FRONTEND_URL}/my-account`;

    if (err) {
      console.error('[auth] Google OAuth callback error:', err.message || err.code, err.stack);
      const reason = err.status === 503 ? 'server_unavailable' : 'server_error';
      return res.redirect(`${accountUrl}?error=${reason}`);
    }

    if (!user) {
      console.warn('[auth] Google OAuth callback: authentication failed —', info?.message || 'no user returned');
      return res.redirect(`${accountUrl}?error=auth_failed`);
    }

    try {
      const token = issueToken(user);
      setAuthCookie(res, token);
      return res.redirect(accountUrl);
    } catch (tokenErr) {
      console.error('[auth] Failed to issue JWT after successful Google auth:', tokenErr.message, tokenErr.stack);
      return res.redirect(`${accountUrl}?error=server_error`);
    }
  })(req, res);
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ customer: sanitizeCustomer(req.customer) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
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
