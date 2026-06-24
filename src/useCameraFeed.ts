import { useEffect, useRef, useState } from "react";

export type CameraStatus =
  | "disabled"
  | "starting"
  | "active"
  | "blocked"
  | "unavailable";

export function useCameraFeed(enabled: boolean, width: number, height: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>(enabled ? "starting" : "disabled");

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!enabled) {
        setStatus("disabled");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }

      setStatus("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: width },
            height: { ideal: height },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        setStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("active");
      } catch (error) {
        console.warn("Camera could not start", error);
        const name = error instanceof DOMException ? error.name : "";
        setStatus(name === "NotAllowedError" ? "blocked" : "unavailable");
      }
    }

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
    };
  }, [enabled, height, width]);

  return { videoRef, status, stream };
}
