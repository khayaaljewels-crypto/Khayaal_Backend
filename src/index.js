import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from './config/passport.js';
import { attachCustomer } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import orderRoutes from './routes/orders.js';
import adminCustomerRoutes from './routes/adminCustomers.js';

const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const missing = requiredEnvVars.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(
    `⚠️  Missing environment variables: ${missing.join(', ')}. Copy server/.env.example to server/.env and fill them in. The server will start, but Google sign-in and the database will not work until this is done.`
  );
}

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());
app.use(attachCustomer);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/api', customerRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin/customers', adminCustomerRoutes);

app.use((err, req, res, next) => {
  console.error("========== FULL ERROR ==========");
  console.error(err);
  console.error(err.stack);
  console.error("================================");

  res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Khayaal backend listening on http://localhost:${port}`);
});
