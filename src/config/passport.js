import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { pool } from '../db/pool.js';

// Stateless JWT auth — Passport is only used to run the Google OAuth
// handshake, not for server-side sessions. No serializeUser/deserializeUser
// or express-session is configured on purpose.

export const isGoogleAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL
);

// The Google strategy constructor throws immediately if clientID/clientSecret
// are missing — registering it unconditionally would crash the whole server
// before it even starts (e.g. when DB routes are being tested ahead of
// having real Google credentials). Only register it once configured; the
// /auth/google routes check isGoogleAuthConfigured and return a clear error
// instead of hitting an unregistered strategy.
if (isGoogleAuthConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error('Google account has no email'));

        const fullName = profile.displayName ?? 'Khayaal Customer';
        const profileImage = profile.photos?.[0]?.value ?? null;
        const googleId = profile.id;

        // Each DB step is wrapped separately so a failure is attributed to
        // the exact query that caused it (matches the error-logging
        // requirement: which SQL, not just "something in passport failed").
        // A connection-level failure (DB unreachable, not a real SQL error)
        // gets `err.status = 503` so the client sees "Service Unavailable"
        // instead of a generic 500 — the OAuth flow does not continue
        // without the database; there is no guest/fallback identity to fall
        // back to for a signed-in customer account.
        let existing;
        try {
          // Email is the unique identifier per spec — look up by email first.
          existing = await pool.query('SELECT * FROM customers WHERE email = $1', [email]);
        } catch (err) {
          console.error(`[auth] Google OAuth: customer lookup failed for email=${email}`);
          console.error('[auth] SQL: SELECT * FROM customers WHERE email = $1', [email]);
          console.error('[auth] Error:', err.message || err.code, err.stack);
          err.status = 503;
          err.message = `Database unavailable during Google login (customer lookup): ${err.message || err.code || 'connection failed'}`;
          return done(err);
        }

        let customer;
        try {
          if (existing.rows.length > 0) {
            const updated = await pool.query(
              `UPDATE customers
               SET google_id = $1, full_name = $2, profile_image = $3, last_login = now(), updated_at = now()
               WHERE email = $4
               RETURNING *`,
              [googleId, fullName, profileImage, email]
            );
            customer = updated.rows[0];
          } else {
            const inserted = await pool.query(
              `INSERT INTO customers (google_id, email, full_name, profile_image, last_login)
               VALUES ($1, $2, $3, $4, now())
               RETURNING *`,
              [googleId, email, fullName, profileImage]
            );
            customer = inserted.rows[0];
          }
        } catch (err) {
          const stage = existing.rows.length > 0 ? 'UPDATE customers' : 'INSERT INTO customers';
          console.error(`[auth] Google OAuth: ${stage} failed for email=${email}`);
          console.error('[auth] Error:', err.message || err.code, err.stack);
          err.status = err.status || (err.code?.startsWith?.('E') ? 503 : 500);
          err.message = `Database error during Google login (${stage}): ${err.message || err.code || 'unknown error'}`;
          return done(err);
        }

        if (customer.status === 'disabled') {
          return done(null, false, { message: 'This account has been disabled.' });
        }

        return done(null, customer);
      }
    )
  );
}

export default passport;
