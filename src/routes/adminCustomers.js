import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

// This exposes real customer PII (email, phone, order totals), so it's
// gated the same way as every other /api/admin/* route: the admin
// dashboard's real Firebase ID token, verified server-side. Previously
// gated by a shared ADMIN_API_KEY header meant only for local curl/Postman
// testing — not safe as the only protection for a PII-returning endpoint,
// and requireAdmin has been available (and used everywhere else) since
// Firebase Admin was wired up.
router.use(requireAdmin);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

router.get('/', asyncHandler(async (req, res) => {
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
}));

router.get('/:id', asyncHandler(async (req, res) => {
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
}));

export default router;
