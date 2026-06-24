import { RefObject, useEffect, useMemo, useState } from "react";

export type MotionPresence = {
  score: number;
  occupied: boolean;
  lastMotionAt: number | null;
};

export function useMotionPresence(
  videoRef: RefObject<HTMLVideoElement>,
  enabled: boolean,
  sensitivity: number,
  holdMs: number,
): MotionPresence {
  const [score, setScore] = useState(0);
  const [lastMotionAt, setLastMotionAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 72;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let previous: Uint8ClampedArray | null = null;

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!context || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const current = context.getImageData(0, 0, canvas.width, canvas.height).data;

      if (previous) {
        let total = 0;
        for (let index = 0; index < current.length; index += 4) {
          const delta =
            Math.abs(current[index] - previous[index]) +
            Math.abs(current[index + 1] - previous[index + 1]) +
            Math.abs(current[index + 2] - previous[index + 2]);
          total += delta / 765;
        }

        const nextScore = total / (current.length / 4);
        setScore(nextScore);
        if (nextScore >= sensitivity) setLastMotionAt(Date.now());
      }

      previous = new Uint8ClampedArray(current);
      setNow(Date.now());
    }, 700);

    return () => window.clearInterval(interval);
  }, [enabled, holdMs, sensitivity, videoRef]);

  const occupied = useMemo(() => {
    if (!lastMotionAt) return false;
    return now - lastMotionAt < holdMs;
  }, [holdMs, lastMotionAt, now]);

  return { score, occupied, lastMotionAt };
}
