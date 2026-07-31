import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db/pool.js';
import { storage } from '../services/storage/index.js';
import { processImage, generateFilename } from '../services/imageProcessor.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

// Was previously wide open (no auth at all) — the admin dashboard calls
// these directly from browser JS, so the old ADMIN_API_KEY shared-secret
// approach (see adminCustomers.js) never worked here without shipping the
// key in the frontend bundle. requireAdmin verifies the admin's real
// Firebase ID token instead, sent as a normal Authorization header.
router.use(requireAdmin);

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, and WEBP images are allowed.'));
    }
    cb(null, true);
  },
});

function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function serializeRow(row, req) {
  return {
    id: row.id,
    productId: row.product_id,
    imagePath: row.image_path,
    url: storage.getUrl(row.image_path, { requestOrigin: requestOrigin(req) }),
    isThumbnail: row.is_thumbnail,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

// multer's own middleware calls next(err) on failure, which would otherwise
// fall through to the app's generic 500 handler — wrapping it lets us return
// a proper 400 with the actual validation message (bad type, too large).
function uploadFields(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
      next();
    });
  };
}

const uploadImages = uploadFields(upload.array('images', 20));
const uploadSingleImage = uploadFields(upload.single('image'));

// Express 4 doesn't forward a rejected async handler's promise to the error
// middleware on its own — and on Node 15+, an unhandled rejection crashes
// the whole process rather than just failing the one request. Every route
// below touches the filesystem and sharp on top of Postgres, so the odds of
// a stray throw are higher than the simple query routes elsewhere in this
// server — wrap all of them so a single bad upload can't take the server down.
function asyncHandler(routeName, fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[productImages] ${routeName} failed for productId=${req.params.productId ?? req.params.id ?? 'n/a'}`);
    next(err);
  });
}

// List all images for one product, ordered for display.
router.get('/products/:productId/images', asyncHandler('GET /products/:productId/images', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, created_at ASC',
    [req.params.productId]
  );
  res.json({ images: result.rows.map((r) => serializeRow(r, req)) });
}));

// Upload one or more images for a product (drag & drop or file picker).
router.post('/products/:productId/images', uploadImages, asyncHandler('POST /products/:productId/images', async (req, res) => {
  const { productId } = req.params;
  const folder = (req.body.folder || 'uncategorized').toString();
  const files = req.files ?? [];
  if (files.length === 0) return res.status(400).json({ error: 'No images were uploaded.' });

  let existingCountResult;
  try {
    existingCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM product_images WHERE product_id = $1', [productId]);
  } catch (err) {
    err.message = `[SQL: count existing images for product_id=${productId}] ${err.message}`;
    throw err;
  }
  let nextOrder = existingCountResult.rows[0].count;
  const isFirstBatch = nextOrder === 0;

  const created = [];
  for (const file of files) {
    let optimized;
    try {
      optimized = await processImage(file.buffer);
    } catch (err) {
      err.message = `[Sharp: processing "${file.originalname}" (${file.mimetype}, ${file.size} bytes)] ${err.message}`;
      throw err;
    }

    const filename = generateFilename();
    let imagePath;
    try {
      imagePath = await storage.save({ buffer: optimized, filename, folder });
    } catch (err) {
      err.message = `[Storage: saving "${filename}" to entityType=products, folder="${folder}"] ${err.message}`;
      throw err;
    }

    const isThumbnail = isFirstBatch && created.length === 0;

    let inserted;
    try {
      inserted = await pool.query(
        `INSERT INTO product_images (product_id, image_path, is_thumbnail, display_order)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [productId, imagePath, isThumbnail, nextOrder]
      );
    } catch (err) {
      err.message = `[SQL: insert product_images product_id=${productId} image_path=${imagePath}] ${err.message}`;
      throw err;
    }
    created.push(serializeRow(inserted.rows[0], req));
    nextOrder += 1;
  }

  res.status(201).json({ images: created });
}));

