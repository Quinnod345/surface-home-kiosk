import type { KioskConfig } from "./config";
import { resolveKioskAssetUrl } from "./assetUrl";

export type FaceApi = typeof import("@vladmandic/face-api");

let loadingPromise: Promise<FaceApi> | null = null;
let loadedModelUrl: string | null = null;

function faceApiModelUrl(resolvedModelUrl: string) {
  if (
    window.location.protocol === "kiosk:" &&
    resolvedModelUrl.startsWith(`${window.location.origin}/`)
  ) {
    return new URL(resolvedModelUrl).pathname.replace(/^\/+/, "");
  }

  return resolvedModelUrl;
}

export type FaceQualityCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

export type FaceQuality = {
  faceCount: number;
  frameWidth: number;
  frameHeight: number;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  descriptor: Float32Array | null;
  brightness: number | null;
  contrast: number | null;
  centered: boolean;
  sizeOk: boolean;
  lightingOk: boolean;
  canCapture: boolean;
  guidance: string;
  checks: FaceQualityCheck[];
};

export async function checkFaceModelFiles(modelUrl: string) {
  const resolvedModelUrl = resolveKioskAssetUrl(modelUrl).replace(/\/$/, "");
  const manifestUrl = `${resolvedModelUrl}/tiny_face_detector_model-weights_manifest.json`;
  const response = await fetch(manifestUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Model manifest returned ${response.status} at ${manifestUrl}`);
  }

  await response.json();
  return { modelUrl: resolvedModelUrl, manifestUrl };
}

export async function loadFaceApi(modelUrl: string): Promise<FaceApi> {
  const { modelUrl: resolvedModelUrl } = await checkFaceModelFiles(modelUrl);
  const loaderModelUrl = faceApiModelUrl(resolvedModelUrl);
  if (loadingPromise && loadedModelUrl === loaderModelUrl) return loadingPromise;

  loadedModelUrl = loaderModelUrl;
  loadingPromise = import("@vladmandic/face-api").then(async (faceapi) => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(loaderModelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(loaderModelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(loaderModelUrl),
    ]);
    return faceapi;
  }).catch((error) => {
    if (loadedModelUrl === loaderModelUrl) {
      loadingPromise = null;
      loadedModelUrl = null;
    }
    throw error;
  });

  return loadingPromise;
}

export async function captureDescriptor(
  video: HTMLVideoElement,
  config: KioskConfig,
) {
  const faceapi = await loadFaceApi(config.faceRecognition.modelUrl);
  return faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
}

// Infrared frames from the Surface Hello camera are grayscale and, at room
// distance, dim — the face sits as a low-value region on a black background.
// Stretch the 2nd–98th luma percentiles to the full range so face-api sees the
// contrast it expects. Enrollment and recognition both run frames through this,
// so the descriptor space stays internally consistent.
function stretchInfraredContrast(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const pixelCount = canvas.width * canvas.height;
  if (pixelCount <= 0) return;

  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const luma =
      (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) | 0;
    histogram[luma]++;
  }

  const lowTarget = pixelCount * 0.02;
  const highTarget = pixelCount * 0.98;
  let low = 0;
  let high = 255;
  let running = 0;
  for (let v = 0; v < 256; v++) {
    running += histogram[v];
    if (running >= lowTarget) {
      low = v;
      break;
    }
  }
  running = 0;
  for (let v = 0; v < 256; v++) {
    running += histogram[v];
    if (running >= highTarget) {
      high = v;
      break;
    }
  }
  if (high <= low) high = Math.min(255, low + 1);

  const scale = 255 / (high - low);
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    let out = (luma - low) * scale;
    out = out < 0 ? 0 : out > 255 ? 255 : out;
    data[i] = data[i + 1] = data[i + 2] = out;
    data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

// Fetch a bridge data URL and return a contrast-enhanced canvas suitable as a
// face-api detection input. Used for native infrared frames.
export async function loadEnhancedInfrared(
  faceapi: FaceApi,
  dataUrl: string,
): Promise<HTMLCanvasElement> {
  const image = await faceapi.fetchImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context) {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    stretchInfraredContrast(canvas);
  }
  return canvas;
}

export async function captureDescriptorFromInfrared(
  dataUrl: string,
  config: KioskConfig,
) {
  const faceapi = await loadFaceApi(config.faceRecognition.modelUrl);
  const canvas = await loadEnhancedInfrared(faceapi, dataUrl);
  return faceapi
    .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
}

function frameSize(input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) {
  if (input instanceof HTMLVideoElement) {
    return {
      width: input.videoWidth || input.clientWidth,
      height: input.videoHeight || input.clientHeight,
    };
  }

  if (input instanceof HTMLCanvasElement) {
    return { width: input.width, height: input.height };
  }

  return {
    width: input.naturalWidth || input.width,
    height: input.naturalHeight || input.height,
  };
}

function brightnessStats(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) {
    return { brightness: null, contrast: null };
  }

  const canvas = document.createElement("canvas");
  const sampleWidth = 96;
  const sampleHeight = 96;
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { brightness: null, contrast: null };

  const sx = Math.max(0, Math.floor(box.x));
  const sy = Math.max(0, Math.floor(box.y));
  const sw = Math.min(width - sx, Math.max(1, Math.floor(box.width)));
  const sh = Math.min(height - sy, Math.max(1, Math.floor(box.height)));

  try {
    context.drawImage(input, sx, sy, sw, sh, 0, 0, sampleWidth, sampleHeight);
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let total = 0;
    const values: number[] = [];

    for (let index = 0; index < data.length; index += 16) {
      const luma =
        0.2126 * data[index] +
        0.7152 * data[index + 1] +
        0.0722 * data[index + 2];
      total += luma;
      values.push(luma);
    }

    const brightness = total / Math.max(1, values.length);
    const variance =
      values.reduce((sum, value) => sum + (value - brightness) ** 2, 0) /
      Math.max(1, values.length);

    return {
      brightness,
      contrast: Math.sqrt(variance),
    };
  } catch {
    return { brightness: null, contrast: null };
  }
}

function emptyQuality(
  frameWidth: number,
  frameHeight: number,
  faceCount: number,
  guidance: string,
): FaceQuality {
  return {
    faceCount,
    frameWidth,
    frameHeight,
    box: null,
    descriptor: null,
    brightness: null,
    contrast: null,
    centered: false,
    sizeOk: false,
    lightingOk: false,
    canCapture: false,
    guidance,
    checks: [
      {
        label: "Face visible",
        ok: false,
        detail: faceCount > 1 ? "Only one person should be in frame." : guidance,
      },
    ],
  };
}

export async function analyzeFaceInput(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  config: KioskConfig,
): Promise<FaceQuality> {
  const faceapi = await loadFaceApi(config.faceRecognition.modelUrl);
  const { width, height } = frameSize(input);
  if (width <= 0 || height <= 0) {
    return emptyQuality(width, height, 0, "Waiting for a camera frame.");
  }

  const detections = await faceapi
    .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (detections.length === 0) {
    return emptyQuality(width, height, 0, "Put your face inside the guide.");
  }

  if (detections.length > 1) {
    return emptyQuality(width, height, detections.length, "Step into frame alone.");
  }

  const detection = detections[0];
  const box = detection.detection.box;
  const centerX = (box.x + box.width / 2) / width;
  const centerY = (box.y + box.height / 2) / height;
  const faceRatio = box.width / width;
  const centered = Math.abs(centerX - 0.5) < 0.16 && Math.abs(centerY - 0.46) < 0.22;
  const sizeOk = faceRatio >= 0.18 && faceRatio <= 0.58;
  const { brightness, contrast } = brightnessStats(input, box, width, height);
  const lightingOk =
    brightness === null || contrast === null
      ? true
      : brightness > 42 && brightness < 230 && contrast > 10;
  const canCapture = centered && sizeOk && lightingOk;

  const checks: FaceQualityCheck[] = [
    {
      label: "Face visible",
      ok: true,
      detail: "One face detected.",
    },
    {
      label: "Centered",
      ok: centered,
      detail: centered ? "Good position." : "Move into the center of the guide.",
    },
    {
      label: "Distance",
      ok: sizeOk,
      detail:
        faceRatio < 0.18
          ? "Move closer."
          : faceRatio > 0.58
            ? "Move back a little."
            : "Good distance.",
    },
    {
      label: "Lighting",
      ok: lightingOk,
      detail: lightingOk ? "Lighting looks usable." : "Use more even light.",
    },
  ];

  const guidance =
    checks.find((check) => !check.ok)?.detail ??
    "Good. Capture this angle.";

  return {
    faceCount: 1,
    frameWidth: width,
    frameHeight: height,
    box: {
      x: box.x / width,
      y: box.y / height,
      width: box.width / width,
      height: box.height / height,
    },
    descriptor: detection.descriptor,
    brightness,
    contrast,
    centered,
    sizeOk,
    lightingOk,
    canCapture,
    guidance,
    checks,
  };
}

export async function analyzeFaceImageUrl(
  imageUrl: string,
  config: KioskConfig,
) {
  const faceapi = await loadFaceApi(config.faceRecognition.modelUrl);
  const image = await faceapi.fetchImage(imageUrl);
  return analyzeFaceInput(image, config);
}

export async function captureDescriptorFromImageUrl(
  imageUrl: string,
  config: KioskConfig,
) {
  const faceapi = await loadFaceApi(config.faceRecognition.modelUrl);
  const image = await faceapi.fetchImage(imageUrl);
  return faceapi
    .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
}

export async function imageDescriptor(
  faceapi: FaceApi,
  url: string,
) {
  const image = await faceapi.fetchImage(url);
  return faceapi
    .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
}
