import type { KioskConfig } from "./config";
import { resolveKioskAssetUrl } from "./assetUrl";

export type FaceApi = typeof import("@vladmandic/face-api");

let loadingPromise: Promise<FaceApi> | null = null;
let loadedModelUrl: string | null = null;

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
  if (loadingPromise && loadedModelUrl === resolvedModelUrl) return loadingPromise;

  loadedModelUrl = resolvedModelUrl;
  loadingPromise = import("@vladmandic/face-api").then(async (faceapi) => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(resolvedModelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(resolvedModelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(resolvedModelUrl),
    ]);
    return faceapi;
  }).catch((error) => {
    if (loadedModelUrl === resolvedModelUrl) {
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

function frameSize(input: HTMLVideoElement | HTMLImageElement) {
  if (input instanceof HTMLVideoElement) {
    return {
      width: input.videoWidth || input.clientWidth,
      height: input.videoHeight || input.clientHeight,
    };
  }

  return {
    width: input.naturalWidth || input.width,
    height: input.naturalHeight || input.height,
  };
}

function brightnessStats(
  input: HTMLVideoElement | HTMLImageElement,
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
  input: HTMLVideoElement | HTMLImageElement,
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
