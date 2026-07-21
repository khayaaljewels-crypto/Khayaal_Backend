import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

function sanitizeOrder(order, items) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    recipientName: order.recipient_name,
    recipientPhone: order.recipient_phone,
    address: order.address_line,
    city: order.city,
    state: order.state,
    pincode: order.pincode,
    landmark: order.landmark,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    shippingFee: Number(order.shipping_fee),
    grandTotal: Number(order.grand_total),
    coupon: order.coupon,
    notes: order.notes,
    items: (items ?? []).map((i) => ({
      productId: i.product_id,
      name: i.product_name,
      image: i.product_image,
      variantLabel: i.variant_label,
      quantity: i.quantity,
      price: Number(i.price),
      lineTotal: Number(i.line_total),
    })),
  };
}

// List the signed-in customer's own orders — never accepts a customer id
// from the client, always scoped to req.customer.id.
router.get('/me', async (req, res) => {
  const ordersResult = await pool.query(
    'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
    [req.customer.id]
  );
  const orderIds = ordersResult.rows.map((o) => o.id);
  const itemsResult = orderIds.length
    ? await pool.query('SELECT * FROM order_items WHERE order_id = ANY($1::int[])', [orderIds])
    : { rows: [] };

  const orders = ordersResult.rows.map((o) =>
    sanitizeOrder(o, itemsResult.rows.filter((i) => i.order_id === o.id))
  );
  res.json({ orders });
});

router.get('/me/:id', async (req, res) => {
  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [
    req.params.id,
    req.customer.id,
  ]);
  if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });

  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id]);
  res.json({ order: sanitizeOrder(orderResult.rows[0], itemsResult.rows) });
});

// Create an order for the signed-in customer. Called from Checkout in
// addition to (not instead of) the existing WhatsApp order flow — see
// PROJECT_DOCUMENTATION for how the two systems currently coexist.
router.post('/', async (req, res) => {
  const {
    recipientName, recipientPhone, address, city, state, pincode, landmark,
    items, subtotal, discount, shippingFee, grandTotal, coupon, notes,
  } = req.body;

  if (!recipientName || !recipientPhone || !address || !city || !state || !pincode) {
    return res.status(400).json({ error: 'Missing required delivery details.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must include at least one item.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const seqResult = await client.query("SELECT 'KH' || LPAD(nextval('order_number_seq')::text, 4, '0') AS order_number");
    const orderNumber = seqResult.rows[0].order_number;

    const orderResult = await client.query(
      `INSERT INTO orders
        (order_number, customer_id, recipient_name, recipient_phone, address_line, city, state, pincode, landmark,
         subtotal, discount, shipping_fee, grand_total, coupon, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [orderNumber, req.customer.id, recipientName, recipientPhone, address, city, state, pincode, landmark || null,
       subtotal || 0, discount || 0, shippingFee || 0, grandTotal || 0, coupon || null, notes || null]
    );
    const order = orderResult.rows[0];

    const insertedItems = [];
    for (const item of items) {
      const itemResult = await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, variant_label, quantity, price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [order.id, item.productId, item.name, item.image || null, item.variantLabel || null, item.quantity, item.price, item.lineTotal]
      );
      insertedItems.push(itemResult.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({ order: sanitizeOrder(order, insertedItems) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
