import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import passport from './config/passport.js';

import { attachCustomer } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import orderRoutes from './routes/orders.js';
import adminCustomerRoutes from './routes/adminCustomers.js';
import productImageRoutes from './routes/productImages.js';
import uploadRoutes from './routes/uploads.js';
import productRoutes from './routes/products.js';
import adminProductRoutes from './routes/adminProducts.js';
import categoryRoutes, { adminCategoryRoutes } from './routes/categories.js';
import collectionRoutes, { adminCollectionRoutes } from './routes/collections.js';
import adminImportRoutes from './routes/adminImport.js';
import { testConnection } from './db/pool.js';
import { storageDriverName, isCloudinaryConfigured } from './services/storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
];

const missing = requiredEnvVars.filter((key) => !process.env[key]);

if (missing.length) {
  console.warn(`
==========================================
Missing Environment Variables

${missing.join('\n')}

Please configure them before production.
==========================================
`);
} else {
  console.log('[env] All required environment variables are present:', requiredEnvVars.join(', '));
}

// Render's own filesystem is wiped on every deploy/restart (no persistent
// disk by default) — the "local" storage driver is only safe for local dev.
// `RENDER` is set automatically by Render's runtime, so this fires
// specifically when actually running there, not on every non-cloudinary
// local dev boot. storageDriverName already auto-selects cloudinary when
// its credentials are present (see services/storage/index.js) — if this
// still isn't "cloudinary" here, the credentials themselves are genuinely
// missing/incomplete, not just the STORAGE_DRIVER flag.
if (process.env.RENDER && storageDriverName !== 'cloudinary') {
  console.error(`
==========================================
Image storage is using local disk on Render (driver: ${storageDriverName})

Uploaded product/category/collection images are being written to local
disk, which does NOT persist across deploys or restarts — every image will
be silently lost the next time this service redeploys.

CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are
${isCloudinaryConfigured ? 'present' : 'MISSING'} in this environment.
Set all three in Render's environment variables — STORAGE_DRIVER is
auto-detected once they're present, no need to set it separately.
==========================================
`);
} else {
  console.log(`[storage] Using "${storageDriverName}" driver.`);
}

const app = express();

app.set("trust proxy", 1);

/* ------------------------------------------
   CORS — must run before express.json()/routes below: the response headers
   it sets on `res` persist through the rest of the request (including into
   the error handler at the bottom) regardless of what happens later, but
   only if it runs first.
------------------------------------------ */

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://khayaalofficial.in",
  "https://www.khayaalofficial.in",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_HTTP,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`❌ Blocked by CORS: ${origin}`);

      // `credentials: true` below means this can never be "*" — an
      // unrecognized origin is a real reject, not a wildcard fallback.
      // err.status = 403 (rather than falling through to the default 500)
      // makes the rejection show up in logs/response as what it is: a
      // blocked origin, not a server bug.
      const err = new Error("Not allowed by CORS");
      err.status = 403;
      return callback(err);
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Admin-Key",
    ],

    // Lets browsers cache a preflight's result instead of re-sending an
    // OPTIONS request before every single GET (the frontend's apiClient
    // sends Content-Type: application/json even on GETs, which forces a
    // preflight on every request otherwise).
    maxAge: 86400,
  })
);

/* ------------------------------------------
   Middleware
------------------------------------------ */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(passport.initialize());

app.use(attachCustomer);

/* ------------------------------------------
   Request logging — one line per request, after it finishes (so the real
   status code is known), which is what Render's log viewer expects to
   tail. Kept as a plain middleware rather than a dependency (morgan etc.)
   since this is the entire feature set needed here.
------------------------------------------ */

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

/* ------------------------------------------
   Uploaded product images (static files)
------------------------------------------ */

import process from 'process';

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'))
);

/* ------------------------------------------
   Health Check
------------------------------------------ */

app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Khayaal Backend Running',
    environment: process.env.NODE_ENV || 'development',
    // Lets this be checked with a single request instead of digging through
    // Render's log history — "local" here means uploaded images will not
    // survive the next deploy/restart.
    storageDriver: storageDriverName,
    cloudinaryConfigured: isCloudinaryConfigured,
  });
});

/* ------------------------------------------
   Routes
------------------------------------------ */

app.use('/auth', authRoutes);

// More specific /api/* prefixes must be registered before the broad
// `/api` mount below — Express matches app.use() prefixes in registration
// order, not by specificity, and customerRoutes applies a blanket
// requireAuth to every request that reaches it. Mounted in the old order,
// any /api/admin/* or /api/orders/* request would hit customerRoutes'
// requireAuth first and get rejected before ever reaching its real route
// (this is what silently made adminCustomers.js unreachable — it was only
// ever protected by ADMIN_API_KEY, but requests never got that far).
app.use('/api/orders', orderRoutes);

app.use('/api/admin/customers', adminCustomerRoutes);

app.use('/api/admin/uploads', uploadRoutes);

app.use('/api/admin', productImageRoutes);

app.use('/api/admin/products', adminProductRoutes);
app.use('/api/admin/categories', adminCategoryRoutes);
app.use('/api/admin/collections', adminCollectionRoutes);
app.use('/api/admin/import', adminImportRoutes);

