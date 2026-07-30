import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads — sits next to src/, not inside it, so it isn't bundled/watched as source.
const UPLOADS_ROOT = path.join(__dirname, '../../../uploads');

// entityType is the top-level uploads namespace (products, categories,
// collections, occasions, banners); folder is an optional sub-folder within
// it (products use this for their category slug — categories/collections/
// occasions/banners don't need one, so it's omitted).
async function save({ buffer, filename, entityType = 'products', folder }) {
  const safeEntityType = entityType.replace(/[^a-z0-9-]/gi, '') || 'products';
  const safeFolder = folder ? folder.replace(/[^a-z0-9-]/gi, '') || 'uncategorized' : null;
  const segments = safeFolder ? [safeEntityType, safeFolder] : [safeEntityType];
  const dir = path.join(UPLOADS_ROOT, ...segments);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return `/uploads/${segments.join('/')}/${filename}`;
}

async function remove(relativePath) {
  if (!relativePath?.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOADS_ROOT, relativePath.replace(/^\/uploads\//, ''));
  await fs.rm(filePath, { force: true });
}

// requestOrigin lets local files resolve against whatever host the browser
// actually reached (localhost, LAN IP, etc.) without a hardcoded env var.
// A cloud driver (S3/Cloudinary/GCS) would ignore requestOrigin entirely and
// return its own bucket/CDN URL instead — same call signature either way, so
// routes never need to know which driver is active.
function getUrl(relativePath, { requestOrigin } = {}) {
  const base = requestOrigin || process.env.PUBLIC_URL || '';
  return `${base}${relativePath}`;
}

export const localDriver = { save, remove, getUrl };
