/**
 * optimizeGallery.js
 * Resize + compress images from ./processed_gallery to ./optimized_gallery
 * - Creates multiple responsive sizes (no upscaling)
 * - Exports AVIF, WebP, and optimized JPEG
 * - Strips metadata
 * - Writes manifest.json mapping originals to variants
 *
 * Usage:
 *   node optimizeGallery.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- CONFIG ----------
const INPUT_DIR  = path.resolve(__dirname, "../images/processed_gallery");
const OUTPUT_DIR = path.resolve(__dirname, "../images/optimized_gallery_optimezed");

// Responsive widths (px) — largest first is okay; script will skip upscaling
const SIZES = [1600, 1200, 768, 480];

// Quality settings
const JPEG_QUALITY = 78;    // good tradeoff
const WEBP_QUALITY = 78;
const AVIF_QUALITY = 45;    // AVIF uses different scale; ~45 is solid

// Overwrite behavior
const OVERWRITE = false;    // set true to re-generate files

// ---------- HELPERS ----------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isImage(file) {
  return /\.(jpe?g|png|webp|avif)$/i.test(file);
}

function baseNameNoExt(file) {
  return path.basename(file, path.extname(file));
}

function outPath(basename, width, format) {
  return path.join(OUTPUT_DIR, `${basename}-${width}.${format}`);
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

async function processOne(inputPath) {
  const file = path.basename(inputPath);
  const base = baseNameNoExt(file);

  let image;
  try {
    image = sharp(inputPath, { failOn: "none" }); // tolerate minor issues
  } catch (err) {
    console.error(`❌ Could not open ${file}:`, err?.message || err);
    return null;
  }

  const meta = await image.metadata();
  if (!meta || !meta.width) {
    console.warn(`⚠️ No metadata/width for ${file}. Skipping.`);
    return null;
  }

  const originalWidth = meta.width;
  const results = [];

  // For each target width, skip if original is smaller (avoid upscaling)
  for (const width of SIZES) {
    if (originalWidth < width) {
      // Skip upscaling; continue to the next (smaller) size
      continue;
    }

    // Prepare transforms
    const pipeline = sharp(inputPath).resize({
      width,
      withoutEnlargement: true,
      fit: "inside" // preserve aspect ratio
    }).withMetadata({ orientation: 1 }); // normalize orientation; we’ll strip metadata per output

    // Output formats
    const targets = [
      { format: "avif",  options: { quality: AVIF_QUALITY } },
      { format: "webp",  options: { quality: WEBP_QUALITY } },
      { format: "jpg",   options: { quality: JPEG_QUALITY, mozjpeg: true } }
    ];

    for (const t of targets) {
      const outFile = outPath(base, width, t.format);
      if (!OVERWRITE && fileExists(outFile)) {
        results.push({ format: t.format, width, path: outFile });
        continue;
      }

      try {
        let out = sharp(inputPath).resize({
          width,
          withoutEnlargement: true,
          fit: "inside"
        });

        // apply encoder by format
        if (t.format === "avif") out = out.avif({ quality: AVIF_QUALITY });
        if (t.format === "webp") out = out.webp({ quality: WEBP_QUALITY });
        if (t.format === "jpg")  out = out.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

        // strip metadata for smaller files
        await out.toFile(outFile);
        results.push({ format: t.format, width, path: outFile });
        console.log(`✅ ${path.basename(inputPath)} -> ${path.basename(outFile)}`);
      } catch (err) {
        console.error(`❌ Failed writing ${outFile}:`, err?.message || err);
      }
    }
  }

  // If the image is smaller than the smallest size, still export a single set (no resize)
  if (results.length === 0) {
    const width = originalWidth;
    const targets = [
      { format: "avif", options: { quality: AVIF_QUALITY } },
      { format: "webp", options: { quality: WEBP_QUALITY } },
      { format: "jpg",  options: { quality: JPEG_QUALITY, mozjpeg: true } }
    ];
    for (const t of targets) {
      const outFile = outPath(base, width, t.format);
      if (!OVERWRITE && fileExists(outFile)) {
        results.push({ format: t.format, width, path: outFile });
        continue;
      }
      try {
        let out = sharp(inputPath);
        if (t.format === "avif") out = out.avif({ quality: AVIF_QUALITY });
        if (t.format === "webp") out = out.webp({ quality: WEBP_QUALITY });
        if (t.format === "jpg")  out = out.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
        await out.toFile(outFile);
        results.push({ format: t.format, width, path: outFile });
        console.log(`✅ ${path.basename(inputPath)} -> ${path.basename(outFile)}`);
      } catch (err) {
        console.error(`❌ Failed writing ${outFile}:`, err?.message || err);
      }
    }
  }

  return { original: inputPath, variants: results };
}

async function run() {
  ensureDir(INPUT_DIR);
  ensureDir(OUTPUT_DIR);

  const files = fs.readdirSync(INPUT_DIR).filter(isImage);
  if (files.length === 0) {
    console.log(`No images found in ${INPUT_DIR}`);
    return;
  }

  console.log(`📁 Input:  ${INPUT_DIR}`);
  console.log(`📦 Output: ${OUTPUT_DIR}`);
  console.log(`🖼️  Images: ${files.length}`);
  console.log(`🔧 Sizes: ${SIZES.join(", ")} (px)`);

  const manifest = [];
  for (const f of files) {
    const inputPath = path.join(INPUT_DIR, f);
    const item = await processOne(inputPath);
    if (item) manifest.push(item);
  }

  const manifestPath = path.join(OUTPUT_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n📝 Wrote manifest: ${manifestPath}`);
  console.log("✅ Optimization complete!");
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
