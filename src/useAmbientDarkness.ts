import { RefObject, useEffect, useRef, useState } from "react";

// Sample the RGB camera's overall brightness to decide whether the room is dark
// enough to warrant the infrared camera (which keeps its emitter lit). In a lit
// room we stay on the normal camera and leave the IR emitter off.
const ENTER_DARK_BELOW = 22; // mean luma (0-255) to switch into infrared
const EXIT_DARK_ABOVE = 45; // brighter than this switches back to the RGB camera
const SAMPLE_INTERVAL_MS = 1500;

export function useAmbientDarkness(
  videoRef: RefObject<HTMLVideoElement>,
  cameraActive: boolean,
  enabled: boolean,
): boolean {
  const [isDark, setIsDark] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      setIsDark(false);
      return;
    }
    // No usable RGB camera (blocked/unavailable) → assume dark so infrared, the
    // only way to see, is used.
    if (!cameraActive) {
      setIsDark(true);
      return;
    }

    const canvas =
      canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    function sample() {
      const video = videoRef.current;
      if (!context || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }
      try {
        context.drawImage(video, 0, 0, 32, 32);
        const data = context.getImageData(0, 0, 32, 32).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        const mean = total / (data.length / 4);
        setIsDark((dark) => (dark ? mean < EXIT_DARK_ABOVE : mean < ENTER_DARK_BELOW));
      } catch {
        // Ignore a transient draw/read failure.
      }
    }

    sample();
    const interval = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [cameraActive, enabled, videoRef]);

  return isDark;
}
