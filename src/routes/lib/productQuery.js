import { pool } from '../../db/pool.js';
import { storage } from '../../services/storage/index.js';

const SORTS = {
  newest: 'p.created_at DESC',
  'price-asc': 'p.price ASC',
  'price-desc': 'p.price DESC',
  rating: 'p.rating DESC',
  discount:
    "(CASE WHEN p.old_price IS NOT NULL AND p.old_price > p.price THEN ROUND(((p.old_price - p.price) / p.old_price) * 100) ELSE 0 END) DESC",
};

const PRODUCT_SELECT = `
  p.*,
  c.id AS category_id_out, c.slug AS category_slug, c.name AS category_name,
  col.id AS collection_id_out, col.slug AS collection_slug, col.name AS collection_name
`;

const PRODUCT_JOINS = `
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN collections col ON col.id = p.collection_id
`;

export function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Shared by the public GET /products and the admin GET /api/admin/products —
// the only difference is onlyPublished (admin sees everything).
export async function queryProducts({
  page = 1,
  pageSize = 12,
  search,
  category = [],
  collection = [],
  material = [],
  stone = [],
  color = [],
  occasion = [],
  minPrice,
  maxPrice,
  minRating,
  minDiscount,
  availability, // 'in-stock' | 'out-of-stock' — public Shop-page filter
  sort = 'newest',
  onlyPublished = true,
  stockStatus, // 'low' | 'out' — admin-only stock filter, applied in SQL so pagination stays correct
  isBestSeller,
  isNewArrival,
  isFeatured,
  isTrending,
} = {}) {
  const conditions = [];
  const params = [];

  if (onlyPublished) conditions.push('p.is_published = true');
  if (stockStatus === 'low') conditions.push('p.stock_qty > 0 AND p.stock_qty <= 5');
  if (stockStatus === 'out') conditions.push('p.stock_qty <= 0');
  if (availability === 'in-stock') conditions.push('p.stock_qty > 0');
  if (availability === 'out-of-stock') conditions.push('p.stock_qty <= 0');
  if (isBestSeller !== undefined) conditions.push(`p.is_best_seller = ${isBestSeller ? 'true' : 'false'}`);
  if (isNewArrival !== undefined) conditions.push(`p.is_new_arrival = ${isNewArrival ? 'true' : 'false'}`);
  if (isFeatured !== undefined) conditions.push(`p.is_featured = ${isFeatured ? 'true' : 'false'}`);
  if (isTrending !== undefined) conditions.push(`p.is_trending = ${isTrending ? 'true' : 'false'}`);
  if (minDiscount != null && minDiscount !== '' && Number(minDiscount) > 0) {
    params.push(Number(minDiscount));
    conditions.push(
      `(CASE WHEN p.old_price IS NOT NULL AND p.old_price > p.price THEN ROUND(((p.old_price - p.price) / p.old_price) * 100) ELSE 0 END) >= $${params.length}`
    );
  }

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    conditions.push(
      `(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR p.material ILIKE $${i} OR p.stone ILIKE $${i} OR c.name ILIKE $${i})`
    );
  }
  if (category.length) {
    params.push(category);
    conditions.push(`c.slug = ANY($${params.length})`);
  }
  if (collection.length) {
    params.push(collection);
    conditions.push(`col.slug = ANY($${params.length})`);
  }
  if (material.length) {
    params.push(material);
    conditions.push(`p.material = ANY($${params.length})`);
  }
  if (stone.length) {
    params.push(stone);
    conditions.push(`p.stone = ANY($${params.length})`);
  }
  if (color.length) {
    params.push(color);
    conditions.push(`p.color = ANY($${params.length})`);
  }
  if (occasion.length) {
    params.push(occasion);
    conditions.push(`p.occasion = ANY($${params.length})`);
  }
  if (minPrice != null && minPrice !== '') {
    params.push(Number(minPrice));
    conditions.push(`p.price >= $${params.length}`);
  }
  if (maxPrice != null && maxPrice !== '') {
    params.push(Number(maxPrice));
    conditions.push(`p.price <= $${params.length}`);
  }
  if (minRating != null && minRating !== '') {
    params.push(Number(minRating));
    conditions.push(`p.rating >= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = SORTS[sort] ?? SORTS.newest;

  const safePageSize = Math.min(Math.max(Number(pageSize) || 12, 1), 60);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safePageSize;

  params.push(safePageSize, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const result = await pool.query(
    `SELECT ${PRODUCT_SELECT}, COUNT(*) OVER() AS total_count
     ${PRODUCT_JOINS}
     ${where}
     ORDER BY ${orderBy}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const total = result.rows[0]?.total_count ? Number(result.rows[0].total_count) : 0;
  return { rows: result.rows, total, page: safePage, pageSize: safePageSize };
}

export async function queryFacets({ onlyPublished = true } = {}) {
  const where = onlyPublished ? 'WHERE is_published = true' : '';
  const result = await pool.query(`
    SELECT
      MIN(price) AS min_price, MAX(price) AS max_price,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT material), NULL) AS materials,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT stone), NULL) AS stones,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT color), NULL) AS colors,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT occasion), NULL) AS occasions
    FROM products ${where}
  `);
  const row = result.rows[0];
  return {
    priceBounds: { min: Number(row.min_price ?? 0), max: Number(row.max_price ?? 0) },
    materials: row.materials ?? [],
    stones: row.stones ?? [],
    colors: row.colors ?? [],
    occasions: row.occasions ?? [],
  };
}

export async function getProductBySlug(slug, { onlyPublished = true } = {}) {
  const conditions = ['p.slug = $1'];
  if (onlyPublished) conditions.push('p.is_published = true');
  const result = await pool.query(
    `SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE ${conditions.join(' AND ')}`,
    [slug]
  );
  return result.rows[0] ?? null;
}

export async function getProductById(id) {
  const result = await pool.query(`SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE p.id = $1`, [id]);
  return result.rows[0] ?? null;
}

// Public counterpart to getProductById — same lookup, but respects
// onlyPublished so a hidden product's raw id can never be used to bypass
// the slug route's visibility check.
export async function getPublicProductById(id, { onlyPublished = true } = {}) {
  const conditions = ['p.id = $1'];
  if (onlyPublished) conditions.push('p.is_published = true');
  const result = await pool.query(
    `SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE ${conditions.join(' AND ')}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getProductsByIds(ids, { onlyPublished = true } = {}) {
  if (!ids.length) return [];
  const conditions = ['p.id = ANY($1)'];
  if (onlyPublished) conditions.push('p.is_published = true');
  const result = await pool.query(
    `SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE ${conditions.join(' AND ')}`,
    [ids]
  );
  return result.rows;
}

export async function getRelatedProducts(product, limit = 8) {
  if (!product.category_id) return [];
  const result = await pool.query(
    `SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS}
     WHERE p.category_id = $1 AND p.id != $2 AND p.is_published = true
     ORDER BY p.created_at DESC LIMIT $3`,
    [product.category_id, product.id, limit]
  );
  return result.rows;
}

export async function getCompleteTheLook(product, limit = 4) {
  if (!product.collection_id) return [];
  const result = await pool.query(
    `SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS}
     WHERE p.collection_id = $1 AND p.category_id IS DISTINCT FROM $2 AND p.id != $3 AND p.is_published = true
     ORDER BY p.created_at DESC LIMIT $4`,
    [product.collection_id, product.category_id, product.id, limit]
  );
  return result.rows;
}

// Batch-loads gallery images for a set of product ids in one round trip
// (avoids N+1 queries for list endpoints), returning { [productId]: url[] }.
export async function getImagesForProductIds(ids, req) {
  if (!ids.length) return {};
  const result = await pool.query(
    'SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY display_order ASC, created_at ASC',
    [ids]
  );
  const origin = `${req.protocol}://${req.get('host')}`;
  const grouped = {};
  for (const row of result.rows) {
    (grouped[row.product_id] ??= []).push(storage.getUrl(row.image_path, { requestOrigin: origin }));
  }
  return grouped;
}

