import { Mic, RefreshCw, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { KioskConfig } from "./config";
import { getHomeAssistantCameraSnapshot } from "./homeAssistant";

export type CameraAlert = {
  entityId: string;
  title: string;
  triggerEntityId?: string;
  openedAt: number;
};

type CameraAlertOverlayProps = {
  alert: CameraAlert;
  config: KioskConfig;
  onClose: () => void;
  onCallService: (
    domain: string,
    service: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
};

function serviceForTalkEntity(entityId: string) {
  const domain = entityId.split(".")[0] ?? "";
  if (domain === "button") return "press";
  if (domain === "switch" || domain === "input_boolean") return "toggle";
  return "turn_on";
}

export function CameraAlertOverlay({
  alert,
  config,
  onClose,
  onCallService,
}: CameraAlertOverlayProps) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<"loading" | "ok" | "error">(
    "loading",
  );

  async function refreshSnapshot() {
    setSnapshotStatus((current) => (current === "ok" ? current : "loading"));
    try {
      setSnapshotUrl(await getHomeAssistantCameraSnapshot(config, alert.entityId));
      setSnapshotStatus("ok");
    } catch {
      setSnapshotStatus("error");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      await refreshSnapshot();
    }

    void tick();
    const interval = window.setInterval(
      () => void tick(),
      config.cameraOverlay.snapshotRefreshMs,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    alert.entityId,
    config.cameraOverlay.snapshotRefreshMs,
    config.homeAssistant.baseUrl,
    config.homeAssistant.accessToken,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(onClose, config.cameraOverlay.dismissAfterMs);
    return () => window.clearTimeout(timeout);
  }, [alert.openedAt, config.cameraOverlay.dismissAfterMs, onClose]);

  async function handleTalk() {
    const talkEntityId = config.cameraOverlay.talkEntityId;
    if (!talkEntityId) return;

    const domain = talkEntityId.split(".")[0] ?? "";
    await onCallService(domain, serviceForTalkEntity(talkEntityId), {
      entity_id: talkEntityId,
    });
  }

  return (
    <aside className="camera-alert" aria-label="Camera alert">
      <div className="camera-alert-media">
        {snapshotUrl ? (
          <img src={snapshotUrl} alt="" draggable={false} />
        ) : (
          <div className="camera-alert-empty">
            <Video size={38} />
            <span>{snapshotStatus === "error" ? "Camera unavailable" : "Loading camera"}</span>
          </div>
        )}
      </div>

      <div className="camera-alert-bar">
        <div>
          <span className="eyebrow">
            {alert.triggerEntityId ? "Motion" : "Camera"}
          </span>
          <h2>{alert.title}</h2>
        </div>
        <div className="camera-alert-actions">
          <button
            type="button"
            title="Refresh"
            aria-label="Refresh camera"
            onClick={() => void refreshSnapshot()}
          >
            <RefreshCw size={19} />
          </button>
          <button
            type="button"
            title="Talk"
            aria-label="Talk"
            disabled={!config.cameraOverlay.talkEntityId}
            onClick={() => void handleTalk()}
          >
            <Mic size={19} />
            <span>Talk</span>
          </button>
          <button type="button" title="Close" aria-label="Close camera" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
}
