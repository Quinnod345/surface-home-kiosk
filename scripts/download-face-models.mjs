import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "public", "models");
const baseUrl = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

const files = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model-shard1",
];

await mkdir(outputDir, { recursive: true });

for (const file of files) {
  const url = `${baseUrl}/${file}`;
  const destination = join(outputDir, file);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url}: ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destination));
  console.log(`Downloaded ${file}`);
}
