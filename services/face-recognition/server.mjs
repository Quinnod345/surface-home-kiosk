import "./node-compat.mjs";
import * as tf from "@tensorflow/tfjs-node";
import * as faceapi from "@vladmandic/face-api";
import canvasPkg from "canvas";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import path from "path";
import http from "http";
import os from "os";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { KokoroTTS } from "kokoro-js";

const { Canvas, Image, ImageData, loadImage, createCanvas } = canvasPkg;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(HERE, "models");
const PORT = Number(process.env.PORT ?? 8770);
const HOST = process.env.HOST ?? "0.0.0.0";

await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS);
await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS);
await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS);
const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
console.log(`[face] models loaded (backend=${tf.getBackend()})`);

// Contrast-stretch infrared frames (2nd–98th percentile) — required for detection.
function enhance(image) {
  const c = createCanvas(image.width, image.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data, n = c.width * c.height, hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) { const l = (d[i]*0.2126+d[i+1]*0.7152+d[i+2]*0.0722)|0; hist[l]++; }
  let acc = 0, lo = 0, hi = 255; const loT = n*0.02, hiT = n*0.98;
  for (let v=0;v<256;v++){acc+=hist[v]; if(acc>=loT){lo=v;break;}} acc=0;
  for (let v=0;v<256;v++){acc+=hist[v]; if(acc>=hiT){hi=v;break;}}
  if (hi<=lo) hi=lo+1; const s = 255/(hi-lo);
  for (let i=0;i<d.length;i+=4){ let o=(d[i]*0.2126+d[i+1]*0.7152+d[i+2]*0.0722-lo)*s; o=o<0?0:o>255?255:o; d[i]=d[i+1]=d[i+2]=o; d[i+3]=255; }
  ctx.putImageData(id, 0, 0);
  return c;
}

async function describe(dataUrl, { infrared = true } = {}) {
  const image = await loadImage(dataUrl);
  const input = infrared ? enhance(image) : image;
  const det = await faceapi.detectSingleFace(input, detectorOptions).withFaceLandmarks().withFaceDescriptor();
  if (!det) return { present: false, width: input.width };
  return {
    present: true,
    width: input.width,
    box: { x: det.detection.box.x, y: det.detection.box.y, width: det.detection.box.width, height: det.detection.box.height },
    score: det.detection.score,
    descriptor: Array.from(det.descriptor),
  };
}

// ---- Text to speech ----
// High-quality natural speech via OpenAI when OPENAI_API_KEY is set; otherwise a
// macOS `say` fallback so it works immediately.
function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error) => (error ? reject(error) : resolve()));
  });
}

async function sayToAudio(text, voice) {
  const base = path.join(os.tmpdir(), `kiosk-tts-${randomUUID()}`);
  const aiff = `${base}.aiff`;
  const m4a = `${base}.m4a`;
  try {
    await execFileAsync("say", [...(voice ? ["-v", voice] : []), "-o", aiff, text]);
    await execFileAsync("afconvert", ["-f", "m4af", "-d", "aac", aiff, m4a]);
    return { buffer: await fs.readFile(m4a), contentType: "audio/mp4" };
  } finally {
    fs.unlink(aiff).catch(() => {});
    fs.unlink(m4a).catch(() => {});
  }
}

// Fully local neural TTS (Kokoro, 82M ONNX). Model loads once and stays warm.
const KOKORO_VOICE = process.env.TTS_VOICE || "af_heart";
let kokoroPromise = null;
function getKokoro() {
  if (!kokoroPromise) {
    kokoroPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "cpu",
    }).then((tts) => {
      console.log(`[tts] Kokoro ready (voice=${KOKORO_VOICE})`);
      return tts;
    });
  }
  return kokoroPromise;
}

async function kokoroToWav(text, voice) {
  const tts = await getKokoro();
  const audio = await tts.generate(text, { voice: voice || KOKORO_VOICE });
  const tmp = path.join(os.tmpdir(), `kokoro-${randomUUID()}.wav`);
  try {
    await audio.save(tmp);
    return await fs.readFile(tmp);
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

async function synthesize(text, voice) {
  // Fully local neural TTS (Kokoro). Falls back to macOS `say` only if Kokoro
  // is unavailable.
  try {
    const buffer = await kokoroToWav(text, voice);
    return { buffer, contentType: "audio/wav" };
  } catch (error) {
    console.error("[tts] kokoro failed, using say:", error?.message ?? error);
    return sayToAudio(text, voice);
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "POST" && (req.url ?? "").startsWith("/describe")) {
    const body = await readJsonBody(req);
    const dataUrl = String(body.dataUrl ?? "");
    if (!dataUrl) {
      res.writeHead(400);
      res.end("no dataUrl");
      return;
    }
    try {
      const result = await describe(dataUrl, { infrared: body.infrared !== false });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error?.message ?? error));
    }
    return;
  }
  if (req.method === "POST" && (req.url ?? "").startsWith("/tts")) {
    const body = await readJsonBody(req);
    const text = String(body.text ?? "").slice(0, 800).trim();
    if (!text) {
      res.writeHead(400);
      res.end("no text");
      return;
    }
    try {
      const { buffer, contentType } = await synthesize(text, body.voice);
      res.writeHead(200, { "Content-Type": contentType, "Content-Length": buffer.length });
      res.end(buffer);
    } catch (error) {
      console.error("[tts]", error?.message ?? error);
      res.writeHead(500);
      res.end(String(error?.message ?? error));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });
server.listen(PORT, HOST, () => {
  console.log(`[face] service on http://${HOST}:${PORT} (ws recognition + /tts via local Kokoro)`);
});
// Warm the TTS model so the first greeting isn't slow.
getKokoro().catch((error) => console.error("[tts] Kokoro preload failed:", error?.message ?? error));

wss.on("connection", (socket) => {
  let matcher = null;
  let people = [];
  const send = (msg) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg)); };

  socket.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      if (msg.type === "configure") {
        people = Array.isArray(msg.people) ? msg.people : [];
        const labeled = people
          .filter((p) => Array.isArray(p.descriptors) && p.descriptors.length)
          .map((p) => new faceapi.LabeledFaceDescriptors(p.id, p.descriptors.map((d) => Float32Array.from(d))));
        matcher = labeled.length ? new faceapi.FaceMatcher(labeled, msg.matchThreshold ?? 0.5) : null;
        send({ type: "configured", people: labeled.length });
        return;
      }
      if (msg.type === "describe") {
        // Enrollment: return the descriptor for a captured frame.
        const r = await describe(msg.dataUrl, { infrared: msg.infrared !== false });
        send({ type: "described", id: msg.id, ...r });
        return;
      }
      if (msg.type === "frame") {
        const t0 = performance.now();
        const r = await describe(msg.dataUrl, { infrared: msg.infrared !== false });
        let personId = null, displayName = null, distance = null;
        if (r.present && matcher) {
          const best = matcher.findBestMatch(r.descriptor);
          if (best.label !== "unknown") {
            personId = best.label;
            displayName = people.find((p) => p.id === best.label)?.displayName ?? null;
          }
          distance = Number.isFinite(best.distance) ? best.distance : null;
        }
        send({
          type: "result", at: msg.at ?? null, present: r.present,
          personId, displayName, distance, box: r.box ?? null, width: r.width ?? null,
          score: r.score ?? null, ms: Math.round(performance.now() - t0),
        });
        return;
      }
    } catch (error) {
      send({ type: "error", error: String(error?.message ?? error) });
    }
  });
});
