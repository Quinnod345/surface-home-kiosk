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
  return `http://${trimmed}`;
}

function normalizeDashboardUrl(value: string, baseUrl: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return baseUrl ? `${baseUrl}/lovelace/default_view?kiosk` : "";
  }
  if (trimmed.startsWith("/") && baseUrl) return new URL(trimmed, baseUrl).toString();
  return normalizeHttpUrl(trimmed);
}

export function SetupPanel({ config, onClose, onSaved }: SetupPanelProps) {
  const [baseUrl, setBaseUrl] = useState(config.homeAssistant.baseUrl);
  const [dashboardUrl, setDashboardUrl] = useState(config.homeAssistant.dashboardUrl);
  const [accessToken, setAccessToken] = useState(
    config.homeAssistant.accessToken ?? "",
  );
  const [eventPrefix, setEventPrefix] = useState(config.homeAssistant.eventPrefix);
  const [faceEnabled, setFaceEnabled] = useState(config.faceRecognition.enabled);
  const [cameraEnabled, setCameraEnabled] = useState(config.camera.enabled);
  const [bridgeEnabled, setBridgeEnabled] = useState(config.nativeBridge.enabled);
  const [preferredSourceKind, setPreferredSourceKind] = useState(
    config.nativeBridge.preferredSourceKind,
  );
  const [showToken, setShowToken] = useState(false);
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
      };
    },
    [
      accessToken,
      baseUrl,
      bridgeEnabled,
      cameraEnabled,
      config,
      dashboardUrl,
      eventPrefix,
      faceEnabled,
      preferredSourceKind,
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
            placeholder="http://homeassistant.local:8123"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>

        <label className="wide">
          <span>Dashboard URL</span>
          <input
            value={dashboardUrl}
            placeholder="http://homeassistant.local:8123/lovelace/default_view?kiosk"
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
