import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import { resolveKioskAssetUrl } from "./assetUrl";
import type { KioskConfig, PersonProfile } from "./config";
import {
  imageDescriptor,
  loadFaceApi,
  type FaceApi,
} from "./faceApiRuntime";

export type RecognizedFace = {
  personId: string | null;
  displayName: string | null;
  distance: number | null;
  confidenceLabel: string;
  close: boolean;
  seenAt: number;
};

export type FaceRecognitionStatus =
  | "disabled"
  | "loading"
  | "ready"
  | "no-reference-faces"
  | "model-error"
  | "scanning";

export function useFaceRecognition(
  videoRef: RefObject<HTMLVideoElement>,
  config: KioskConfig,
  cameraActive: boolean,
  bridgeFrameDataUrl?: string | null,
) {
  const [status, setStatus] = useState<FaceRecognitionStatus>(
    config.faceRecognition.enabled ? "loading" : "disabled",
  );
  const [face, setFace] = useState<RecognizedFace | null>(null);
  const matcherRef = useRef<import("@vladmandic/face-api").FaceMatcher | null>(null);
  const apiRef = useRef<FaceApi | null>(null);

  const referencePeople = useMemo(
    () =>
      config.people.filter(
        (person) =>
          (person.referenceImageUrls && person.referenceImageUrls.length > 0) ||
          (person.faceDescriptors && person.faceDescriptors.length > 0),
      ),
    [config.people],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!config.faceRecognition.enabled) {
        setStatus("disabled");
        return;
      }

      if (referencePeople.length === 0) {
        setStatus("no-reference-faces");
        return;
      }

      setStatus("loading");
      try {
        const faceapi = await loadFaceApi(config.faceRecognition.modelUrl);

        const labeledDescriptors = [];
        for (const person of referencePeople) {
          const descriptors = (person.faceDescriptors ?? []).map(
            (descriptor) => new Float32Array(descriptor),
          );
          for (const url of person.referenceImageUrls ?? []) {
            try {
              const detection = await imageDescriptor(
                faceapi,
                resolveKioskAssetUrl(url),
              );
              if (detection?.descriptor) descriptors.push(detection.descriptor);
            } catch (error) {
              console.warn(`Skipping reference face image for ${person.id}: ${url}`, error);
            }
          }

          if (descriptors.length > 0) {
            labeledDescriptors.push(
              new faceapi.LabeledFaceDescriptors(person.id, descriptors),
            );
          }
        }

        if (cancelled) return;

        if (labeledDescriptors.length === 0) {
          setStatus("no-reference-faces");
          return;
        }

        apiRef.current = faceapi;
        matcherRef.current = new faceapi.FaceMatcher(
          labeledDescriptors,
          config.faceRecognition.matchThreshold,
        );
        setStatus("ready");
      } catch (error) {
        console.warn("Face recognition could not load", error);
        if (!cancelled) setStatus("model-error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    config.faceRecognition.enabled,
    config.faceRecognition.matchThreshold,
    config.faceRecognition.modelUrl,
    referencePeople,
  ]);

  useEffect(() => {
    if ((!cameraActive && !bridgeFrameDataUrl) || !matcherRef.current || !apiRef.current) {
      return;
    }
    const faceapi = apiRef.current;
    const matcher = matcherRef.current;

    const interval = window.setInterval(async () => {
      const video = videoRef.current;
      let input: HTMLVideoElement | HTMLImageElement | null = null;
      let inputWidth = 1;

      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        input = video;
        inputWidth = video.videoWidth;
      } else if (bridgeFrameDataUrl) {
        input = await faceapi.fetchImage(bridgeFrameDataUrl);
        inputWidth = input.naturalWidth;
      }

      if (!input) return;

      setStatus("scanning");
      try {
        const detections = await faceapi
          .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptors();

        if (detections.length === 0) {
          setFace(null);
          setStatus("ready");
          return;
        }

        const best = detections.reduce((largest, candidate) =>
          candidate.detection.box.area > largest.detection.box.area ? candidate : largest,
        );
        const match = matcher.findBestMatch(best.descriptor);
        const person = config.people.find((candidate) => candidate.id === match.label);
        const close =
          best.detection.box.width / Math.max(1, inputWidth) >=
          config.camera.closeFaceRatio;

        setFace({
          personId: match.label === "unknown" ? null : match.label,
          displayName: person?.displayName ?? null,
          distance: Number.isFinite(match.distance) ? match.distance : null,
          confidenceLabel: match.toString(),
          close,
          seenAt: Date.now(),
        });
        setStatus("ready");
      } catch (error) {
        console.warn("Face scan failed", error);
        setStatus("model-error");
      }
    }, config.faceRecognition.scanIntervalMs);

    return () => window.clearInterval(interval);
  }, [
    cameraActive,
    bridgeFrameDataUrl,
    config.camera.closeFaceRatio,
    config.faceRecognition.scanIntervalMs,
    config.people,
    videoRef,
  ]);

  const person: PersonProfile | null = useMemo(() => {
    if (!face?.personId) return null;
    return config.people.find((candidate) => candidate.id === face.personId) ?? null;
  }, [config.people, face?.personId]);

  return { status, face, person };
}
