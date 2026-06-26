import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import { resolveKioskAssetUrl } from "./assetUrl";
import type { KioskConfig, PersonProfile } from "./config";
import {
  imageDescriptor,
  loadEnhancedInfrared,
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

// Which image source the recognition loop is actually using right now. Surfaced
// in the UI so a silent fall-back from infrared to the RGB webcam is visible.
export type RecognitionSource =
  | "native-infrared"
  | "native-color"
  | "browser-color"
  | "none";

export type BridgeInput = {
  dataUrl?: string | null;
  sourceKind?: string | null;
  connected?: boolean;
  at?: string | null;
};

// Detection (is a face present?) runs every tick for instant wake. Identification
// (who is it?) is heavier, so it is throttled.
const DETECT_INTERVAL_MS = 250;
// First identify on a new face is immediate (justAppeared); after that we only
// re-confirm periodically so a present person doesn't drop heavy work onto the
// main thread while the user is scrolling.
const IDENTIFY_INTERVAL_MS = 2000;
// Smaller input = much faster on the Surface's weak GPU. A face walking up fills
// enough of the frame that 224 detects reliably.
const DETECTOR_INPUT_SIZE = 224;
const DETECTOR_SCORE_THRESHOLD = 0.4;

function recordPerf(kind: "detect" | "identify", ms: number, faceFound: boolean) {
  const w = window as unknown as { __faceperf?: Record<string, number | boolean> };
  const p = w.__faceperf ?? (w.__faceperf = {});
  if (kind === "identify") {
    p.identifyMs = Math.round(ms);
    p.identifyCount = ((p.identifyCount as number) ?? 0) + 1;
  } else {
    p.detectMs = Math.round(ms);
    p.detectCount = ((p.detectCount as number) ?? 0) + 1;
  }
  p.lastFaceFound = faceFound;
}

export function useFaceRecognition(
  videoRef: RefObject<HTMLVideoElement>,
  config: KioskConfig,
  cameraActive: boolean,
  bridge?: BridgeInput | null,
  enabled: boolean = true,
) {
  const [status, setStatus] = useState<FaceRecognitionStatus>(
    config.faceRecognition.enabled && enabled ? "loading" : "disabled",
  );
  const [face, setFace] = useState<RecognizedFace | null>(null);
  const [activeSource, setActiveSource] = useState<RecognitionSource>("none");
  const [lastDetectionAt, setLastDetectionAt] = useState(0);
  const [matcherReady, setMatcherReady] = useState(false);
  const matcherRef = useRef<import("@vladmandic/face-api").FaceMatcher | null>(null);
  const apiRef = useRef<FaceApi | null>(null);

  // Latest bridge frame, held in a ref so the scan interval is not torn down and
  // recreated on every incoming frame.
  const bridgeRef = useRef<BridgeInput | null>(bridge ?? null);
  useEffect(() => {
    bridgeRef.current = bridge ?? null;
  }, [bridge?.dataUrl, bridge?.sourceKind, bridge?.connected]);

  // Cache the contrast-enhanced infrared canvas per frame so detection ticks that
  // run faster than the camera frame rate do not re-decode and re-process.
  const enhancedRef = useRef<{ url: string; canvas: HTMLCanvasElement } | null>(null);

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
      setMatcherReady(false);
      matcherRef.current = null;

      if (!config.faceRecognition.enabled || !enabled) {
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
        setMatcherReady(true);
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
    enabled,
    referencePeople,
  ]);

  useEffect(() => {
    if (!matcherReady) return;
    const faceapi = apiRef.current;
    if (!faceapi) return;

    const bridgeConfigured = config.nativeBridge.enabled;
    if (!cameraActive && !bridgeConfigured) return;

    const detectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: DETECTOR_INPUT_SIZE,
      scoreThreshold: DETECTOR_SCORE_THRESHOLD,
    });

    let running = false;
    let stopped = false;
    let hadFace = false;
    let lastIdentifyAt = 0;

    async function buildInput(): Promise<{
      input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
      width: number;
      source: RecognitionSource;
    } | null> {
      const api = apiRef.current!;
      const bridgeInput = bridgeRef.current;
      const hasBridgeFrame = Boolean(bridgeInput?.connected && bridgeInput?.dataUrl);
      const infrared =
        hasBridgeFrame && (bridgeInput?.sourceKind ?? "").toLowerCase() === "infrared";

      if (hasBridgeFrame) {
        try {
          if (infrared) {
            const url = bridgeInput!.dataUrl!;
            if (enhancedRef.current?.url !== url) {
              const canvas = await loadEnhancedInfrared(api, url);
              enhancedRef.current = { url, canvas };
            }
            const canvas = enhancedRef.current!.canvas;
            return { input: canvas, width: canvas.width, source: "native-infrared" };
          }
          const image = await api.fetchImage(bridgeInput!.dataUrl!);
          return { input: image, width: image.naturalWidth, source: "native-color" };
        } catch (error) {
          console.warn("Bridge frame could not be read", error);
        }
      }

      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        return { input: video, width: video.videoWidth, source: "browser-color" };
      }
      return null;
    }

    const interval = window.setInterval(async () => {
      if (running || stopped) return;
      running = true;
      try {
        const api = apiRef.current;
        const matcher = matcherRef.current;
        if (!api || !matcher) return;

        const built = await buildInput();
        if (!built) {
          setActiveSource("none");
          hadFace = false;
          return;
        }
        setActiveSource(built.source);

        const now = Date.now();

        // Cheap detection every tick (no landmarks/descriptor) → instant wake,
        // and stays cheap while nobody is in front of the kiosk.
        const t0 = performance.now();
        const detection = await api.detectSingleFace(built.input, detectorOptions);
        recordPerf("detect", performance.now() - t0, Boolean(detection));

        if (!detection) {
          hadFace = false;
          setFace(null);
          setStatus("ready");
          return;
        }

        setLastDetectionAt(now);
        const justAppeared = !hadFace;
        hadFace = true;

        // Identification (landmarks + descriptor) is heavier, so only run it when
        // a face just appeared or the throttle window elapsed.
        if (justAppeared || now - lastIdentifyAt > IDENTIFY_INTERVAL_MS) {
          lastIdentifyAt = now;
          const ti = performance.now();
          const full = await api
            .detectSingleFace(built.input, detectorOptions)
            .withFaceLandmarks()
            .withFaceDescriptor();
          recordPerf("identify", performance.now() - ti, Boolean(full));

          if (full?.descriptor) {
            const match = matcher.findBestMatch(full.descriptor);
            const person = config.people.find((candidate) => candidate.id === match.label);
            const close =
              full.detection.box.width / Math.max(1, built.width) >=
              config.camera.closeFaceRatio;
            setFace({
              personId: match.label === "unknown" ? null : match.label,
              displayName: person?.displayName ?? null,
              distance: Number.isFinite(match.distance) ? match.distance : null,
              confidenceLabel: match.toString(),
              close,
              seenAt: now,
            });
          }
        }
        setStatus("ready");
      } catch (error) {
        console.warn("Face scan failed", error);
      } finally {
        running = false;
      }
    }, DETECT_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [
    matcherReady,
    cameraActive,
    config.nativeBridge.enabled,
    config.camera.closeFaceRatio,
    config.people,
    videoRef,
  ]);

  const person: PersonProfile | null = useMemo(() => {
    if (!face?.personId) return null;
    return config.people.find((candidate) => candidate.id === face.personId) ?? null;
  }, [config.people, face?.personId]);

  return { status, face, person, activeSource, lastDetectionAt };
}
