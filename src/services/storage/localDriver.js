import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads — sits next to src/, not inside it, so it isn't bundled/watched as source.
import process from 'process';

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

// entityType is the top-level uploads namespace (products, categories,
// collections, occasions, banners); folder is an optional sub-folder within
// it (products use this for their category slug — categories/collections/
// occasions/banners don't need one, so it's omitted).
async function save({ buffer, filename, entityType = 'products', folder }) {
  const safeEntityType = entityType.replace(/[^a-z0-9-]/gi, '') || 'products';
  const safeFolder = folder ? folder.replace(/[^a-z0-9-]/gi, '') || 'uncategorized' : null;

  const segments = safeFolder
    ? [safeEntityType, safeFolder]
    : [safeEntityType];

  const dir = path.join(UPLOADS_ROOT, ...segments);

  console.log("UPLOADS_ROOT:", UPLOADS_ROOT);
  console.log("Saving directory:", dir);

  await fs.mkdir(dir, { recursive: true });

  const fullPath = path.join(dir, filename);

  console.log("Saving file:", fullPath);

  const fullPath = path.join(dir, filename);

await fs.writeFile(fullPath, buffer);

console.log("Saved to:", fullPath);

try {
  await fs.access(fullPath);
  console.log("✅ File exists after save.");
} catch {
  console.log("❌ File NOT found after save.");
}

return `/uploads/${segments.join('/')}/${filename}`;

  console.log("File saved successfully.");

  return `/uploads/${segments.join("/")}/${filename}`;
}

// Overwrites the file at an existing relativePath with new bytes, keeping
// the same path/URL — used by the "replace image in place" route so callers
// never need to know a driver's internal folder/filename structure.
async function replace(relativePath, buffer) {
  const filePath = path.join(UPLOADS_ROOT, relativePath.replace(/^\/uploads\//, ''));
  await fs.writeFile(filePath, buffer);
}

import process from 'process';

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'uploads'))
);

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

export const localDriver = { save, remove, getUrl, replace };
