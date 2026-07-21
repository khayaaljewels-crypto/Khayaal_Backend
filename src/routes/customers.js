import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { sanitizeCustomer } from './auth.js';

const router = Router();

router.use(requireAuth);

// --- Profile ---

router.get('/me', (req, res) => {
  res.json({ customer: sanitizeCustomer(req.customer) });
});

router.put('/me', async (req, res) => {
  const { fullName, phone } = req.body;
  const result = await pool.query(
    `UPDATE customers SET full_name = COALESCE($1, full_name), phone = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [fullName?.trim() || null, phone?.trim() || null, req.customer.id]
  );
  res.json({ customer: sanitizeCustomer(result.rows[0]) });
});

// --- Addresses ---
// A customer can only ever read/write rows where customer_id = req.customer.id —
// never trusts an id supplied by the client for ownership checks.

function sanitizeAddress(a) {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipient_name,
    recipientPhone: a.recipient_phone,
    address: a.address_line,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    landmark: a.landmark,
    isDefault: a.is_default,
  };
}

router.get('/me/addresses', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at ASC',
    [req.customer.id]
  );
  res.json({ addresses: result.rows.map(sanitizeAddress) });
});

router.post('/me/addresses', async (req, res) => {
  const { label, recipientName, recipientPhone, address, city, state, pincode, landmark, isDefault } = req.body;
  if (!recipientName || !recipientPhone || !address || !city || !state || !pincode) {
    return res.status(400).json({ error: 'Missing required address fields.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query('UPDATE addresses SET is_default = false WHERE customer_id = $1', [req.customer.id]);
    }
    const countResult = await client.query('SELECT COUNT(*) FROM addresses WHERE customer_id = $1', [req.customer.id]);
    const isFirst = Number(countResult.rows[0].count) === 0;

    const inserted = await client.query(
      `INSERT INTO addresses (customer_id, label, recipient_name, recipient_phone, address_line, city, state, pincode, landmark, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.customer.id, label || 'Home', recipientName, recipientPhone, address, city, state, pincode, landmark || null, isDefault || isFirst]
    );
    await client.query('COMMIT');
    res.status(201).json({ address: sanitizeAddress(inserted.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/me/addresses/:id', async (req, res) => {
  const { label, recipientName, recipientPhone, address, city, state, pincode, landmark, isDefault } = req.body;

  const owns = await pool.query('SELECT id FROM addresses WHERE id = $1 AND customer_id = $2', [req.params.id, req.customer.id]);
  if (owns.rows.length === 0) return res.status(404).json({ error: 'Address not found.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query('UPDATE addresses SET is_default = false WHERE customer_id = $1', [req.customer.id]);
    }
    const updated = await client.query(
      `UPDATE addresses SET label = $1, recipient_name = $2, recipient_phone = $3, address_line = $4,
       city = $5, state = $6, pincode = $7, landmark = $8, is_default = $9, updated_at = now()
       WHERE id = $10 AND customer_id = $11 RETURNING *`,
      [label, recipientName, recipientPhone, address, city, state, pincode, landmark || null, Boolean(isDefault), req.params.id, req.customer.id]
    );
    await client.query('COMMIT');
    res.json({ address: sanitizeAddress(updated.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/me/addresses/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM addresses WHERE id = $1 AND customer_id = $2 RETURNING id', [
    req.params.id,
    req.customer.id,
  ]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Address not found.' });
  res.json({ ok: true });
});

router.post('/me/addresses/:id/default', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE addresses SET is_default = false WHERE customer_id = $1', [req.customer.id]);
    const updated = await client.query(
      'UPDATE addresses SET is_default = true WHERE id = $1 AND customer_id = $2 RETURNING *',
      [req.params.id, req.customer.id]
    );
    await client.query('COMMIT');
    if (updated.rows.length === 0) return res.status(404).json({ error: 'Address not found.' });
    res.json({ address: sanitizeAddress(updated.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