function computeDiscount(price, oldPrice) {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

// includeCostPrice must stay false for anything reachable without
// requireAdmin — cost_price is internal margin data, never sent to the
// public storefront API.
export function serializeProduct(row, { images = [], includeCostPrice = false } = {}) {
  const price = Number(row.price);
  const oldPrice = row.old_price != null ? Number(row.old_price) : null;
  const stockQty = Number(row.stock_qty ?? 0);

  const serialized = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    brand: row.brand,
    category: row.category_id_out
      ? { id: row.category_id_out, slug: row.category_slug, name: row.category_name }
      : null,
    collection: row.collection_id_out
      ? { id: row.collection_id_out, slug: row.collection_slug, name: row.collection_name }
      : null,
    occasion: row.occasion,
    price,
    oldPrice,
    stockQty,
    inStock: stockQty > 0,
    lowStock: stockQty > 0 && stockQty <= 5,
    discount: computeDiscount(price, oldPrice),
    material: row.material,
    stone: row.stone,
    color: row.color,
    rating: Number(row.rating ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    description: row.description,
    shortDescription: row.short_description,
    careInstructions: row.care_instructions,
    tags: row.tags ?? [],
    specs: row.specs ?? {},
    deliveryDays: row.delivery_days,
    returnDays: row.return_days,
    codAvailable: row.cod_available,
    variants: row.variants ?? [],
    ringSizes: row.ring_sizes,
    isBestSeller: row.is_best_seller,
    isNewArrival: row.is_new_arrival,
    isFeatured: row.is_featured,
    isTrending: row.is_trending,
    isComingSoon: row.is_coming_soon,
    isPublished: row.is_published,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includeCostPrice) serialized.costPrice = Number(row.cost_price ?? 0);
  return serialized;
}
