import { useCallback, useEffect, useRef, useState } from "react";

export type MediaSlide = { type: "image" | "video"; url: string; poster?: string };

// The Surface's HD 520 GPU hangs the compositor when decoding video while the
// display is rotated to portrait, so in portrait we show the video's poster still
// instead of playing it. Landscape plays video normally.
function useIsPortrait(): boolean {
  const [portrait, setPortrait] = useState(
    () => typeof window !== "undefined" && window.innerHeight > window.innerWidth,
  );
  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return portrait;
}

function makeOrder(count: number, shuffle: boolean): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (!shuffle) return order;
  // Fisher–Yates
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// A photo/video slideshow with crossfade or hard-cut transitions and optional
// shuffle. Videos and Live Photos play muted (no audio ever) and loop for
// `videoMs`, then advance.
export function Slideshow({
  slides,
  intervalMs,
  videoMs = 10000,
  transition = "crossfade",
  shuffle = true,
}: {
  slides: MediaSlide[];
  intervalMs: number;
  videoMs?: number;
  transition?: "crossfade" | "cut";
  shuffle?: boolean;
}) {
  // `order` is the play sequence (shuffled or in-order); `cursor` is the position
  // within it. The shown slide is slides[order[cursor]].
  const portrait = useIsPortrait();
  const [order, setOrder] = useState<number[]>(() => makeOrder(slides.length, shuffle));
  const [cursor, setCursor] = useState(0);
  const prevCursorRef = useRef(0);

  // Rebuild the order when the album size or shuffle preference changes.
  useEffect(() => {
    setOrder(makeOrder(slides.length, shuffle));
    setCursor(0);
    prevCursorRef.current = 0;
  }, [slides.length, shuffle]);

  const advance = useCallback(() => {
    setCursor((prev) => {
      if (order.length <= 1) return 0;
      prevCursorRef.current = prev;
      const next = prev + 1;
      if (next >= order.length) {
        // Loop: reshuffle so each pass is a fresh random order.
        if (shuffle) setOrder(makeOrder(slides.length, true));
        return 0;
      }
      return next;
    });
  }, [order.length, shuffle, slides.length]);

  const index = order[cursor] ?? 0;

  // Advance on a timer; a playing video gets the longer `videoMs`. In portrait a
  // video is shown as a still, so it advances on the normal image interval.
  useEffect(() => {
    if (order.length <= 1) return;
    const current = slides[index];
    const playsVideo = current?.type === "video" && !portrait;
    const duration = playsVideo ? videoMs : intervalMs;
    const id = window.setTimeout(advance, Math.max(2000, duration));
    return () => window.clearTimeout(id);
  }, [cursor, order, index, slides, intervalMs, videoMs, advance, portrait]);

  if (slides.length === 0) return null;
  const current = slides[index] ?? slides[0];
  const previous = slides[order[prevCursorRef.current] ?? 0];
  const showBack = transition === "crossfade" && previous && prevCursorRef.current !== cursor;

  return (
    <div className="slideshow">
      {showBack ? <Slide slide={previous} className="slide back" portrait={portrait} /> : null}
      <Slide
        key={`${cursor}-${index}`}
        slide={current}
        className={`slide front ${transition}`}
        portrait={portrait}
      />
    </div>
  );
}

function Slide({
  slide,
  className,
  portrait,
}: {
  slide: MediaSlide;
  className: string;
  portrait: boolean;
}) {
  // Play video only in landscape; in portrait show the poster still (the rotated
  // GPU compositor hangs on video). Skip a video with no poster in portrait.
  if (slide.type === "video" && !portrait) {
    return (
      <video
        className={`idle-photo ${className}`}
        src={slide.url}
        poster={slide.poster}
        autoPlay
        muted
        loop
        playsInline
        controls={false}
        disablePictureInPicture
      />
    );
  }
  const imageUrl = slide.type === "video" ? slide.poster : slide.url;
  if (!imageUrl) return <div className={`idle-photo ${className}`} />;
  return <img className={`idle-photo ${className}`} src={imageUrl} alt="" draggable={false} />;
}
