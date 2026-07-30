# Khayaal Jewels — Backend

Express + PostgreSQL API for Khayaal Jewels. Handles customer Google OAuth login, orders,
saved addresses, and admin product image uploads. This repository is the **backend only** —
it deploys independently to Railway and is called over HTTP by a separate frontend repository
(React/Vite, deployed to Vercel).

> The product/category catalog, cart, and wishlist are **not** handled here — they live
> entirely in the frontend's `localStorage`. This backend only owns customer auth, orders,
> addresses, and image uploads.

## Tech Stack

- Node.js + Express
- PostgreSQL (`pg`) — designed for [Neon](https://neon.tech)
- Passport.js (Google OAuth 2.0 strategy) + stateless JWT (no server-side sessions)
- Multer + Sharp (image upload + processing)

## Getting Started

```bash
npm install
cp .env.example .env   # fill in the values — see below
npm run migrate         # creates customers, addresses, orders, order_items, product_images tables
npm run dev              # starts on http://localhost:4000 (nodemon, auto-restart)
```

`npm run dev` first runs `predev` (`kill-port 4000`), so it's safe to re-run even if a previous
instance didn't shut down cleanly.

## Environment Variables

See `.env.example` for the full list with detailed explanations. Summary:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string — local Postgres in dev, Neon in production |
| `JWT_SECRET` | Signs the customer auth JWT (stored in an httpOnly cookie) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Google Cloud OAuth client (not Firebase) |
| `FRONTEND_URL` / `FRONTEND_URL_HTTP` | Allowed CORS origin(s) — the deployed frontend's URL(s) |
| `PORT` | Port to listen on — Railway sets this automatically |
| `NODE_ENV` | Must be `production` on Railway — flips auth cookies to `secure` + `sameSite=none`, required for the frontend (Vercel) and backend (Railway) living on different domains |
| `ADMIN_API_KEY` | Interim key gating `/api/admin/customers` until real Firebase-Admin-SDK verification is wired up |

The server logs a clear warning on startup listing any of the required vars
(`DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`)
that are missing.

## Database (Neon PostgreSQL)

1. Create a project at [neon.tech](https://neon.tech) and copy its connection string
   (already includes `?sslmode=require`, which `pg` picks up automatically).
2. Set it as `DATABASE_URL` in Railway's environment variables.
3. Run `npm run migrate` once (locally, pointed at the Neon URL, or via Railway's shell)
   to create the schema — see `src/db/schema.sql` for the table definitions.

`src/db/pool.js` also disables Node's `autoSelectFamily` and forces IPv4-first DNS resolution —
this is a deliberate fix for an intermittent IPv6-related connection issue when reaching Neon
from certain networks, not something to remove.

## File Uploads

Product images are processed with Sharp and saved locally under `uploads/` (served statically
at `/uploads/*`) via the driver in `src/services/storage/`.

**Railway note:** Railway's filesystem is ephemeral — anything written to `uploads/` will be
lost on redeploy or restart. This mirrors the current local-disk behavior exactly (no change
in application logic), but for durable production uploads you'd eventually want to add an S3 /
Cloudinary / GCS driver alongside `localDriver.js` and set `STORAGE_DRIVER` accordingly — the
storage layer (`src/services/storage/index.js`) is already built to support that via a
`{ save, remove, getUrl }` driver interface, only `local` is implemented today.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start with nodemon (auto-restart), killing anything already on the port first |
| `npm start` | Start once, no auto-restart (production) |
| `npm run migrate` | Run `src/db/schema.sql` against `DATABASE_URL` |

## Deployment (Railway)

1. Create a new Railway project from this repository.
2. Railway auto-detects Node.js from `package.json` and runs `npm install` + `npm start` —
   no Dockerfile or extra config needed.
3. Set all the environment variables listed above in Railway's dashboard, in particular:
   - `NODE_ENV=production`
   - `DATABASE_URL` → your Neon connection string
   - `FRONTEND_URL` → your deployed Vercel URL (exact origin, e.g. `https://khayaal-jewels.vercel.app`, no trailing slash)
   - `GOOGLE_CALLBACK_URL` → `https://<your-railway-domain>/auth/google/callback`, and add that
     same URL to the Google Cloud OAuth client's "Authorized redirect URIs"
4. Run the migration once against the Neon database (`npm run migrate`, pointed at the same
   `DATABASE_URL` Railway uses) before the first deploy that needs it.
5. Point the frontend's `VITE_API_URL` (in Vercel's environment variables) at this backend's
   Railway URL.

## API Routes

| Mount | File | Purpose |
|---|---|---|
| `/auth` | `src/routes/auth.js` | Google OAuth login/callback/logout |
| `/api/orders` | `src/routes/orders.js` | Customer order creation/history |
| `/api/admin/customers` | `src/routes/adminCustomers.js` | Admin customer list (interim `ADMIN_API_KEY` gate) |
| `/api/admin/uploads` | `src/routes/uploads.js` | General admin file uploads |
| `/api/admin` | `src/routes/productImages.js` | Product image upload/management |
| `/api` | `src/routes/customers.js` | Customer profile/addresses (requires auth) |
| `/uploads/*` | static | Serves uploaded files from `uploads/` |
| `/health` | `src/index.js` | Health check |

Route registration order in `src/index.js` matters — more specific `/api/*` prefixes are
mounted before the broad `/api` one, since `customerRoutes` applies auth to everything it
receives.

## Further Documentation

The frontend repository's `PROJECT_DOCUMENTATION/` folder has additional detail on the auth
system, database structure, and API — written before this split, so it describes this backend
as `server/` inside that repo; the content otherwise still applies.
