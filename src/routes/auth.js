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

router.get(
  '/google/callback',
  requireGoogleConfigured,
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/my-account?error=auth_failed` }),
  (req, res) => {
    const token = issueToken(req.user);
    setAuthCookie(res, token);
    res.redirect(`${process.env.FRONTEND_URL}/my-account`);
  }
);

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
