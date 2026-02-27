import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const brandDir = path.join(publicDir, "brand");

const requiredSource = path.join(brandDir, "logo-arch-tree.png");

const outputFiles = [
  { file: "favicon-16x16.png", size: 16 },
  { file: "favicon-32x32.png", size: 32 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "android-chrome-192x192.png", size: 192 },
  { file: "android-chrome-512x512.png", size: 512 },
];

function normalize(name) {
  return name.toLowerCase();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listBrandPngs() {
  const entries = await fs.readdir(brandDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && normalize(entry.name).endsWith(".png"))
    .map((entry) => path.join(brandDir, entry.name));
}

async function scoreCandidate(filePath) {
  const name = normalize(path.basename(filePath));
  const metadata = await sharp(filePath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const area = width * height;
  let score = area;
  if (name.includes("logo")) score += 4_000_000_000;
  if (name.includes("arch")) score += 2_000_000_000;
  if (name.includes("tree")) score += 1_000_000_000;
  return { filePath, score, width, height };
}

async function resolveSourceLogo() {
  if (await exists(requiredSource)) {
    return requiredSource;
  }
  const candidates = await listBrandPngs();
  if (candidates.length === 0) {
    throw new Error("No PNG logo source found in public/brand.");
  }
  const scored = await Promise.all(candidates.map(scoreCandidate));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].filePath;
}

async function createSquarePipeline(sourcePath) {
  const image = sharp(sourcePath, { failOn: "none" });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error(`Could not read dimensions for source: ${sourcePath}`);
  }
  const side = Math.min(width, height);
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  return image.extract({ left, top, width: side, height: side });
}

async function generatePng(sourcePath, outPath, size) {
  const square = await createSquarePipeline(sourcePath);
  await square
    .resize(size, size, {
      fit: "cover",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile(outPath);
}

async function generateIco(sourcePath) {
  const buffers = await Promise.all(
    [16, 32, 48].map(async (size) => {
      const square = await createSquarePipeline(sourcePath);
      return square
        .resize(size, size, {
          fit: "cover",
          position: "centre",
          kernel: sharp.kernel.lanczos3,
        })
        .png({ compressionLevel: 9, quality: 100 })
        .toBuffer();
    }),
  );
  const ico = await pngToIco(buffers);
  await fs.writeFile(path.join(publicDir, "favicon.ico"), ico);
}

async function main() {
  await fs.mkdir(publicDir, { recursive: true });
  const sourcePath = await resolveSourceLogo();
  const generated = [];
  for (const item of outputFiles) {
    const outPath = path.join(publicDir, item.file);
    await generatePng(sourcePath, outPath, item.size);
    generated.push(path.relative(rootDir, outPath));
  }
  await generateIco(sourcePath);
  generated.push(path.relative(rootDir, path.join(publicDir, "favicon.ico")));
  console.log(JSON.stringify({ sourcePath: path.relative(rootDir, sourcePath), generated }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
