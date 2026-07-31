import { createTaxonomyRoutes } from './lib/taxonomyRoutes.js';

const { publicRouter, adminRouter } = createTaxonomyRoutes('categories');

export default publicRouter;
export { adminRouter as adminCategoryRoutes };
