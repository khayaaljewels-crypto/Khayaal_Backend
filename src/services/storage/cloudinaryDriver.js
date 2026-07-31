import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Mirrors localDriver's namespacing: entityType is the top-level folder
// (products, categories, collections, occasions, banners); folder is an
// optional sub-folder within it (products use their category slug).
function cloudinaryFolder(entityType = 'products', folder) {
  const safeEntityType = entityType.replace(/[^a-z0-9-]/gi, '') || 'products';
  const safeFolder = folder ? folder.replace(/[^a-z0-9-]/gi, '') || 'uncategorized' : null;
  return ['khayaal', safeEntityType, safeFolder].filter(Boolean).join('/');
}

// Returns the Cloudinary public_id, not a URL — kept opaque like
// localDriver's relative path, so remove()/getUrl() below can act on it
// directly without re-deriving anything from a URL string.
async function save({ buffer, filename, entityType = 'products', folder }) {
  const result = await cloudinary.uploader.upload(
    `data:image/webp;base64,${buffer.toString('base64')}`,
    {
      folder: cloudinaryFolder(entityType, folder),
      public_id: filename.replace(/\.webp$/i, ''),
      resource_type: 'image',
      overwrite: false,
    }
  );
  return result.public_id;
}

// Overwrites the asset at an existing publicId with new bytes, keeping the
// same public_id/URL — used by the "replace image in place" route. Passing
// public_id explicitly + overwrite: true is Cloudinary's equivalent of
// localDriver's "write to the same file path again".
async function replace(publicId, buffer) {
  await cloudinary.uploader.upload(`data:image/webp;base64,${buffer.toString('base64')}`, {
    public_id: publicId,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
  });
}

async function remove(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

// Synchronous, matching localDriver.getUrl's signature exactly — pure
// string templating via the SDK, no network call. requestOrigin is ignored
// on purpose: Cloudinary URLs are already absolute CDN URLs, independent of
// whichever host the browser used to reach this API.
function getUrl(publicId) {
  if (!publicId) return '';
  return cloudinary.url(publicId, { secure: true });
}

export const cloudinaryDriver = { save, remove, getUrl, replace };

// Not part of the {save,remove,getUrl} contract — used only by the one-time
// data-import path (see routes/adminImport.js) to rehost image URLs that
// already exist (old local-disk paths, pasted external URLs) without having
// a buffer on hand; Cloudinary fetches the remote URL itself.
export async function uploadFromUrl(sourceUrl, { entityType = 'products', folder } = {}) {
  const result = await cloudinary.uploader.upload(sourceUrl, {
    folder: cloudinaryFolder(entityType, folder),
    resource_type: 'image',
  });
  return result.public_id;
}
