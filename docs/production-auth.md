# Production customer authentication

Customer authentication is **Google OAuth -> backend JWT -> `khayaal_token` cookie**. Firebase Admin does not take part in customer sign-in; it only verifies Firebase ID tokens for admin routes.

The production frontend is `https://www.khayaalofficial.in` and calls the backend directly at `https://khayaal-backend.onrender.com`. Public catalog routes remain at the root (`/products`, `/categories`, `/collections`, `/occasions`); account and admin routes retain their existing paths, including `/api/...` where registered.

Customer browser requests to the Render API must include credentials (`credentials: 'include'` for fetch or `withCredentials: true` for Axios). The Google sign-in button must navigate to the Render URL `/auth/google?returnTo=/my-account`; configure Google's authorized redirect URI to the exact `GOOGLE_CALLBACK_URL` on Render. The callback issues an HttpOnly, host-only cookie for `khayaal-backend.onrender.com` with `Secure; SameSite=None; Path=/` in production. There is no `Domain` attribute.

Because the frontend and backend are on different sites, this is a third-party cookie. `SameSite=None; Secure` permits cross-site use, but browsers or privacy settings that block third-party cookies can still prevent it. For reliable customer cookie auth in those browsers, the frontend would need a same-site proxy; the current direct architecture cannot override browser third-party-cookie restrictions.

## Required production settings

Configure these in Render (preserve existing database and secret values; do not expose them):

```
FRONTEND_URL=https://www.khayaalofficial.in
GOOGLE_CALLBACK_URL=https://khayaal-backend.onrender.com/auth/google/callback
JWT_SECRET=<stable secret>
DATABASE_URL=<production database URL>
NODE_ENV=production
```

Add the Render callback URL to the Google OAuth client's authorized redirect URIs. Retain both `khayaalofficial.in` and `www.khayaalofficial.in` in Firebase Authentication authorized domains; the customer flow itself uses the Google OAuth client above.

Render must serve HTTPS with `trust proxy` enabled (already configured in `src/index.js`). Production cookie options are `HttpOnly; Secure; SameSite=None; Path=/` with no `Domain` attribute. `trust proxy` is set to one hop so Express sees the original HTTPS request and IP behind Render.

## Short-lived diagnostics

Temporarily set `AUTH_DEBUG=true` in Render, deploy, and complete one login in an incognito browser. Expected `/auth/me` logs include:

```
cookiePresent: true
JWT verification started
JWT verification successful
```

If `cookiePresent` is false after a successful callback, inspect browser third-party-cookie settings and confirm frontend requests include credentials. Remove `AUTH_DEBUG` once confirmed.
