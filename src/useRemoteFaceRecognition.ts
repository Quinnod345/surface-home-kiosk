import { RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { KioskConfig, PersonProfile } from "./config";
import type {
  BridgeInput,
  FaceRecognitionStatus,
  RecognitionSource,
  RecognizedFace,
} from "./useFaceRecognition";

const SEND_INTERVAL_MS = 250;

// The kiosk can run in any orientation. The camera is fixed to the device, so in
// portrait the face arrives rotated 90°/270° — face-api only detects upright
// faces, so we rotate frames back to upright by the display angle before sending.
// In landscape (angle 0) this is a no-op, so the default path is unchanged.
function screenAngle(): number {
  const a =
    typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number"
      ? screen.orientation.angle
      : 0;
  return ((a % 360) + 360) % 360;
}

// Capture a downscaled JPEG from the RGB camera for the lit-room case (in the
// dark we relay the bridge's infrared frame directly), rotated to upright.
function captureVideoFrame(video: HTMLVideoElement, angle = 0): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 480 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const swap = angle === 90 || angle === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? ch : cw;
  canvas.height = swap ? cw : ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (angle) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(video, -cw / 2, -ch / 2, cw, ch);
  } else {
    ctx.drawImage(video, 0, 0, cw, ch);
  }
  return canvas.toDataURL("image/jpeg", 0.7);
}

// Rotate a bridge (infrared) data-URL frame by the display angle.
function rotateDataUrl(dataUrl: string, angle: number): Promise<string> {
  if (!angle) return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const swap = angle === 90 || angle === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Recognition offloaded to a remote service (e.g. a Mac mini). The kiosk relays
// frames and uses the returned matches, so no tfjs/WebGL runs on the Surface.
export function useRemoteFaceRecognition(
  videoRef: RefObject<HTMLVideoElement>,
  config: KioskConfig,
  cameraActive: boolean,
  bridge: BridgeInput | null | undefined,
  enabled: boolean,
) {
  const [status, setStatus] = useState<FaceRecognitionStatus>(
    enabled ? "loading" : "disabled",
  );
  const [face, setFace] = useState<RecognizedFace | null>(null);
  const [activeSource, setActiveSource] = useState<RecognitionSource>("none");
  const [lastDetectionAt, setLastDetectionAt] = useState(0);

  const bridgeRef = useRef<BridgeInput | null>(bridge ?? null);
  useEffect(() => {
    bridgeRef.current = bridge ?? null;
  }, [bridge?.dataUrl, bridge?.sourceKind, bridge?.connected]);
  const cameraActiveRef = useRef(cameraActive);
  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);
  const peopleRef = useRef(config.people);
  useEffect(() => {
    peopleRef.current = config.people;
  }, [config.people]);
  const closeRatioRef = useRef(config.camera.closeFaceRatio);
  useEffect(() => {
    closeRatioRef.current = config.camera.closeFaceRatio;
  }, [config.camera.closeFaceRatio]);

  const socketRef = useRef<WebSocket | null>(null);
  const url = config.faceRecognition.remoteUrl;
  const matchThreshold = config.faceRecognition.matchThreshold;
  const peopleKey = useMemo(
    () => config.people.map((p) => `${p.id}:${p.faceDescriptors?.length ?? 0}`).join(","),
    [config.people],
  );

  function configurePayload() {
    return peopleRef.current
      .filter((person) => person.faceDescriptors && person.faceDescriptors.length)
      .map((person) => ({
        id: person.id,
        displayName: person.displayName,
        descriptors: person.faceDescriptors,
      }));
  }

  useEffect(() => {
    if (!enabled || !url) {
      setStatus("disabled");
      setActiveSource("none");
      return;
    }

    let closed = false;
    let sendTimer = 0;
    let reconnectTimer = 0;
    let lastSentKey = "";

    function connect() {
      setStatus("loading");
      const socket = new WebSocket(url!);
      socketRef.current = socket;

      socket.onopen = () => {
        if (closed) return;
        setStatus("ready");
        socket.send(
          JSON.stringify({ type: "configure", people: configurePayload(), matchThreshold }),
        );

        sendTimer = window.setInterval(async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          const angle = screenAngle();
          const b = bridgeRef.current;
          let dataUrl: string | null = null;
          let infrared = false;
          let source: RecognitionSource = "none";
          let key = "";

          if (b?.connected && b?.dataUrl) {
            dataUrl = angle ? await rotateDataUrl(b.dataUrl, angle) : b.dataUrl;
            infrared = (b.sourceKind ?? "").toLowerCase() === "infrared";
            source = infrared ? "native-infrared" : "native-color";
            key = `b:${b.at ?? ""}`;
          } else {
            const video = videoRef.current;
            if (cameraActiveRef.current && video && video.readyState >= 2) {
              dataUrl = captureVideoFrame(video, angle);
              source = "browser-color";
              key = `v:${Date.now()}`;
            }
          }

          setActiveSource(dataUrl ? source : "none");
          if (!dataUrl || key === lastSentKey) return;
          lastSentKey = key;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "frame", dataUrl, infrared, at: key }));
          }
        }, SEND_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        let msg: {
          type?: string;
          present?: boolean;
          personId?: string | null;
          displayName?: string | null;
          distance?: number | null;
          box?: { width?: number } | null;
          width?: number | null;
        };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type !== "result") return;

        if (!msg.present) {
          setFace(null);
          setStatus("ready");
          return;
        }

        const now = Date.now();
        setLastDetectionAt(now);
        const boxWidth = msg.box?.width ?? 0;
        const close =
          boxWidth && msg.width ? boxWidth / Math.max(1, msg.width) >= closeRatioRef.current : false;
        const person = msg.personId
          ? peopleRef.current.find((p) => p.id === msg.personId)
          : null;
        setFace({
          personId: msg.personId ?? null,
          displayName: msg.displayName ?? person?.displayName ?? null,
          distance: typeof msg.distance === "number" ? msg.distance : null,
          confidenceLabel: msg.personId ?? "unknown",
          close,
          seenAt: now,
        });
        setStatus("ready");
      };

      socket.onclose = () => {
        window.clearInterval(sendTimer);
        if (!closed) {
          setStatus("model-error");
          setActiveSource("none");
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    }

    connect();
    return () => {
      closed = true;
      window.clearInterval(sendTimer);
      window.clearTimeout(reconnectTimer);
      try {
        socketRef.current?.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    };
  }, [enabled, url, matchThreshold, videoRef]);

  // Re-send enrolled descriptors when they change, without reconnecting.
  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: "configure", people: configurePayload(), matchThreshold }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleKey, matchThreshold]);

  const person: PersonProfile | null = useMemo(() => {
    if (!face?.personId) return null;
    return config.people.find((candidate) => candidate.id === face.personId) ?? null;
  }, [config.people, face?.personId]);

  return { status, face, person, activeSource, lastDetectionAt };
}
