/**
 * tagGalleryAI.js
 * Analyze images with OpenAI Vision to extract Year / Make / Model / Description.
 * - Scans ./images/gallery
 * - Calls OpenAI (ChatGPT) with each image
 * - Copies images to ./processed_gallery
 * - Generates gallery.html (with data-year/make/model/desc)
 *
 * Requires: OPENAI_API_KEY in env
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- CONFIG ----
const INPUT_DIR = path.resolve(__dirname, "../images/gallery");
const OUTPUT_DIR = path.resolve(__dirname, "../images/processed_gallery");
const OUTPUT_HTML = path.resolve(__dirname, "../images/gallery.html");
const MODEL = "gpt-4o"; // or 'gpt-4o-mini' (cheaper, sometimes enough)


// Add near the top (after imports & constants)
const DEBUG = process.argv.includes('--debug');
const LOG_FILE = path.resolve(__dirname, 'debug.log');
function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
  console.log(line);
  if (DEBUG) fs.appendFileSync(LOG_FILE, line + '\n');
}

// Startup sanity
log('🔧 Starting tagGalleryAI...');
if (!process.env.OPENAI_API_KEY) {
  log('❌ Missing OPENAI_API_KEY. Set it and re-run.');
  process.exit(1);
}
if (!fs.existsSync(INPUT_DIR)) {
  log(`❌ Input folder not found: ${INPUT_DIR}`);
  process.exit(1);
}
const allFiles = fs.readdirSync(INPUT_DIR).filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
log(`📁 Input folder: ${INPUT_DIR}`);
log(`🖼️  Found ${allFiles.length} image(s).`);
if (allFiles.length === 0) {
  log('⚠️  No images found. Put files into images/gallery and re-run.');
}


// ---- SETUP ----
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY. Set it in your environment.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(INPUT_DIR);
ensureDir(OUTPUT_DIR);

function toDataURL(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".png" ? "image/png" :
        ext === ".gif" ? "image/gif" :
          "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Basic filename hint to help the model (optional)
function hintsFromFilename(file) {
  const name = path.basename(file, path.extname(file));
  // e.g., "1969_Camaro_SS" -> {maybeYear:'1969', maybeWords:['Camaro','SS']}
  const parts = name.split(/[_\s\-\.]+/);
  const maybeYear = parts.find(p => /^\d{4}$/.test(p)) || "";
  return { maybeYear, maybeWords: parts.filter(p => p !== maybeYear) };
}

async function analyzeImage(filePath) {
  const dataUrl = toDataURL(filePath);
  const { maybeYear, maybeWords } = hintsFromFilename(filePath);

  const system = `
You are a precise automotive identifier. Look at the image and provide:
- year (4-digit or empty if unknown)
- make (brand)
- model
- description (a short, neutral sentence)

Return ONLY strict JSON:
{"year":"YYYY or empty","make":"...","model":"...","description":"..."}
If uncertain, leave fields empty. No extra keys.
`.trim();

  const userText = `
Detect year, make, model from this car photo.
${maybeYear ? `Filename hint year: ${maybeYear}` : ""}
${maybeWords?.length ? `Filename hint words: ${maybeWords.join(" ")}` : ""}
Return strict JSON only.
`.trim();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await openai.responses.create({
        model: MODEL,           // e.g., "gpt-4o" or "gpt-4o-mini"
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: system }]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: userText },
              { type: "input_image", image_url: dataUrl }
            ]
          }
        ],
        temperature: 0.2,
        max_output_tokens: 300
      });

      // Prefer the convenience field if present:
      const rawText =
        (resp.output_text && resp.output_text.trim()) ||
        // Fallback: find the first output_text block manually:
        (resp.output?.[0]?.content?.find(c => c.type === "output_text")?.text?.trim()) ||
        "";

      if (!rawText) {
        log("⚠️ Empty response from model. Full response follows:");
        log(resp);
        return { year: "", make: "", model: "", description: "", raw: "" };
      }

      // Strip accidental code fences
      const cleaned = rawText.replace(/^```json\s*|\s*```$/g, "").trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (jsonErr) {
        log("❗ JSON parse failed. Raw model output:");
        log(cleaned);
        log("Parse error:", jsonErr.message);
        return { year: "", make: "", model: "", description: "", raw: cleaned };
      }

      const year = typeof parsed.year === "string" ? parsed.year.trim() : "";
      const make = typeof parsed.make === "string" ? parsed.make.trim() : "";
      const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
      const description = typeof parsed.description === "string" ? parsed.description.trim() : "";

      log(`✅ Parsed -> year:"${year}", make:"${make}", model:"${model}"`);
      return { year, make, model, description, raw: cleaned };

    } catch (err) {
      const msg = err?.message || String(err);
      const code = err?.status || err?.code || "";
      log(`❌ API error (attempt ${attempt}) ${code}: ${msg}`);

      // handle rate limits with backoff
      if ((code === 429 || /rate/i.test(msg)) && attempt < 3) {
        const wait = 1000 * attempt ** 2;
        log(`⏳ Rate limited; retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // 400 "Invalid value: 'text'" or other hard errors: bail for this image
      return { year: "", make: "", model: "", description: "", raw: "" };
    }
  }
}


// MAIN
async function run() {
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));

  let html = `
<section id="gallery" class="py-5 bg-dark text-white">
  <div class="container">
    <h2 class="text-center mb-5">Vehicle Gallery</h2>
    <div id="grid" class="row g-4">
`;

  for (const file of files) {
    const src = path.join(INPUT_DIR, file);
    let dest = path.join(OUTPUT_DIR, file);

    const { year, make, model, description } = await analyzeImage(src);
    // Skip “unknown” or empty vehicles — don’t write to HTML
    const hasValidData = make && model && make.toLowerCase() !== "unknown" && model.toLowerCase() !== "vehicle";
    // Determine if the vehicle was properly recognized
    if (!hasValidData) {
      log(`⚠️  Skipped unknown vehicle: ${file}`);
      continue; // don't copy or write HTML for this file
    }

    // Copy image into processed folder (keep everything, even if fields are empty)
    // Clean naming and handle empty fields

    // Safe naming utility
function safeName(str) {
  return str.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

const cleanMake  = safeName(make);
const cleanModel = safeName(model);
const cleanYear  = safeName(year);
const baseName   = `${cleanMake}_${cleanModel}_${cleanYear}`;
const ext        = path.extname(file);

// Build destination file path, auto-increment if duplicate exists
let counter = 1;
let newFileName = `${baseName}${ext}`;
dest = path.join(OUTPUT_DIR, newFileName);

// Loop until unique filename found
while (fs.existsSync(dest)) {
  newFileName = `${baseName}_${counter}${ext}`;
  dest = path.join(OUTPUT_DIR, newFileName);
  counter++;
}

// Copy recognized file only
fs.copyFileSync(src, dest);
log(`✅ Copied recognized image as ${newFileName}`);

// Build gallery HTML for valid vehicles
const title = [year, make, model].filter(Boolean).join(" ");
const rel = path.relative(path.dirname(OUTPUT_HTML), dest).split(path.sep).join("/");
 if (!hasValidData) {
      log(`⚠️ Skipped unknown vehicle: ${file}`);
      return; // skip writing this <article>
    }

html += `
  <article class="col-md-6 col-lg-4 gallery-item"
           data-year="${year}" data-make="${make}" data-model="${model}"
           data-desc="${(description || "").replace(/"/g, "&quot;")}">
    <div class="card bg-secondary text-white h-100 border-0 shadow-sm">
      <img src="${rel}" class="card-img-top" alt="${title}">
      <div class="card-body">
        <h5 class="card-title">${title}</h5>
        <p class="card-text">${description || ""}</p>
      </div>
    </div>
  </article>
`;

    console.log(`✅ Processed: ${file} → ${title}`);
  }

  html += `
    </div>
  </div>
</section>
`;

  fs.writeFileSync(OUTPUT_HTML, html.trim(), "utf8");
  console.log(`\n🎉 Done!\n- HTML: ${OUTPUT_HTML}\n- Images: ${OUTPUT_DIR}\n`);
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
