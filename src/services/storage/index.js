import { localDriver } from './localDriver.js';

// Swap storage backends (S3, Cloudinary, GCS, Azure Blob) by adding a driver
// here and setting STORAGE_DRIVER — every driver implements the same
// { save, remove, getUrl } shape, so routes/productImages.js and the
// frontend never need to change when the backend storage changes.
const DRIVERS = {
  local: localDriver,
};

export const storage = DRIVERS[process.env.STORAGE_DRIVER] ?? localDriver;
