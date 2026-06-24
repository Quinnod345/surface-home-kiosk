import { Camera, Check, Loader2, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { KioskConfig } from "./config";
import {
  descriptorToArray,
  type EnrolledPerson,
  saveEnrolledPerson,
} from "./enrollmentStore";
import {
  captureDescriptor,
  captureDescriptorFromImageUrl,
  loadFaceApi,
} from "./faceApiRuntime";

type EnrollmentPanelProps = {
  config: KioskConfig;
  video: HTMLVideoElement | null;
  bridgeFrameDataUrl?: string | null;
  onClose: () => void;
  onSaved: (people: EnrolledPerson[]) => void;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function EnrollmentPanel({
  config,
  video,
  bridgeFrameDataUrl,
  onClose,
  onSaved,
}: EnrollmentPanelProps) {
  const [displayName, setDisplayName] = useState("");
  const [personId, setPersonId] = useState("");
  const [dashboardPath, setDashboardPath] = useState("");
  const [samples, setSamples] = useState<number[][]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "capturing" | "saved">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const resolvedId = useMemo(
    () => slugify(personId || displayName),
    [displayName, personId],
  );
  const canCapture = Boolean(
    (video || bridgeFrameDataUrl) && resolvedId && displayName.trim(),
  );
  const canSave = canCapture && samples.length >= 3;

  async function captureSample() {
    if (!video && !bridgeFrameDataUrl) return;

    setError(null);
    setStatus("capturing");
    try {
      await loadFaceApi(config.faceRecognition.modelUrl);
      const detection = bridgeFrameDataUrl
        ? await captureDescriptorFromImageUrl(bridgeFrameDataUrl, config)
        : await captureDescriptor(video!, config);
      if (!detection?.descriptor) {
        setError("No face found. Face the tablet and try another sample.");
        return;
      }
      setSamples((current) => [...current, descriptorToArray(detection.descriptor)]);
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : "Could not capture a face sample.",
      );
    } finally {
      setStatus("idle");
    }
  }

  function save() {
    if (!canSave) return;

    const now = new Date().toISOString();
    const next = saveEnrolledPerson({
      id: resolvedId,
      displayName: displayName.trim(),
      dashboardPath: dashboardPath.trim() || undefined,
      faceDescriptors: samples,
      enrolledAt: now,
      updatedAt: now,
    });
    setStatus("saved");
    onSaved(next.people);
  }

  return (
    <aside
      className="enrollment-panel"
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
          <span>Dashboard path</span>
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
          disabled={!canCapture || status === "capturing" || status === "loading"}
          onClick={captureSample}
        >
          {status === "capturing" ? <Loader2 size={18} /> : <Camera size={18} />}
          <span>Capture sample</span>
        </button>
        <div className="sample-count">
          <strong>{samples.length}</strong>
          <span>samples</span>
        </div>
      </div>

      {error ? <p className="enrollment-error">{error}</p> : null}

      <div className="enrollment-footer">
        <span>Capture at least 3 angles with consent.</span>
        <button
          type="button"
          className="save-action"
          disabled={!canSave}
          onClick={save}
        >
          {status === "saved" ? <Check size={18} /> : <UserPlus size={18} />}
          <span>{status === "saved" ? "Saved" : "Save person"}</span>
        </button>
      </div>
    </aside>
  );
}
