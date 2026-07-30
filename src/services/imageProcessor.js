import sharp from 'sharp';

const MAX_DIMENSION = 2000;
const WEBP_QUALITY = 82;

// Every upload is normalized to webp — this is the "automatically compress
// and optimize" step: strips EXIF bloat, caps dimensions for anything shot
// on a modern phone camera, and re-encodes at a quality level indistinguishable
// from source for product photography while cutting file size drastically.
export async function processImage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

export function generateFilename(prefix = 'product') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${random}.webp`;
}
