import { Router } from 'express';
import {
  toArray,
  queryProducts,
  queryFacets,
  getProductBySlug,
  getPublicProductById,
  getProductsByIds,
  getRelatedProducts,
  getCompleteTheLook,
  getImagesForProductIds,
  serializeProduct,
  serializeProductCard,
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

function setCatalogCache(res) {
  // Catalog data is public and changes comparatively infrequently. A short
  // browser lifetime avoids stale stock/product information, while shared
  // caches can absorb repeat anonymous browsing traffic.
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
}

// Registered before /:slug below so these literal paths aren't swallowed by
// the param route.
router.get(
  '/facets',
  asyncHandler(async (_req, res) => {
    setCatalogCache(res);
    res.json(await queryFacets({ onlyPublished: true }));
  })
);

router.get(
  '/by-ids',
  asyncHandler(async (req, res) => {
    const ids = toArray(req.query.ids);
    if (!ids.length) return res.json({ products: [] });
    const rows = await getProductsByIds(ids, { onlyPublished: true });
    setCatalogCache(res);
    const images = await getImagesForProductIds(rows.map((r) => r.id), req, { width: 640 });
    // /by-ids is also used outside the Shop card grid. Keep its historical
    // complete product shape; only its delivered image rendition is reduced.
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

    setCatalogCache(res);
    const images = await getImagesForProductIds(rows.map((r) => r.id), req, { width: 640 });
    res.json({
      products: rows.map((r) => serializeProductCard(r, { images: images[r.id] ?? [] })),
      meta: { page: p, pageSize: ps, total },
    });
  })
);

// Accepts either the SEO slug (what every storefront link actually uses)
// or the raw product id — the id fallback only exists to satisfy callers
// that only have the id on hand (e.g. an external integration), and never
// exposes a hidden product since both lookups filter onlyPublished.
router.get(
  '/:idOrSlug',
  asyncHandler(async (req, res) => {
    const { idOrSlug } = req.params;
    const row =
      (await getProductBySlug(idOrSlug, { onlyPublished: true })) ??
      (await getPublicProductById(idOrSlug, { onlyPublished: true }));
    if (!row) return res.status(404).json({ error: 'Product not found.' });

    setCatalogCache(res);

    const [related, completeTheLook] = await Promise.all([
      getRelatedProducts(row),
      getCompleteTheLook(row),
    ]);
    // The selected item is the LCP candidate. Related-card images are still
    // delivered through the same endpoint, but at card size rather than the
    // 2000px upload size.
    const [images, relatedImages] = await Promise.all([
      getImagesForProductIds([row.id], req, { width: 1440 }),
      getImagesForProductIds([...related, ...completeTheLook].map((r) => r.id), req, { width: 640 }),
    ]);

    res.json({
      product: serializeProduct(row, { images: images[row.id] ?? [] }),
      related: related.map((r) => serializeProduct(r, { images: relatedImages[r.id] ?? [] })),
      completeTheLook: completeTheLook.map((r) => serializeProduct(r, { images: relatedImages[r.id] ?? [] })),
    });
  })
);

export default router;
