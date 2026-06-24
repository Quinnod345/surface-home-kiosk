import { createWriteStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "public", "models");
const distRoot = join(__dirname, "..", "dist");
const distOutputDir = join(distRoot, "models");
const packageModelDir = join(
  __dirname,
  "..",
  "node_modules",
  "@vladmandic",
  "face-api",
  "model",
);
const baseUrl = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

const files = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin",
];

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(outputDir, { recursive: true });
const copyToDist = await pathExists(distRoot);

if (copyToDist) {
  await mkdir(distOutputDir, { recursive: true });
}

for (const file of files) {
  const destination = join(outputDir, file);

  if (await pathExists(join(packageModelDir, file))) {
    await copyFile(join(packageModelDir, file), destination);
    console.log(`Copied package model ${file}`);
  } else {
    const url = `${baseUrl}/${file}`;
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Could not download ${url}: ${response.status}`);
    }
    await pipeline(response.body, createWriteStream(destination));
    console.log(`Downloaded ${file}`);
  }

  if (copyToDist) {
    await copyFile(destination, join(distOutputDir, file));
    console.log(`Copied ${file} to dist/models`);
  }
}
