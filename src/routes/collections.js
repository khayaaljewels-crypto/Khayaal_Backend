import { createTaxonomyRoutes } from './lib/taxonomyRoutes.js';

const { publicRouter, adminRouter } = createTaxonomyRoutes('collections');

export default publicRouter;
export { adminRouter as adminCollectionRoutes };