// Persist a new gallery order (drag-and-drop reorder). The first id in the
// list becomes the thumbnail — thumbnail selection and reordering are the
// same action from the admin's point of view (drag an image to the front).
router.put('/products/:productId/images/reorder', asyncHandler('PUT /products/:productId/images/reorder', async (req, res) => {
  const { productId } = req.params;
  const { order } = req.body; // array of image ids, in the new display order
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order must be a non-empty array of image ids.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < order.length; i += 1) {
      await client.query(
        'UPDATE product_images SET is_thumbnail = $1, display_order = $2 WHERE id = $3 AND product_id = $4',
        [i === 0, i, order[i], productId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query(
    'SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC',
    [productId]
  );
  res.json({ images: result.rows.map((r) => serializeRow(r, req)) });
}));

// Explicit "select thumbnail" action — moves the chosen image to the front
// and shifts the rest back, same effect as dragging it there.
router.put('/images/:id/thumbnail', asyncHandler('PUT /images/:id/thumbnail', async (req, res) => {
  const { id } = req.params;
  const targetResult = await pool.query('SELECT * FROM product_images WHERE id = $1', [id]);
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ error: 'Image not found.' });

  const othersResult = await pool.query(
    'SELECT id FROM product_images WHERE product_id = $1 AND id != $2 ORDER BY display_order ASC',
    [target.product_id, id]
  );
  const newOrder = [id, ...othersResult.rows.map((r) => r.id)];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < newOrder.length; i += 1) {
      await client.query('UPDATE product_images SET is_thumbnail = $1, display_order = $2 WHERE id = $3', [i === 0, i, newOrder[i]]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC', [target.product_id]);
  res.json({ images: result.rows.map((r) => serializeRow(r, req)) });
}));

// Replace the file behind an existing image row in place — the image_path
// (and therefore the URL every product references) never changes, so any
// product that already uses this image picks up the new file automatically.
router.put('/images/:id/replace', uploadSingleImage, asyncHandler('PUT /images/:id/replace', async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No replacement image was uploaded.' });

  const result = await pool.query('SELECT * FROM product_images WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Image not found.' });

  const optimized = await processImage(req.file.buffer);
  await storage.replace(row.image_path, optimized);

  res.json({ image: serializeRow(row, req) });
}));

// Attach an already-uploaded image to a different product — no re-upload,
// just a new product_images row pointing at the same image_path/public_id.
// Used by the Media Library's "reuse for another product" feature.
router.post('/images/:id/attach', asyncHandler('POST /images/:id/attach', async (req, res) => {
  const { targetProductId } = req.body;
  if (!targetProductId) return res.status(400).json({ error: 'targetProductId is required.' });

  const source = await pool.query('SELECT * FROM product_images WHERE id = $1', [req.params.id]);
  if (!source.rows[0]) return res.status(404).json({ error: 'Image not found.' });

  const existingCount = await pool.query(
    'SELECT COUNT(*)::int AS count FROM product_images WHERE product_id = $1',
    [targetProductId]
  );
  const nextOrder = existingCount.rows[0].count;

  const inserted = await pool.query(
    `INSERT INTO product_images (product_id, image_path, is_thumbnail, display_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [targetProductId, source.rows[0].image_path, nextOrder === 0, nextOrder]
  );
  res.status(201).json({ image: serializeRow(inserted.rows[0], req) });
}));

// Delete an image entirely (file + row).
router.delete('/images/:id', asyncHandler('DELETE /images/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM product_images WHERE id = $1 RETURNING *', [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Image not found.' });

  await storage.remove(row.image_path);
  res.json({ ok: true });
}));

// Media Library: every uploaded image across all products, searchable and
// filterable by product, for reuse without re-uploading the same file.
router.get('/media', asyncHandler('GET /media', async (req, res) => {
  const { search, productId } = req.query;
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`image_path ILIKE $${params.length}`);
  }
  if (productId) {
    params.push(productId);
    conditions.push(`product_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM product_images ${where} ORDER BY created_at DESC`, params);
  res.json({ images: result.rows.map((r) => serializeRow(r, req)) });
}));

export default router;
