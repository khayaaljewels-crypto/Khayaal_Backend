import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// FIREBASE_SERVICE_ACCOUNT_JSON holds the full service-account key JSON as a
// single-line string (Firebase Console -> Project Settings -> Service
// Accounts -> Generate new private key). Kept optional at import time (like
// isGoogleAuthConfigured in config/passport.js) so the server doesn't crash
// on boot before this is configured — requireAdmin below returns a clear
// 503 instead of the whole process failing to start.
export const isFirebaseAdminConfigured = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

let app = null;
if (isFirebaseAdminConfigured) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) });
} else {
  console.warn(
    '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON is not set — admin routes will reject every request with 503 until this is configured.'
  );
}

export const firebaseAuth = app ? getAuth(app) : null;
