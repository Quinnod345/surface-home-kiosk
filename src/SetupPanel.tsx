import { Check, Eye, EyeOff, Loader2, PlugZap, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { KioskConfig } from "./config";
import { saveKioskConfig } from "./config";

type SetupPanelProps = {
  config: KioskConfig;
  onClose: () => void;
  onSaved: (config: KioskConfig) => void;
};

type TestStatus = "idle" | "testing" | "ok" | "error";

function normalizeHttpUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeDashboardUrl(value: string, baseUrl: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return baseUrl ? `${baseUrl}/lovelace/default_view?kiosk` : "";
  }
  if (trimmed.startsWith("/") && baseUrl) return new URL(trimmed, baseUrl).toString();
  return normalizeHttpUrl(trimmed);
}

function idsToLines(ids: string[]) {
  return ids.join("\n");
}

function linesToIds(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function bindingsToText(bindings: KioskConfig["cameraOverlay"]["cameraBindings"]) {
  return bindings
    .map((binding) => `${binding.triggerEntityId} = ${binding.cameraEntityId}`)
    .join("\n");
}

function textToBindings(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const [triggerEntityId, cameraEntityId] = line
        .split(/[=,]/)
        .map((part) => part.trim());

      if (!triggerEntityId || !cameraEntityId) return null;
      return { triggerEntityId, cameraEntityId };
    })
    .filter(
      (binding): binding is { triggerEntityId: string; cameraEntityId: string } =>
        binding !== null,
    );
}

function msToSeconds(value: number) {
  return Math.max(1, Math.round(value / 1000));
}

function secondsToMs(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed * 1000);
}

