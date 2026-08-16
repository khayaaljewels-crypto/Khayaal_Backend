import { createTaxonomyRoutes } from './lib/taxonomyRoutes.js';

// Occasions intentionally share categories/collections' database-backed
// taxonomy contract: public callers see visible rows, while authenticated
// administrators can manage every row and its display order.
const { publicRouter, adminRouter } = createTaxonomyRoutes('occasions');

export default publicRouter;
export { adminRouter as adminOccasionRoutes };
