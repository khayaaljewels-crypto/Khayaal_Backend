import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { slugify } from '../utils/slugify.js';
import {
  toArray,
  queryProducts,
  getProductById,
  getImagesForProductIds,
  serializeProduct,
} from './lib/productQuery.js';

const router = Router();
router.use(requireAdmin);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function generateId() {
  return `kj-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Admin list — same filter/sort/pagination as the public list, but sees
// unpublished products too and adds the stock-status filter ProductList.jsx
// already deep-links to (?stock=low|out).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, search, minPrice, maxPrice, minRating, sort, stock } = req.query;
    const { rows, total, page: p, pageSize: ps } = await queryProducts({
      page,
      pageSize,
      search,
      category: toArray(req.query.category),
      collection: toArray(req.query.collection),
      material: toArray(req.query.material),
      stone: toArray(req.query.stone),
      color: toArray(req.query.color),
      occasion: toArray(req.query.occasion),
      minPrice,
      maxPrice,
      minRating,
      sort,
      onlyPublished: false,
      stockStatus: stock,
    });

    const images = await getImagesForProductIds(rows.map((r) => r.id), req);
    res.json({
      products: rows.map((r) => serializeProduct(r, { images: images[r.id] ?? [], includeCostPrice: true })),
      meta: { page: p, pageSize: ps, total },
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getProductById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    const images = await getImagesForProductIds([row.id], req);
    res.json({ product: serializeProduct(row, { images: images[row.id] ?? [], includeCostPrice: true }) });
  })
);

const FIELD_MAP = {
  name: 'name',
  sku: 'sku',
  brand: 'brand',
  occasion: 'occasion',
  price: 'price',
  oldPrice: 'old_price',
  costPrice: 'cost_price',
  stockQty: 'stock_qty',
  material: 'material',
  stone: 'stone',
  color: 'color',
  rating: 'rating',
  reviewCount: 'review_count',
  description: 'description',
  shortDescription: 'short_description',
  careInstructions: 'care_instructions',
  tags: 'tags',
  specs: 'specs',
  deliveryDays: 'delivery_days',
  returnDays: 'return_days',
  codAvailable: 'cod_available',
  variants: 'variants',
  ringSizes: 'ring_sizes',
  isBestSeller: 'is_best_seller',
  isNewArrival: 'is_new_arrival',
  isFeatured: 'is_featured',
  isTrending: 'is_trending',
  isComingSoon: 'is_coming_soon',
  isPublished: 'is_published',
  categoryId: 'category_id',
  collectionId: 'collection_id',
};

// JSONB/array columns need an explicit cast in the parameterized query, or
// `pg` sends them as a plain string/array literal Postgres can't coerce.
const COLUMN_CASTS = { tags: '::text[]', specs: '::jsonb', variants: '::jsonb', ring_sizes: '::jsonb' };

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });

    const id = req.body.id || generateId();
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(name);

    const columns = ['id', 'slug'];
    const values = [id, slug];
    const placeholders = ['$1', '$2'];

    for (const [jsField, column] of Object.entries(FIELD_MAP)) {
      if (req.body[jsField] === undefined) continue;
      columns.push(column);
      values.push(req.body[jsField]);
      placeholders.push(`$${values.length}${COLUMN_CASTS[column] ?? ''}`);
    }

    const result = await pool.query(
      `INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    );
    const row = await getProductById(result.rows[0].id);
    res.status(201).json({ product: serializeProduct(row, { includeCostPrice: true }) });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const setClauses = [];
    const values = [];

    if (req.body.slug !== undefined || req.body.name !== undefined) {
      const newSlug = req.body.slug ? slugify(req.body.slug) : slugify(req.body.name ?? existing.name);
      values.push(newSlug);
      setClauses.push(`slug = $${values.length}`);
    }

    for (const [jsField, column] of Object.entries(FIELD_MAP)) {
      if (req.body[jsField] === undefined) continue;
      values.push(req.body[jsField]);
      setClauses.push(`${column} = $${values.length}${COLUMN_CASTS[column] ?? ''}`);
    }

    setClauses.push('updated_at = now()');
    values.push(req.params.id);

    await pool.query(`UPDATE products SET ${setClauses.join(', ')} WHERE id = $${values.length}`, values);
    const row = await getProductById(req.params.id);
    const images = await getImagesForProductIds([row.id], req);
    res.json({ product: serializeProduct(row, { images: images[row.id] ?? [], includeCostPrice: true }) });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ok: true });
  })
);

// Bulk publish/hide/feature/etc (body: { ids, patch }) or bulk delete
// (body: { ids, action: 'delete' }) — covers ProductList.jsx's existing
// bulk-action toolbar.
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids, patch, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array.' });
    }

    if (action === 'delete') {
      await pool.query('DELETE FROM products WHERE id = ANY($1)', [ids]);
      return res.json({ ok: true, deleted: ids.length });
    }

    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ error: 'patch is required unless action is "delete".' });
    }

    const setClauses = [];
    const values = [];
    for (const [jsField, column] of Object.entries(FIELD_MAP)) {
      if (patch[jsField] === undefined) continue;
      values.push(patch[jsField]);
      setClauses.push(`${column} = $${values.length}${COLUMN_CASTS[column] ?? ''}`);
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'patch had no recognized fields.' });

    setClauses.push('updated_at = now()');
    values.push(ids);
    await pool.query(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ANY($${values.length})`, values);
    res.json({ ok: true, updated: ids.length });
  })
);

router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const existing = await getProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const newId = generateId();
    const newName = `${existing.name} (Copy)`;
    const newSlug = slugify(`${newName}-${newId}`);

    const result = await pool.query(
      `INSERT INTO products (
         id, slug, name, sku, brand, category_id, collection_id, occasion, price, old_price,
         cost_price, stock_qty, material, stone, color, rating, review_count, description,
         short_description, care_instructions, tags, specs, delivery_days, return_days,
         cod_available, variants, ring_sizes, is_best_seller, is_new_arrival, is_featured,
         is_trending, is_coming_soon, is_published
       )
       SELECT
         $1, $2, $3, sku, brand, category_id, collection_id, occasion, price, old_price,
         cost_price, stock_qty, material, stone, color, rating, review_count, description,
         short_description, care_instructions, tags, specs, delivery_days, return_days,
         cod_available, variants, ring_sizes, is_best_seller, is_new_arrival, is_featured,
         is_trending, is_coming_soon, false
       FROM products WHERE id = $4
       RETURNING *`,
      [newId, newSlug, newName, req.params.id]
    );

    // Images live in product_images, keyed by product_id — copy those rows
    // too (same image_path/public_id, no re-upload needed) so the duplicate
    // starts with the same gallery, matching the old behavior where
    // duplicating a product cloned its full record including images.
    await pool.query(
      `INSERT INTO product_images (product_id, image_path, is_thumbnail, display_order)
       SELECT $1, image_path, is_thumbnail, display_order FROM product_images WHERE product_id = $2`,
      [newId, req.params.id]
    );

    const images = await getImagesForProductIds([newId], req);
    res.status(201).json({
      product: serializeProduct(result.rows[0], { images: images[newId] ?? [], includeCostPrice: true }),
    });
  })
);

export default router;
