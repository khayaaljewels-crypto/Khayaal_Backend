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
import { testConnection } from './db/pool.js';

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

const app = express();

/* ------------------------------------------
   CORS
------------------------------------------ */

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_HTTP,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked Origin:", origin);

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`Blocked by CORS: ${origin}`);

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
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
   Uploaded product images (static files)
------------------------------------------ */

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

/* ------------------------------------------
   Health Check
------------------------------------------ */

app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Khayaal Backend Running',
    environment: process.env.NODE_ENV || 'development',
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

  const status = err.status || 500;

  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : detail,
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

  process.on("SIGINT", () => {
    console.log("\nStopping server...");
    server.close(() => process.exit(0));
  });
}

start();