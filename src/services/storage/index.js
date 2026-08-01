import { localDriver } from './localDriver.js';
import { cloudinaryDriver } from './cloudinaryDriver.js';

// Swap storage backends (S3, Cloudinary, GCS, Azure Blob) by adding a driver
// here and setting STORAGE_DRIVER — every driver implements the same
// { save, remove, getUrl } shape, so routes/productImages.js and the
// frontend never need to change when the backend storage changes.
const DRIVERS = {
  local: localDriver,
  cloudinary: cloudinaryDriver,
};

// Getting persistent image storage working requires BOTH setting
// STORAGE_DRIVER=cloudinary AND the three CLOUDINARY_* credential vars —
// two separate settings that have to agree, in an environment (Render's
// dashboard) with dozens of other env vars. Missing just the
// STORAGE_DRIVER flag while the credentials are already present silently
// falls back to local disk with no error — which then behaves fine locally
// but loses every uploaded image on the next deploy, since Render's
// filesystem isn't persistent. Auto-selecting Cloudinary whenever its
// credentials are present removes that failure mode entirely: nobody sets
// three Cloudinary secrets without intending to use it. An explicit
// STORAGE_DRIVER still always wins (e.g. STORAGE_DRIVER=local for a
// deliberate local-disk setup, even with Cloudinary vars present for some
// other reason).
export const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);

function resolveDriverName() {
  if (process.env.STORAGE_DRIVER && DRIVERS[process.env.STORAGE_DRIVER]) {
    return process.env.STORAGE_DRIVER;
  }
  return isCloudinaryConfigured ? 'cloudinary' : 'local';
}

export const storageDriverName = resolveDriverName();
export const storage = DRIVERS[storageDriverName];
