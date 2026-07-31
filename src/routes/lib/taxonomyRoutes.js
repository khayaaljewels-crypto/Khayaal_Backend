import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdmin } from '../../middleware/requireAdmin.js';
import { slugify } from '../../utils/slugify.js';

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function serialize(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    image: row.image,
    hidden: row.hidden,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// categories and collections are identical in shape and CRUD behavior today
// (see PROJECT_DOCUMENTATION / CategoryManager.jsx vs CollectionManager.jsx) —
// this factory builds both a public (visible-only, no auth) router and an
// admin (all rows, requireAdmin-gated) router for either table, so the two
// resources don't need near-duplicate route files.
export function createTaxonomyRoutes(table) {
  const publicRouter = Router();
  const adminRouter = Router();

  publicRouter.get(
    '/',
    asyncHandler(async (_req, res) => {
      const result = await pool.query(
        `SELECT * FROM ${table} WHERE hidden = false ORDER BY display_order ASC, name ASC`
      );
      res.json({ [table]: result.rows.map(serialize) });
    })
  );

  adminRouter.use(requireAdmin);

  adminRouter.get(
    '/',
    asyncHandler(async (_req, res) => {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY display_order ASC, name ASC`);
      res.json({ [table]: result.rows.map(serialize) });
    })
  );

  adminRouter.post(
    '/',
    asyncHandler(async (req, res) => {
      const { name, description = null, image = null, hidden = false, displayOrder = 0 } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required.' });
      const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);

      const result = await pool.query(
        `INSERT INTO ${table} (slug, name, description, image, hidden, display_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [slug, name, description, image, hidden, displayOrder]
      );
      res.status(201).json({ [table.slice(0, -1)]: serialize(result.rows[0]) });
    })
  );

  adminRouter.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const current = existing.rows[0];

      const name = req.body.name ?? current.name;
      const slug = req.body.slug ? slugify(req.body.slug) : req.body.name ? slugify(req.body.name) : current.slug;
      const description = req.body.description ?? current.description;
      const image = req.body.image ?? current.image;
      const hidden = req.body.hidden ?? current.hidden;
      const displayOrder = req.body.displayOrder ?? current.display_order;

      const result = await pool.query(
        `UPDATE ${table}
         SET slug = $1, name = $2, description = $3, image = $4, hidden = $5, display_order = $6, updated_at = now()
         WHERE id = $7
         RETURNING *`,
        [slug, name, description, image, hidden, displayOrder, req.params.id]
      );
      res.json({ [table.slice(0, -1)]: serialize(result.rows[0]) });
    })
  );

  adminRouter.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      res.json({ ok: true });
    })
  );

  return { publicRouter, adminRouter };
}