// Public catalog — no auth, top-level like /auth and /health (distinct from
// the /api namespace below, which is customer-account-authenticated).
app.use('/products', productRoutes);
app.use('/categories', categoryRoutes);
app.use('/collections', collectionRoutes);

app.use('/api', customerRoutes);

/* ------------------------------------------
   404 Handler
------------------------------------------ */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

/* ------------------------------------------
   Error Handler
------------------------------------------ */

// Postgres constraint violations are client errors (bad input), not server
// bugs — mapping them here means every route gets correct status codes for
// free (duplicate slug, a category_id/collection_id that doesn't exist,
// malformed JSON/array literal) without repeating try/catch in each route.
const PG_STATUS_BY_CODE = {
  '23505': 409, // unique_violation
  '23503': 400, // foreign_key_violation
  '23502': 400, // not_null_violation
  '22P02': 400, // invalid_text_representation
};
const PG_MESSAGE_BY_CODE = {
  '23505': 'A record with this value already exists.',
  '23503': 'Referenced record does not exist.',
  '23502': 'A required field is missing.',
  '22P02': 'One or more fields have an invalid value.',
};

app.use((err, req, res, next) => {
  // Some errors (e.g. pg-pool's AggregateError when every connection
  // attempt times out) carry an empty `.message` — falling back through
  // .code/.detail/name means the client never sees a blank "" message.
  const detail = err.message || err.code || err.detail || err.name || 'Unknown error';

  console.error('================================');
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.error('Route params:', req.params);
  console.error('Query:', req.query);
  if (req.body && Object.keys(req.body).length) console.error('Body:', req.body);
  if (req.files?.length) console.error('Uploaded files:', req.files.map((f) => ({ field: f.fieldname, name: f.originalname, size: f.size, mimetype: f.mimetype })));
  else if (req.file) console.error('Uploaded file:', { field: req.file.fieldname, name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
  console.error('Error:', detail);
  if (err.code) console.error('Error code:', err.code);
  if (err.errors) console.error('Nested errors:', err.errors);
  console.error(err.stack || err);
  console.error('================================');

  const status = err.status || PG_STATUS_BY_CODE[err.code] || 500;

  // Opt-in escape hatch: routes that tag their own DB errors with
  // exposeDbDetail (currently just adminProducts.js's INSERT/UPDATE
  // helper — an admin-only, already-authenticated router) get the real
  // Postgres message/detail/code back, to make "which field, exactly"
  // debuggable without digging through server logs. Every other route
  // keeps the generic mapped message below.
  if (err.exposeDbDetail) {
    return res.status(status).json({
      success: false,
      error: err.message,
      details: err.detail,
      code: err.code,
    });
  }

  // Client errors (4xx) get a safe, actionable message even in production —
  // they describe bad input, not an internal failure, so there's nothing
  // sensitive to hide. Only genuine 500s get masked.
  const isClientError = status >= 400 && status < 500;
  const clientMessage = PG_MESSAGE_BY_CODE[err.code] || detail;

  res.status(status).json({
    success: false,
    error: isClientError ? clientMessage : undefined,
    message: !isClientError && process.env.NODE_ENV === 'production' ? 'Internal Server Error' : clientMessage,
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
});

/* ------------------------------------------
   Start Server
------------------------------------------ */
const PORT = Number(process.env.PORT) || 4000;

async function start() {
  const dbCheck = await testConnection();

  console.log("================================");

  if (dbCheck.ok) {
    console.log(`✅ PostgreSQL connected — ${dbCheck.host}/${dbCheck.database} (ssl=${dbCheck.ssl}) in ${dbCheck.ms}ms`);
  } else {
    // "Do not continue silently" — print exactly what a human needs to
    // diagnose it. Does not stop the server from starting: most of the app
    // (storefront, admin catalogue) is localStorage-based and works with no
    // database at all; customer auth/orders will fail loudly per-request
    // instead (see error handler below and config/passport.js).
    console.error(`❌ PostgreSQL UNREACHABLE — host=${dbCheck.host} database=${dbCheck.database} ssl=${dbCheck.ssl} (after ${dbCheck.ms}ms)`);
    console.error('   Real error:', dbCheck.error?.message || dbCheck.error?.code || dbCheck.error);
    console.error('   Stack:', dbCheck.error?.stack);
    console.error('   Customer login, orders, and product image uploads will fail until this is fixed.');
  }

  console.log("================================");

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use.`);
      console.error("Stop the previous backend before starting a new one.");
      process.exit(1);
    }

    throw err;
  });

  // Render (and most container platforms) stop a service with SIGTERM, not
  // SIGINT — only handling SIGINT meant every deploy/restart killed
  // in-flight requests abruptly instead of letting them finish.
  const shutdown = (signal) => {
    console.log(`\n${signal} received, stopping server...`);
    server.close(() => process.exit(0));
    // Render gives a service ~10s to exit gracefully before SIGKILL — don't
    // hang past that waiting on a stuck connection.
    setTimeout(() => process.exit(1), 9000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();