export function SetupPanel({ config, onClose, onSaved }: SetupPanelProps) {
  const [baseUrl, setBaseUrl] = useState(config.homeAssistant.baseUrl);
  const [dashboardUrl, setDashboardUrl] = useState(config.homeAssistant.dashboardUrl);
  const [accessToken, setAccessToken] = useState(
    config.homeAssistant.accessToken ?? "",
  );
  const [eventPrefix, setEventPrefix] = useState(config.homeAssistant.eventPrefix);
  const [allowSelfSignedCertificate, setAllowSelfSignedCertificate] = useState(
    config.homeAssistant.allowSelfSignedCertificate,
  );
  const [faceEnabled, setFaceEnabled] = useState(config.faceRecognition.enabled);
  const [cameraEnabled, setCameraEnabled] = useState(config.camera.enabled);
  const [bridgeEnabled, setBridgeEnabled] = useState(config.nativeBridge.enabled);
  const [preferredSourceKind, setPreferredSourceKind] = useState(
    config.nativeBridge.preferredSourceKind,
  );
  const [showToken, setShowToken] = useState(false);
  const [faceResetSeconds, setFaceResetSeconds] = useState(
    String(msToSeconds(config.behavior.faceResetMs)),
  );
  const [photosAfterNoFaceSeconds, setPhotosAfterNoFaceSeconds] = useState(
    String(msToSeconds(config.behavior.photosAfterNoFaceMs)),
  );
  const [cameraOverlayEnabled, setCameraOverlayEnabled] = useState(
    config.cameraOverlay.enabled,
  );
  const [cameraTriggerIds, setCameraTriggerIds] = useState(
    idsToLines(config.cameraOverlay.triggerEntityIds),
  );
  const [cameraBindings, setCameraBindings] = useState(
    bindingsToText(config.cameraOverlay.cameraBindings),
  );
  const [defaultCameraEntityId, setDefaultCameraEntityId] = useState(
    config.cameraOverlay.defaultCameraEntityId ?? "",
  );
  const [talkEntityId, setTalkEntityId] = useState(
    config.cameraOverlay.talkEntityId ?? "",
  );
  const [cameraDismissSeconds, setCameraDismissSeconds] = useState(
    String(msToSeconds(config.cameraOverlay.dismissAfterMs)),
  );
  const [snapshotRefreshSeconds, setSnapshotRefreshSeconds] = useState(
    String(msToSeconds(config.cameraOverlay.snapshotRefreshMs)),
  );
  const [screenPowerEnabled, setScreenPowerEnabled] = useState(
    config.screenPower.enabled,
  );
  const [dimAfterSeconds, setDimAfterSeconds] = useState(
    String(msToSeconds(config.screenPower.dimAfterMs)),
  );
  const [dimOpacityPercent, setDimOpacityPercent] = useState(
    String(Math.round(config.screenPower.dimOpacity * 100)),
  );
  const [deepSleepAfterSeconds, setDeepSleepAfterSeconds] = useState(
    String(msToSeconds(config.screenPower.deepSleepAfterMs)),
  );
  const [deepSleepAction, setDeepSleepAction] = useState(
    config.screenPower.deepSleepAction,
  );
  const [deepSleepCondition, setDeepSleepCondition] = useState(
    config.screenPower.deepSleepCondition,
  );
  const [quietHoursStart, setQuietHoursStart] = useState(
    config.screenPower.quietHoursStart,
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(
    config.screenPower.quietHoursEnd,
  );
  const [ambientLightEntityId, setAmbientLightEntityId] = useState(
    config.screenPower.ambientLightEntityId ?? "",
  );
  const [ambientLightThresholdLux, setAmbientLightThresholdLux] = useState(
    String(config.screenPower.ambientLightThresholdLux),
  );
  const [useWindowsDisplayPower, setUseWindowsDisplayPower] = useState(
    config.screenPower.useWindowsDisplayPower,
  );
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState(
    config.runtime?.statePath ??
      config.runtime?.userConfigPath ??
      config.runtime?.configPath ??
      null,
  );

  const nextConfig = useMemo<KioskConfig>(
    () => {
      const normalizedBaseUrl = normalizeHttpUrl(baseUrl);
      return {
        ...config,
        homeAssistant: {
          ...config.homeAssistant,
          baseUrl: normalizedBaseUrl,
          dashboardUrl: normalizeDashboardUrl(dashboardUrl, normalizedBaseUrl),
          accessToken: accessToken.trim() || undefined,
          eventPrefix: eventPrefix.trim() || "surface_kiosk",
          allowSelfSignedCertificate,
        },
        camera: {
          ...config.camera,
          enabled: cameraEnabled,
        },
        faceRecognition: {
          ...config.faceRecognition,
          enabled: faceEnabled,
        },
        nativeBridge: {
          ...config.nativeBridge,
          enabled: bridgeEnabled,
          preferredSourceKind,
        },
        behavior: {
          ...config.behavior,
          faceResetMs: secondsToMs(faceResetSeconds, config.behavior.faceResetMs),
          photosAfterNoFaceMs: secondsToMs(
            photosAfterNoFaceSeconds,
            config.behavior.photosAfterNoFaceMs,
          ),
        },
        cameraOverlay: {
          ...config.cameraOverlay,
          enabled: cameraOverlayEnabled,
          triggerEntityIds: linesToIds(cameraTriggerIds),
          cameraBindings: textToBindings(cameraBindings),
          defaultCameraEntityId: defaultCameraEntityId.trim() || undefined,
          talkEntityId: talkEntityId.trim() || undefined,
          dismissAfterMs: secondsToMs(
            cameraDismissSeconds,
            config.cameraOverlay.dismissAfterMs,
          ),
          snapshotRefreshMs: secondsToMs(
            snapshotRefreshSeconds,
            config.cameraOverlay.snapshotRefreshMs,
          ),
        },
        screenPower: {
          ...config.screenPower,
          enabled: screenPowerEnabled,
          dimAfterMs: secondsToMs(dimAfterSeconds, config.screenPower.dimAfterMs),
          dimOpacity: Math.max(
            0,
            Math.min(0.95, Number(dimOpacityPercent) / 100 || config.screenPower.dimOpacity),
          ),
          deepSleepAfterMs: secondsToMs(
            deepSleepAfterSeconds,
            config.screenPower.deepSleepAfterMs,
          ),
          deepSleepAction,
          deepSleepCondition,
          quietHoursStart: quietHoursStart.trim() || "22:30",
          quietHoursEnd: quietHoursEnd.trim() || "06:30",
          ambientLightEntityId: ambientLightEntityId.trim() || undefined,
          ambientLightThresholdLux:
            Number(ambientLightThresholdLux) || config.screenPower.ambientLightThresholdLux,
          useWindowsDisplayPower,
        },
      };
    },
    [
      accessToken,
      allowSelfSignedCertificate,
      baseUrl,
      bridgeEnabled,
      cameraBindings,
      cameraEnabled,
      cameraDismissSeconds,
      cameraOverlayEnabled,
      cameraTriggerIds,
      config,
      dashboardUrl,
      defaultCameraEntityId,
      ambientLightEntityId,
      ambientLightThresholdLux,
      deepSleepAction,
      deepSleepAfterSeconds,
      deepSleepCondition,
      dimAfterSeconds,
      dimOpacityPercent,
      eventPrefix,
      faceEnabled,
      faceResetSeconds,
      photosAfterNoFaceSeconds,
      preferredSourceKind,
      quietHoursEnd,
      quietHoursStart,
      screenPowerEnabled,
      snapshotRefreshSeconds,
      talkEntityId,
      useWindowsDisplayPower,
    ],
  );

  async function testHomeAssistant() {
    setTestStatus("testing");
    setMessage(null);
    try {
      if (window.surfaceKiosk) {
        await window.surfaceKiosk.testHomeAssistant(nextConfig);
      } else if (
        window.location.protocol === "kiosk:" ||
        window.location.protocol === "file:"
      ) {
        throw new Error("Desktop bridge unavailable. Reload the kiosk app and try again.");
      } else {
        const response = await fetch(`${nextConfig.homeAssistant.baseUrl}/api/`, {
          headers: {
            Authorization: `Bearer ${nextConfig.homeAssistant.accessToken ?? ""}`,
          },
        });
        if (!response.ok) throw new Error(`Home Assistant ${response.status}`);
      }
      setTestStatus("ok");
      setMessage("Home Assistant accepted the token.");
    } catch (error) {
      setTestStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not reach Home Assistant.");
    }
  }

  async function save() {
    setMessage(null);
    try {
      const saved = await saveKioskConfig(nextConfig);
      setSavedPath(
        saved.runtime?.statePath ??
          saved.runtime?.userConfigPath ??
          saved.runtime?.configPath ??
          null,
      );
      setMessage("Saved to this tablet.");
      onSaved(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save config.");
    }
  }

  return (
    <aside
      className="setup-panel"
      aria-label="Kiosk setup"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Setup</span>
          <h2>Home Assistant</h2>
        </div>
        <button type="button" aria-label="Close setup" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="setup-fields">
        <label className="wide">
          <span>Home Assistant URL</span>
          <input
            value={baseUrl}
            placeholder="https://homeassistant.local"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>

        <label className="wide">
          <span>Dashboard URL</span>
          <input
            value={dashboardUrl}
            placeholder="https://homeassistant.local/lovelace/default_view?kiosk"
            onChange={(event) => setDashboardUrl(event.target.value)}
          />
        </label>

        <label className="wide token-field">
          <span>Long-lived access token</span>
          <div>
            <input
              value={accessToken}
              type={showToken ? "text" : "password"}
              placeholder="Paste token"
              onChange={(event) => setAccessToken(event.target.value)}
            />
            <button
              type="button"
              aria-label={showToken ? "Hide token" : "Show token"}
              onClick={() => setShowToken((visible) => !visible)}
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <label>
          <span>Event prefix</span>
          <input
            value={eventPrefix}
            placeholder="surface_kiosk"
            onChange={(event) => setEventPrefix(event.target.value)}
          />
        </label>

        <label>
          <span>Face reset seconds</span>
          <input
            value={faceResetSeconds}
            inputMode="numeric"
            onChange={(event) => setFaceResetSeconds(event.target.value)}
          />
        </label>

        <label>
          <span>Photos after no face</span>
          <input
            value={photosAfterNoFaceSeconds}
            inputMode="numeric"
            onChange={(event) => setPhotosAfterNoFaceSeconds(event.target.value)}
          />
        </label>

        <label>
          <span>Bridge source</span>
          <select
            value={preferredSourceKind}
            onChange={(event) =>
              setPreferredSourceKind(event.target.value as "Infrared" | "Color")
            }
          >
            <option value="Color">Color</option>
            <option value="Infrared">Infrared</option>
          </select>
        </label>
      </div>

      <div className="toggle-grid">
        <label>
          <input
            type="checkbox"
            checked={cameraEnabled}
            onChange={(event) => setCameraEnabled(event.target.checked)}
          />
          <span>Browser camera</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={bridgeEnabled}
            onChange={(event) => setBridgeEnabled(event.target.checked)}
          />
          <span>Surface camera bridge</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={faceEnabled}
            onChange={(event) => setFaceEnabled(event.target.checked)}
          />
          <span>Face recognition</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowSelfSignedCertificate}
            onChange={(event) =>
              setAllowSelfSignedCertificate(event.target.checked)
            }
          />
          <span>Trust HA certificate</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={cameraOverlayEnabled}
            onChange={(event) => setCameraOverlayEnabled(event.target.checked)}
          />
          <span>Camera popups</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={screenPowerEnabled}
            onChange={(event) => setScreenPowerEnabled(event.target.checked)}
          />
          <span>Auto dim</span>
        </label>
      </div>

      <div className="setup-fields screen-power-fields">
        <label>
          <span>Dim after seconds</span>
          <input
            value={dimAfterSeconds}
            inputMode="numeric"
            onChange={(event) => setDimAfterSeconds(event.target.value)}
          />
        </label>

        <label>
          <span>Dim amount percent</span>
          <input
            value={dimOpacityPercent}
            inputMode="numeric"
            onChange={(event) => setDimOpacityPercent(event.target.value)}
          />
        </label>

        <label>
          <span>Deep sleep after</span>
          <input
            value={deepSleepAfterSeconds}
            inputMode="numeric"
            onChange={(event) => setDeepSleepAfterSeconds(event.target.value)}
          />
        </label>

        <label>
          <span>Deep sleep action</span>
          <select
            value={deepSleepAction}
            onChange={(event) =>
              setDeepSleepAction(event.target.value as typeof deepSleepAction)
            }
          >
            <option value="dim">Stay dim</option>
            <option value="photos">Photos</option>
            <option value="blackout">Blackout</option>
          </select>
        </label>

        <label>
          <span>Deep sleep condition</span>
          <select
            value={deepSleepCondition}
            onChange={(event) =>
              setDeepSleepCondition(event.target.value as typeof deepSleepCondition)
            }
          >
            <option value="never">Never</option>
            <option value="quiet-hours">Quiet hours</option>
            <option value="ambient-dark">Ambient dark</option>
            <option value="either">Either</option>
            <option value="both">Both</option>
          </select>
        </label>

        <label>
          <span>Quiet hours start</span>
          <input
            value={quietHoursStart}
            placeholder="22:30"
            onChange={(event) => setQuietHoursStart(event.target.value)}
          />
        </label>

        <label>
          <span>Quiet hours end</span>
          <input
            value={quietHoursEnd}
            placeholder="06:30"
            onChange={(event) => setQuietHoursEnd(event.target.value)}
          />
        </label>

        <label>
          <span>Ambient light entity</span>
          <input
            value={ambientLightEntityId}
            placeholder="sensor.living_room_illuminance"
            onChange={(event) => setAmbientLightEntityId(event.target.value)}
          />
        </label>

        <label>
          <span>Dark threshold lux</span>
          <input
            value={ambientLightThresholdLux}
            inputMode="numeric"
            onChange={(event) => setAmbientLightThresholdLux(event.target.value)}
          />
        </label>

        <label className="wide checkbox-line">
          <input
            type="checkbox"
            checked={useWindowsDisplayPower}
            onChange={(event) => setUseWindowsDisplayPower(event.target.checked)}
          />
          <span>Use Windows display power for blackout</span>
        </label>
      </div>

      <div className="setup-fields camera-overlay-fields">
        <label className="wide">
          <span>Doorbell or motion triggers</span>
          <textarea
            value={cameraTriggerIds}
            rows={4}
            placeholder="binary_sensor.driveway_person_detected"
            onChange={(event) => setCameraTriggerIds(event.target.value)}
          />
        </label>

        <label className="wide">
          <span>Trigger to camera bindings</span>
          <textarea
            value={cameraBindings}
            rows={4}
            placeholder="binary_sensor.driveway_person_detected = camera.driveway"
            onChange={(event) => setCameraBindings(event.target.value)}
          />
        </label>

        <label>
          <span>Default camera</span>
          <input
            value={defaultCameraEntityId}
            placeholder="camera.driveway"
            onChange={(event) => setDefaultCameraEntityId(event.target.value)}
          />
        </label>

        <label>
          <span>Talk entity</span>
          <input
            value={talkEntityId}
            placeholder="button.front_door_talk"
            onChange={(event) => setTalkEntityId(event.target.value)}
          />
        </label>

        <label>
          <span>Camera dismiss seconds</span>
          <input
            value={cameraDismissSeconds}
            inputMode="numeric"
            onChange={(event) => setCameraDismissSeconds(event.target.value)}
          />
        </label>

        <label>
          <span>Snapshot refresh seconds</span>
          <input
            value={snapshotRefreshSeconds}
            inputMode="numeric"
            onChange={(event) => setSnapshotRefreshSeconds(event.target.value)}
          />
        </label>
      </div>

      {message ? (
        <p className={`setup-message ${testStatus === "error" ? "error" : ""}`}>
          {message}
        </p>
      ) : null}

      <div className="setup-storage">
        <span>Local app database</span>
        <strong>{savedPath ?? "Will be created when you save."}</strong>
      </div>

      <div className="panel-actions">
        <button type="button" className="secondary-action" onClick={testHomeAssistant}>
          {testStatus === "testing" ? <Loader2 size={18} /> : <PlugZap size={18} />}
          <span>Test</span>
        </button>
        <button type="button" className="save-action" onClick={save}>
          {testStatus === "ok" ? <Check size={18} /> : <Save size={18} />}
          <span>Save</span>
        </button>
      </div>
    </aside>
  );
}
