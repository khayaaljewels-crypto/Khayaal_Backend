import { Router } from 'express';
import multer from 'multer';
import { storage } from '../services/storage/index.js';
import { processImage, generateFilename } from '../services/imageProcessor.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

// Generic single-image upload for entities that don't need a full gallery
// (categories, collections, occasions, banners) — this route does no DB work
// itself: it just processes and stores the file, and hands back a URL for
// the caller to save onto whichever record that image belongs to (the
// categories/collections admin routes do that save separately).
const router = Router();

router.use(requireAdmin);

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ENTITY_PREFIXES = {
  categories: 'category',
  collections: 'collection',
  occasions: 'occasion',
  banners: 'banner',
};

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

function uploadSingle(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

router.post('/:entityType', uploadSingle, async (req, res, next) => {
  try {
    const { entityType } = req.params;
    const prefix = ENTITY_PREFIXES[entityType];
    if (!prefix) return res.status(400).json({ error: 'Invalid upload target.' });
    if (!req.file) return res.status(400).json({ error: 'No image was uploaded.' });

    const optimized = await processImage(req.file.buffer);
    const filename = generateFilename(prefix);
    const path = await storage.save({ buffer: optimized, filename, entityType });
    const url = storage.getUrl(path, { requestOrigin: `${req.protocol}://${req.get('host')}` });

    res.status(201).json({ url, path });
  } catch (err) {
    next(err);
  }
});

export default router;
