import type { KioskConfig } from "./config";

export type FaceApi = typeof import("@vladmandic/face-api");

let loadingPromise: Promise<FaceApi> | null = null;
let loadedModelUrl: string | null = null;

export async function loadFaceApi(modelUrl: string): Promise<FaceApi> {
  if (loadingPromise && loadedModelUrl === modelUrl) return loadingPromise;

  loadedModelUrl = modelUrl;
  loadingPromise = import("@vladmandic/face-api").then(async (faceapi) => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
    ]);
    return faceapi;
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
