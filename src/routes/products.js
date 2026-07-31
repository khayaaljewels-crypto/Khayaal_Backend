import { Router } from 'express';
import {
  toArray,
  queryProducts,
  queryFacets,
  getProductBySlug,
  getProductsByIds,
  getRelatedProducts,
  getCompleteTheLook,
  getImagesForProductIds,
  serializeProduct,
} from './lib/productQuery.js';

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Query strings only ever carry strings — "true"/"false" text, never a real
// boolean — so a flag is only applied at all when explicitly "true" or
// "false" is present; anything else (including absence) leaves it unset.
function toBoolOrUndefined(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

// Registered before /:slug below so these literal paths aren't swallowed by
// the param route.
router.get(
  '/facets',
  asyncHandler(async (_req, res) => {
    res.json(await queryFacets({ onlyPublished: true }));
  })
);

router.get(
  '/by-ids',
  asyncHandler(async (req, res) => {
    const ids = toArray(req.query.ids);
    if (!ids.length) return res.json({ products: [] });
    const rows = await getProductsByIds(ids, { onlyPublished: true });
    const images = await getImagesForProductIds(rows.map((r) => r.id), req);
    res.json({ products: rows.map((r) => serializeProduct(r, { images: images[r.id] ?? [] })) });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, search, minPrice, maxPrice, minRating, minDiscount, availability, sort } = req.query;
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
      minDiscount,
      availability,
      sort,
      onlyPublished: true,
      isBestSeller: toBoolOrUndefined(req.query.isBestSeller),
      isNewArrival: toBoolOrUndefined(req.query.isNewArrival),
      isFeatured: toBoolOrUndefined(req.query.isFeatured),
      isTrending: toBoolOrUndefined(req.query.isTrending),
    });

    const images = await getImagesForProductIds(rows.map((r) => r.id), req);
    res.json({
      products: rows.map((r) => serializeProduct(r, { images: images[r.id] ?? [] })),
      meta: { page: p, pageSize: ps, total },
    });
  })
);

router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const row = await getProductBySlug(req.params.slug, { onlyPublished: true });
    if (!row) return res.status(404).json({ error: 'Product not found.' });

    const [related, completeTheLook] = await Promise.all([
      getRelatedProducts(row),
      getCompleteTheLook(row),
    ]);

    const allRows = [row, ...related, ...completeTheLook];
    const images = await getImagesForProductIds(allRows.map((r) => r.id), req);

    res.json({
      product: serializeProduct(row, { images: images[row.id] ?? [] }),
      related: related.map((r) => serializeProduct(r, { images: images[r.id] ?? [] })),
      completeTheLook: completeTheLook.map((r) => serializeProduct(r, { images: images[r.id] ?? [] })),
    });
  })
);

export default router;
