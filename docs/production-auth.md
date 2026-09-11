# Production customer authentication

Customer authentication is **Google OAuth -> backend JWT -> `khayaal_token` cookie**. Firebase Admin does not take part in customer sign-in; it only verifies Firebase ID tokens for admin routes.

The browser-facing API must have one canonical origin: `https://www.khayaalofficial.in/api`. Do not start customer Google OAuth on the Render hostname. A cookie created for `khayaal-backend.onrender.com` is host-only and cannot be sent to `www.khayaalofficial.in`.

## Frontend deployment

Configure the frontend host to proxy the API prefix to Render while stripping `/api`. For Vercel, `vercel.json` must contain:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://khayaal-backend.onrender.com/:path*"
    }
  ]
}
```

The proxy must pass browser `Cookie` headers upstream and return Render's `Set-Cookie` header unchanged. The Google sign-in button must navigate, rather than fetch, to `/api/auth/google?returnTo=/my-account`.

All customer API calls must use the same relative `/api` base URL. For fetch use `credentials: 'include'`; for Axios set `withCredentials: true` on the shared client. Do not use a direct Render URL for login, `/auth/me`, logout, orders, profile, addresses, or wishlist.

The rewrite removes `/api`, so `/api/auth/me` reaches this backend as `/auth/me`, the route registered in `src/routes/auth.js`.

## Required production settings

After rotating any exposed credentials, set the following in Render:

```
FRONTEND_URL=https://www.khayaalofficial.in
GOOGLE_CALLBACK_URL=https://www.khayaalofficial.in/api/auth/google/callback
JWT_SECRET=<one stable, rotated secret>
DATABASE_URL=<production database URL>
```

Add `https://www.khayaalofficial.in/api/auth/google/callback` to the Google OAuth client's authorized redirect URIs. Retain both `khayaalofficial.in` and `www.khayaalofficial.in` in Firebase Authentication authorized domains; the customer flow itself uses the Google OAuth client above.

Render must serve HTTPS with `trust proxy` enabled (already configured in `src/index.js`). The callback then emits an HttpOnly, `Secure; SameSite=Lax; Path=/` cookie with **no `Domain` attribute**. Because the browser receives the callback response at `www.khayaalofficial.in`, this makes `khayaal_token` a host-only cookie for that public frontend host.

## Short-lived diagnostics

Temporarily set `AUTH_DEBUG=true` in Render, deploy, and complete one login in an incognito browser. Expected `/auth/me` logs include:

```
cookiePresent: true
JWT verification started
JWT verification successful
```

If `cookiePresent` is false after a successful callback, the callback was not same-origin or the proxy did not forward `Set-Cookie`/`Cookie`. Remove `AUTH_DEBUG` once confirmed.
