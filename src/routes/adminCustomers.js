import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

// INTERIM PROTECTION ONLY — not wired into the admin frontend yet.
//
// The admin dashboard authenticates with Firebase (see
// PROJECT_DOCUMENTATION/07_AUTH_SYSTEM.md), while this backend only knows
// about the customer-facing JWT cookie system. Properly protecting these
// routes for real admin use requires verifying the admin's Firebase ID
// token here with the Firebase Admin SDK (needs a service-account key,
// which hasn't been provided/configured yet). Until that's wired up, these
// routes are gated by a shared secret header meant for local
// testing/curl/Postman only — do NOT expose this key in any frontend code,
// and do NOT treat this as production-ready admin auth.
function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Missing or invalid admin key.' });
  }
  next();
}

router.use(requireAdminKey);

router.get('/', async (req, res) => {
  const { search } = req.query;
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`;
  }

  const result = await pool.query(
    `SELECT c.*, COUNT(o.id) AS order_count, COALESCE(SUM(o.grand_total), 0) AS total_spent
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY c.last_login DESC`,
    params
  );

  res.json({
    customers: result.rows.map((c) => ({
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      profileImage: c.profile_image,
      phone: c.phone,
      status: c.status,
      createdAt: c.created_at,
      lastLogin: c.last_login,
      orderCount: Number(c.order_count),
      totalSpent: Number(c.total_spent),
    })),
  });
});

router.get('/:id', async (req, res) => {
  const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (customerResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });

  const ordersResult = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [
    req.params.id,
  ]);

  const c = customerResult.rows[0];
  res.json({
    customer: {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      profileImage: c.profile_image,
      phone: c.phone,
      status: c.status,
      createdAt: c.created_at,
      lastLogin: c.last_login,
    },
    orders: ordersResult.rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      grandTotal: Number(o.grand_total),
      createdAt: o.created_at,
    })),
  });
});

export default router;
