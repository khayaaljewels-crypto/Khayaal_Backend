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
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error('Google account has no email'));

          const fullName = profile.displayName ?? 'Khayaal Customer';
          const profileImage = profile.photos?.[0]?.value ?? null;
          const googleId = profile.id;

          // Email is the unique identifier per spec — look up by email first.
          const existing = await pool.query('SELECT * FROM customers WHERE email = $1', [email]);

          let customer;
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

          if (customer.status === 'disabled') {
            return done(null, false, { message: 'This account has been disabled.' });
          }

          return done(null, customer);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

export default passport;
