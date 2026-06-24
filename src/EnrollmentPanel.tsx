import { Camera, Check, Loader2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { KioskConfig } from "./config";
import {
  descriptorToArray,
  type EnrolledPerson,
  saveEnrolledPerson,
} from "./enrollmentStore";
import {
  analyzeFaceImageUrl,
  analyzeFaceInput,
  captureDescriptor,
  captureDescriptorFromImageUrl,
  type FaceQuality,
} from "./faceApiRuntime";

type EnrollmentPanelProps = {
  config: KioskConfig;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  bridgeFrameDataUrl?: string | null;
  onClose: () => void;
  onSaved: (people: EnrolledPerson[]) => void;
};

type CaptureSample = {
  descriptor: number[];
  prompt: string;
  capturedAt: string;
};

const samplePrompts = [
  "Look straight at the tablet.",
  "Turn slightly left.",
  "Turn slightly right.",
];

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|load.*model|fetch/i.test(message)) {
    return "Face models could not load. Re-run setup or check that the models folder exists.";
  }
  return message || "Could not capture a face sample.";
}

function sampleLabel(index: number) {
  return samplePrompts[index] ?? "Capture one more natural angle.";
}

export function EnrollmentPanel({
  config,
  stream,
  video,
  bridgeFrameDataUrl,
  onClose,
  onSaved,
}: EnrollmentPanelProps) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [personId, setPersonId] = useState("");
  const [dashboardPath, setDashboardPath] = useState("");
  const [samples, setSamples] = useState<CaptureSample[]>([]);
  const [quality, setQuality] = useState<FaceQuality | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "capturing" | "saving" | "saved"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  const resolvedId = useMemo(
    () => slugify(personId || displayName),
    [displayName, personId],
  );
  const hasVideoPreview = Boolean(stream);
  const sourceReady = Boolean(stream || bridgeFrameDataUrl || video);
  const nextPrompt = sampleLabel(samples.length);
  const canCapture = Boolean(
    sourceReady &&
      resolvedId &&
      displayName.trim() &&
      quality?.canCapture &&
      status !== "capturing",
  );
  const canSave = Boolean(
    resolvedId &&
      displayName.trim() &&
      samples.length >= 3 &&
      status !== "saving",
  );

  useEffect(() => {
    const preview = previewVideoRef.current;
    if (!preview || !stream) return;

    preview.srcObject = stream;
    void preview.play().catch(() => undefined);
    return () => {
      preview.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    let cancelled = false;
    let running = false;

    async function analyze() {
      if (running) return;
      running = true;
      try {
        const preview = previewVideoRef.current;
        const input =
          preview && preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            ? preview
            : video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
              ? video
              : null;

        if (input) {
          const next = await analyzeFaceInput(input, config);
          if (!cancelled) {
            setQuality(next);
            setStatus("idle");
            setError(null);
          }
          return;
        }

        if (bridgeFrameDataUrl) {
          const next = await analyzeFaceImageUrl(bridgeFrameDataUrl, config);
          if (!cancelled) {
            setQuality(next);
            setStatus("idle");
            setError(null);
          }
          return;
        }

        if (!cancelled) {
          setQuality(null);
          setStatus("idle");
        }
      } catch (analysisError) {
        if (!cancelled) {
          setStatus("idle");
          setError(friendlyError(analysisError));
        }
      } finally {
        running = false;
      }
    }

    void analyze();
    const interval = window.setInterval(analyze, 900);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [bridgeFrameDataUrl, config, stream, video]);

  async function captureSample() {
    if (!sourceReady || !quality?.canCapture) return;

    setError(null);
    setStatus("capturing");
    try {
      const descriptor =
        quality.descriptor ??
        (previewVideoRef.current
          ? (await captureDescriptor(previewVideoRef.current, config))?.descriptor
          : bridgeFrameDataUrl
            ? (await captureDescriptorFromImageUrl(bridgeFrameDataUrl, config))
                ?.descriptor
            : video
              ? (await captureDescriptor(video, config))?.descriptor
              : null);

      if (!descriptor) {
        setError("No usable face found. Match the guide and try again.");
        return;
      }

      setSamples((current) => [
        ...current,
        {
          descriptor: descriptorToArray(descriptor),
          prompt: nextPrompt,
          capturedAt: new Date().toISOString(),
        },
      ]);
    } catch (captureError) {
      setError(friendlyError(captureError));
    } finally {
      setStatus("idle");
    }
  }

  async function save() {
    if (!canSave) return;

    const now = new Date().toISOString();
    setStatus("saving");
    setError(null);

    try {
      const next = await saveEnrolledPerson({
        id: resolvedId,
        displayName: displayName.trim(),
        dashboardPath: dashboardPath.trim() || undefined,
        faceDescriptors: samples.map((sample) => sample.descriptor),
        enrolledAt: now,
        updatedAt: now,
      });
      setStatus("saved");
      onSaved(next.people);
    } catch (saveError) {
      setStatus("idle");
      setError(saveError instanceof Error ? saveError.message : "Could not save person.");
    }
  }

  const boxStyle = useMemo<CSSProperties | undefined>(() => {
    if (!quality?.box) return undefined;
    const left = hasVideoPreview
      ? 1 - quality.box.x - quality.box.width
      : quality.box.x;
    return {
      left: `${left * 100}%`,
      top: `${quality.box.y * 100}%`,
      width: `${quality.box.width * 100}%`,
      height: `${quality.box.height * 100}%`,
    };
  }, [hasVideoPreview, quality?.box]);

  return (
    <aside
      className="enrollment-panel guided"
      aria-label="Face enrollment"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="enrollment-header">
        <div>
          <span className="eyebrow">Face enrollment</span>
          <h2>Add a person</h2>
        </div>
        <button type="button" aria-label="Close enrollment" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="enrollment-layout">
        <div className="face-preview">
          {stream ? (
            <video
              ref={previewVideoRef}
              className="enrollment-video"
              muted
              playsInline
            />
          ) : bridgeFrameDataUrl ? (
            <img src={bridgeFrameDataUrl} alt="" draggable={false} />
          ) : (
            <div className="preview-empty">Camera starting</div>
          )}
          <div className="face-guide" />
          {boxStyle ? (
            <div
              className={`face-box ${quality?.canCapture ? "good" : ""}`}
              style={boxStyle}
            />
          ) : null}
        </div>

        <div className="enrollment-instructions">
          <strong>{quality?.guidance ?? "Waiting for camera."}</strong>
          <span>{nextPrompt}</span>
          <div className="quality-list">
            {(quality?.checks ?? [
              {
                label: "Camera",
                ok: sourceReady,
                detail: sourceReady ? "Ready." : "Waiting for a camera frame.",
              },
            ]).map((check) => (
              <div className={check.ok ? "quality-ok" : ""} key={check.label}>
                <Check size={14} />
                <span>{check.label}</span>
                <small>{check.detail}</small>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="enrollment-grid">
        <label>
          <span>Name</span>
          <input
            value={displayName}
            placeholder="Quinn"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <label>
          <span>ID</span>
          <input
            value={personId}
            placeholder={resolvedId || "quinn"}
            onChange={(event) => setPersonId(event.target.value)}
          />
        </label>

        <label className="wide">
          <span>Personal dashboard path</span>
          <input
            value={dashboardPath}
            placeholder="/lovelace/quinn?kiosk"
            onChange={(event) => setDashboardPath(event.target.value)}
          />
        </label>
      </div>

      <div className="sample-row">
        <button
          type="button"
          className="primary-action"
          disabled={!canCapture}
          onClick={captureSample}
        >
          {status === "capturing" || status === "loading" ? (
            <Loader2 size={18} />
          ) : (
            <Camera size={18} />
          )}
          <span>Capture sample</span>
        </button>
        <div className="sample-count">
          <strong>{samples.length}/3</strong>
          <span>samples</span>
        </div>
      </div>

      <div className="sample-progress" aria-label="Enrollment samples">
        {samplePrompts.map((prompt, index) => (
          <div
            className={samples[index] ? "complete" : index === samples.length ? "next" : ""}
            key={prompt}
          >
            <Check size={14} />
            <span>{prompt}</span>
          </div>
        ))}
      </div>

      {error ? <p className="enrollment-error">{error}</p> : null}

      <div className="enrollment-footer">
        <span>Embeddings stay local in this kiosk profile.</span>
        <button
          type="button"
          className="save-action"
          disabled={!canSave}
          onClick={save}
        >
          {status === "saved" ? (
            <Check size={18} />
          ) : status === "saving" ? (
            <Loader2 size={18} />
          ) : (
            <UserPlus size={18} />
          )}
          <span>
            {status === "saved"
              ? "Saved"
              : status === "saving"
                ? "Saving"
                : "Save person"}
          </span>
        </button>
      </div>
    </aside>
  );
}
