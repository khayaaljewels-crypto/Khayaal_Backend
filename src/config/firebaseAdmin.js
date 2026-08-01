import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export const isFirebaseAdminConfigured = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

let app = null;

try {
  if (isFirebaseAdminConfigured) {
    console.log("Loading Firebase Admin...");

    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );

    app = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert(serviceAccount),
        });

    console.log("Firebase Admin initialized successfully");
  } else {
    console.log("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  }
} catch (err) {
  console.error("Firebase Admin failed to initialize");
  console.error(err);
}

export const firebaseAuth = app ? getAuth(app) : null;