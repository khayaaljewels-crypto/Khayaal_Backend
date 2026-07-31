import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { slugify } from '../utils/slugify.js';
import { uploadFromUrl } from '../services/storage/cloudinaryDriver.js';

const router = Router();
router.use(requireAdmin);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function upsertTaxonomy(table, items) {
  const idBySlug = {};
  const report = [];
  for (const item of items ?? []) {
    try {
      const slug = item.slug ? slugify(item.slug) : slugify(item.name);
      const result = await pool.query(
        `INSERT INTO ${table} (slug, name, description, image, hidden, display_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           image = COALESCE(EXCLUDED.image, ${table}.image), hidden = EXCLUDED.hidden,
           display_order = EXCLUDED.display_order, updated_at = now()
         RETURNING id, slug`,
        [slug, item.name, item.description ?? null, item.image ?? null, item.hidden ?? false, item.displayOrder ?? 0]
      );
      idBySlug[slug] = result.rows[0].id;
      report.push({ name: item.name, status: 'ok' });
    } catch (err) {
      report.push({ name: item.name, status: 'failed', reason: err.message });
    }
  }
  return { idBySlug, report };
}

// One-time migration: pushes the existing localStorage-shaped catalogue
// (ProductsContext/CategoriesContext/CollectionsContext's exact export
// shape) into the database. Upserts by slug/id so it's safe to re-run.
// Reports per-item success/failure rather than all-or-nothing, since a
// single dead image URL shouldn't block everything else from landing.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (process.env.STORAGE_DRIVER !== 'cloudinary') {
      return res.status(400).json({
        error:
          'This import rehosts existing image URLs into Cloudinary and requires STORAGE_DRIVER=cloudinary to be configured first.',
      });
    }

    const { categories = [], collections = [], products = [] } = req.body;

    const categoryReport = await upsertTaxonomy('categories', categories);
    const collectionReport = await upsertTaxonomy('collections', collections);

    // Products reference categories by slug and collections by name (the
    // shape the frontend contexts already produce) — resolve both to the
    // real ids just created/updated above.
    const collectionRows = await pool.query('SELECT id, name FROM collections');
    const collectionIdByName = {};
    for (const row of collectionRows.rows) collectionIdByName[row.name] = row.id;

    const productReport = [];
    for (const item of products) {
      try {
        const categoryId = item.category ? categoryReport.idBySlug[item.category] ?? null : null;
        const collectionId = item.collection ? collectionIdByName[item.collection] ?? null : null;
        const slug = item.slug ? slugify(item.slug) : slugify(item.name);

        const result = await pool.query(
          `INSERT INTO products (
             id, slug, name, sku, brand, category_id, collection_id, occasion, price, old_price,
             cost_price, stock_qty, material, stone, color, rating, review_count, description,
             short_description, care_instructions, tags, specs, delivery_days, return_days,
             cod_available, variants, ring_sizes, is_best_seller, is_new_arrival, is_featured,
             is_trending, is_coming_soon, is_published
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21::text[],$22::jsonb,$23,$24,$25,$26::jsonb,$27::jsonb,$28,$29,$30,$31,$32,$33
           )
           ON CONFLICT (id) DO UPDATE SET
             slug=EXCLUDED.slug, name=EXCLUDED.name, sku=EXCLUDED.sku, brand=EXCLUDED.brand,
             category_id=EXCLUDED.category_id, collection_id=EXCLUDED.collection_id, occasion=EXCLUDED.occasion,
             price=EXCLUDED.price, old_price=EXCLUDED.old_price, cost_price=EXCLUDED.cost_price,
             stock_qty=EXCLUDED.stock_qty, material=EXCLUDED.material, stone=EXCLUDED.stone, color=EXCLUDED.color,
             rating=EXCLUDED.rating, review_count=EXCLUDED.review_count, description=EXCLUDED.description,
             short_description=EXCLUDED.short_description, care_instructions=EXCLUDED.care_instructions,
             tags=EXCLUDED.tags, specs=EXCLUDED.specs, delivery_days=EXCLUDED.delivery_days,
             return_days=EXCLUDED.return_days, cod_available=EXCLUDED.cod_available, variants=EXCLUDED.variants,
             ring_sizes=EXCLUDED.ring_sizes, is_best_seller=EXCLUDED.is_best_seller,
             is_new_arrival=EXCLUDED.is_new_arrival, is_featured=EXCLUDED.is_featured,
             is_trending=EXCLUDED.is_trending, is_coming_soon=EXCLUDED.is_coming_soon,
             is_published=EXCLUDED.is_published, updated_at = now()
           RETURNING id`,
          [
            item.id, slug, item.name, item.sku ?? null, item.brand ?? 'Khayaal Jewels',
            categoryId, collectionId, item.occasion ?? null, item.price ?? 0, item.oldPrice ?? null,
            item.costPrice ?? 0, item.stockQty ?? 0, item.material ?? null, item.stone ?? null,
            item.color ?? null, item.rating ?? 0, item.reviewCount ?? 0, item.description ?? null,
            item.shortDescription ?? null, item.careInstructions ?? null, item.tags ?? [],
            JSON.stringify(item.specs ?? {}), item.deliveryDays ?? 5, item.returnDays ?? 7,
            item.codAvailable ?? true, JSON.stringify(item.variants ?? []),
            item.ringSizes ? JSON.stringify(item.ringSizes) : null, item.isBestSeller ?? false,
            item.isNewArrival ?? false, item.isFeatured ?? false, item.isTrending ?? false,
            item.isComingSoon ?? false, item.isPublished ?? true,
          ]
        );

        const productId = result.rows[0].id;

        // Rehost each existing image URL into Cloudinary and record it —
        // per-image failures (e.g. a dead URL) don't abort the rest of the item.
        const imageResults = [];
        for (const url of item.images ?? []) {
          try {
            const publicId = await uploadFromUrl(url, {
              entityType: 'products',
              folder: item.category || 'uncategorized',
            });
            const existingCount = await pool.query(
              'SELECT COUNT(*)::int AS count FROM product_images WHERE product_id = $1',
              [productId]
            );
            await pool.query(
              'INSERT INTO product_images (product_id, image_path, is_thumbnail, display_order) VALUES ($1,$2,$3,$4)',
              [productId, publicId, existingCount.rows[0].count === 0, existingCount.rows[0].count]
            );
            imageResults.push({ url, status: 'ok' });
          } catch (err) {
            imageResults.push({ url, status: 'failed', reason: err.message });
          }
        }

        productReport.push({ id: productId, name: item.name, status: 'ok', images: imageResults });
      } catch (err) {
        productReport.push({ id: item.id, name: item.name, status: 'failed', reason: err.message });
      }
    }

    res.json({ categories: categoryReport.report, collections: collectionReport.report, products: productReport });
  })
);

export default router;
