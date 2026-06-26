import { Check, ChevronDown, Eye, EyeOff, Loader2, PlugZap, Save, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { KioskConfig, PersonProfile } from "./config";
import { isAdminPerson, saveKioskConfig } from "./config";
import type { HaState } from "./homeAssistant";
import { EntityPicker } from "./EntityPicker";

type SettingsViewProps = {
  config: KioskConfig;
  states: HaState[];
  // People shown in the admin "Profiles" card so an admin can open and edit any
  // person's per-user settings.
  people?: PersonProfile[];
  onEditProfile?: (personId: string) => void;
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
  if (!trimmed) return baseUrl ? `${baseUrl}/lovelace/default_view?kiosk` : "";
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
  return bindings.map((b) => `${b.triggerEntityId} = ${b.cameraEntityId}`).join("\n");
}
function textToBindings(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const [triggerEntityId, cameraEntityId] = line.split(/[=,]/).map((p) => p.trim());
      if (!triggerEntityId || !cameraEntityId) return null;
      return { triggerEntityId, cameraEntityId };
    })
    .filter((b): b is { triggerEntityId: string; cameraEntityId: string } => b !== null);
}
function msToSeconds(value: number) {
  return Math.max(1, Math.round(value / 1000));
}
function secondsToMs(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed * 1000);
}

export function SettingsView({
  config,
  states,
  people = [],
  onEditProfile,
  onClose,
  onSaved,
}: SettingsViewProps) {
  // Connection (advanced)
  const [baseUrl, setBaseUrl] = useState(config.homeAssistant.baseUrl);
  const [dashboardUrl, setDashboardUrl] = useState(config.homeAssistant.dashboardUrl);
  const [accessToken, setAccessToken] = useState(config.homeAssistant.accessToken ?? "");
  const [eventPrefix, setEventPrefix] = useState(config.homeAssistant.eventPrefix);
  const [allowSelfSignedCertificate, setAllowSelfSignedCertificate] = useState(
    config.homeAssistant.allowSelfSignedCertificate,
  );
  const [showToken, setShowToken] = useState(false);

  // Common feature picks
  const [calendarEnabled, setCalendarEnabled] = useState(config.calendar?.enabled ?? true);
  const [calendarEntityId, setCalendarEntityId] = useState(config.calendar?.entityId ?? "");
  const [weatherEnabled, setWeatherEnabled] = useState(config.weather?.enabled ?? true);
  const [weatherEntityId, setWeatherEntityId] = useState(config.weather?.entityId ?? "");
  const [groceryEnabled, setGroceryEnabled] = useState(config.grocery?.enabled ?? true);
  const [groceryEntityId, setGroceryEntityId] = useState(config.grocery?.entityId ?? "");
  const [bridgeUrl, setBridgeUrl] = useState(config.grocery?.bridgeUrl ?? "");
  const [bridgeToken, setBridgeToken] = useState(config.grocery?.bridgeToken ?? "");
  const [bridgeList, setBridgeList] = useState(config.grocery?.bridgeList ?? "");
  const [bridgeTest, setBridgeTest] = useState<string | null>(null);
  const [icloudAlbumUrl, setIcloudAlbumUrl] = useState(
    config.slideshow?.icloudSharedAlbumUrl ?? "",
  );
  const [photoIntervalSeconds, setPhotoIntervalSeconds] = useState(
    String(Math.round((config.slideshow?.intervalMs ?? 12000) / 1000)),
  );
  const [photoTransition, setPhotoTransition] = useState<"crossfade" | "cut">(
    config.slideshow?.transition ?? "crossfade",
  );
  const [photoShuffle, setPhotoShuffle] = useState(config.slideshow?.shuffle ?? true);

  // Feature toggles
  const [faceEnabled, setFaceEnabled] = useState(config.faceRecognition.enabled);
  const [cameraEnabled, setCameraEnabled] = useState(config.camera.enabled);
  const [bridgeEnabled, setBridgeEnabled] = useState(config.nativeBridge.enabled);
  const [preferredSourceKind, setPreferredSourceKind] = useState(
    config.nativeBridge.preferredSourceKind,
  );

  // Behaviour (advanced)
  const [faceResetSeconds, setFaceResetSeconds] = useState(
    String(msToSeconds(config.behavior.faceResetMs)),
  );
  const [photosAfterNoFaceSeconds, setPhotosAfterNoFaceSeconds] = useState(
    String(msToSeconds(config.behavior.photosAfterNoFaceMs)),
  );

  // Cameras
  const [cameraOverlayEnabled, setCameraOverlayEnabled] = useState(config.cameraOverlay.enabled);
  const [cameraTriggerIds, setCameraTriggerIds] = useState(
    idsToLines(config.cameraOverlay.triggerEntityIds),
  );
  const [cameraBindings, setCameraBindings] = useState(
    bindingsToText(config.cameraOverlay.cameraBindings),
  );
  const [defaultCameraEntityId, setDefaultCameraEntityId] = useState(
    config.cameraOverlay.defaultCameraEntityId ?? "",
  );
  const [talkEntityId, setTalkEntityId] = useState(config.cameraOverlay.talkEntityId ?? "");
  const [cameraDismissSeconds, setCameraDismissSeconds] = useState(
    String(msToSeconds(config.cameraOverlay.dismissAfterMs)),
  );
  const [snapshotRefreshSeconds, setSnapshotRefreshSeconds] = useState(
    String(msToSeconds(config.cameraOverlay.snapshotRefreshMs)),
  );

  // Screen power (advanced)
  const [screenPowerEnabled, setScreenPowerEnabled] = useState(config.screenPower.enabled);
  const [dimAfterSeconds, setDimAfterSeconds] = useState(
    String(msToSeconds(config.screenPower.dimAfterMs)),
  );
  const [dimOpacityPercent, setDimOpacityPercent] = useState(
    String(Math.round(config.screenPower.dimOpacity * 100)),
  );
  const [deepSleepAfterSeconds, setDeepSleepAfterSeconds] = useState(
    String(msToSeconds(config.screenPower.deepSleepAfterMs)),
  );
  const [deepSleepAction, setDeepSleepAction] = useState(config.screenPower.deepSleepAction);
  const [deepSleepCondition, setDeepSleepCondition] = useState(
    config.screenPower.deepSleepCondition,
  );
  const [quietHoursStart, setQuietHoursStart] = useState(config.screenPower.quietHoursStart);
  const [quietHoursEnd, setQuietHoursEnd] = useState(config.screenPower.quietHoursEnd);
  const [ambientLightEntityId, setAmbientLightEntityId] = useState(
    config.screenPower.ambientLightEntityId ?? "",
  );
  const [ambientLightThresholdLux, setAmbientLightThresholdLux] = useState(
    String(config.screenPower.ambientLightThresholdLux),
  );
  const [useWindowsDisplayPower, setUseWindowsDisplayPower] = useState(
    config.screenPower.useWindowsDisplayPower,
  );

  // Lock-screen calendars: which calendars feed the compounded lock-screen agenda.
  // Stored as the shared `calendar.hidden` set (entity ids that are NOT shown).
  const [lockScreenHidden, setLockScreenHidden] = useState<string[]>(
    config.calendar?.hidden ?? [],
  );
  const calendarStates = useMemo(
    () => states.filter((s) => s.entity_id.startsWith("calendar.")),
    [states],
  );

  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const nextConfig = useMemo<KioskConfig>(() => {
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
      calendar: {
        ...config.calendar,
        enabled: calendarEnabled,
        entityId: calendarEntityId.trim() || config.calendar.entityId,
        hidden: lockScreenHidden,
      },
      weather: {
        ...config.weather,
        enabled: weatherEnabled,
        entityId: weatherEntityId.trim() || config.weather.entityId,
      },
      grocery: {
        ...config.grocery,
        enabled: groceryEnabled,
        entityId: groceryEntityId.trim(),
        bridgeUrl: bridgeUrl.trim() || undefined,
        bridgeToken: bridgeToken.trim() || undefined,
        bridgeList: bridgeList.trim() || undefined,
      },
      slideshow: {
        ...config.slideshow,
        icloudSharedAlbumUrl: icloudAlbumUrl.trim() || undefined,
        intervalMs: secondsToMs(photoIntervalSeconds, config.slideshow.intervalMs),
        transition: photoTransition,
        shuffle: photoShuffle,
      },
      camera: { ...config.camera, enabled: cameraEnabled },
      faceRecognition: { ...config.faceRecognition, enabled: faceEnabled },
      nativeBridge: { ...config.nativeBridge, enabled: bridgeEnabled, preferredSourceKind },
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
        dismissAfterMs: secondsToMs(cameraDismissSeconds, config.cameraOverlay.dismissAfterMs),
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
        deepSleepAfterMs: secondsToMs(deepSleepAfterSeconds, config.screenPower.deepSleepAfterMs),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accessToken, allowSelfSignedCertificate, baseUrl, bridgeEnabled, calendarEnabled,
    calendarEntityId, cameraBindings, cameraEnabled, cameraDismissSeconds, cameraOverlayEnabled,
    cameraTriggerIds, config, dashboardUrl, defaultCameraEntityId, ambientLightEntityId,
    ambientLightThresholdLux, deepSleepAction, deepSleepAfterSeconds, deepSleepCondition,
    dimAfterSeconds, dimOpacityPercent, eventPrefix, faceEnabled, faceResetSeconds,
    groceryEnabled, groceryEntityId, bridgeUrl, bridgeToken, bridgeList, lockScreenHidden,
    icloudAlbumUrl, photoIntervalSeconds, photoTransition,
    photoShuffle, photosAfterNoFaceSeconds, preferredSourceKind,
    quietHoursEnd, quietHoursStart, screenPowerEnabled, snapshotRefreshSeconds, talkEntityId,
    useWindowsDisplayPower, weatherEnabled, weatherEntityId,
  ]);

  async function testHomeAssistant() {
    setTestStatus("testing");
    setMessage(null);
    try {
      if (window.surfaceKiosk) {
        await window.surfaceKiosk.testHomeAssistant(nextConfig);
      } else {
        const response = await fetch(`${nextConfig.homeAssistant.baseUrl}/api/`, {
          headers: { Authorization: `Bearer ${nextConfig.homeAssistant.accessToken ?? ""}` },
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
      setMessage("Saved to this tablet.");
      onSaved(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save config.");
    }
  }

  return (
    <div className="settings-view" aria-label="Kiosk settings">
      <header className="settings-header">
        <div>
          <span className="settings-eyebrow">Settings</span>
          <h1>Customize your kiosk</h1>
        </div>
        <div className="settings-header-actions">
          <button type="button" className="settings-test" onClick={testHomeAssistant}>
            {testStatus === "testing" ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />}
            <span>Test</span>
          </button>
          <button type="button" className="settings-save" onClick={save}>
            {testStatus === "ok" ? <Check size={16} /> : <Save size={16} />}
            <span>Save</span>
          </button>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      {message ? (
        <p className={`settings-message ${testStatus === "error" ? "error" : ""}`}>{message}</p>
      ) : null}

      <div className="settings-body">
        {/* CALENDAR */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Calendar</h2>
            <Switch checked={calendarEnabled} onChange={setCalendarEnabled} />
          </div>
          <p className="settings-help">Today's agenda and the full calendar view.</p>
          <EntityPicker
            states={states}
            domain="calendar"
            value={calendarEntityId}
            onChange={setCalendarEntityId}
            placeholder="calendar.family_calendar"
          />
        </section>

        {/* LOCK-SCREEN CALENDARS (shared / admin) */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Lock-screen calendars</h2>
          </div>
          <p className="settings-help">
            The lock screen shows all of these calendars compounded into one agenda.
            Each person picks their own calendar view in their profile settings.
          </p>
          {calendarStates.length === 0 ? (
            <p className="settings-help">No calendars discovered yet.</p>
          ) : (
            <div className="profile-check-list">
              {calendarStates.map((state) => {
                const shown = !lockScreenHidden.includes(state.entity_id);
                const name =
                  (typeof state.attributes?.friendly_name === "string" &&
                    state.attributes.friendly_name) ||
                  state.entity_id.replace(/^calendar\./, "").replace(/_/g, " ");
                return (
                  <label key={state.entity_id} className="profile-check-row">
                    <span>{name}</span>
                    <Switch
                      checked={shown}
                      onChange={(visible) =>
                        setLockScreenHidden((current) =>
                          visible
                            ? current.filter((id) => id !== state.entity_id)
                            : [...current, state.entity_id],
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* PROFILES (admin can edit each person's per-user settings) */}
        {people.length && onEditProfile ? (
          <section className="settings-card">
            <div className="settings-card-head">
              <h2>Profiles</h2>
            </div>
            <p className="settings-help">
              Open a person's settings to change their theme, calendars and dashboard
              layout. Each person can also edit their own from the dashboard.
            </p>
            <div className="profile-check-list">
              {people.map((person) => (
                <div key={person.id} className="profile-check-row">
                  <span>
                    {person.displayName}
                    {isAdminPerson(person) ? " · admin" : ""}
                  </span>
                  <button
                    type="button"
                    className="settings-test"
                    onClick={() => onEditProfile(person.id)}
                  >
                    <span>Edit</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* WEATHER */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Weather</h2>
            <Switch checked={weatherEnabled} onChange={setWeatherEnabled} />
          </div>
          <p className="settings-help">Temp + conditions on the dashboard and lock screen.</p>
          <EntityPicker
            states={states}
            domain="weather"
            value={weatherEntityId}
            onChange={setWeatherEntityId}
            placeholder="weather.home"
          />
        </section>

        {/* GROCERIES */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Groceries</h2>
            <Switch checked={groceryEnabled} onChange={setGroceryEnabled} />
          </div>
          <p className="settings-help">
            Apple Reminders (incl. shared lists) via the Mac reminders bridge — the recommended
            way, since it can add to a shared list. Leave the bridge fields blank to fall back to a
            Home Assistant to-do entity below.
          </p>
          <label className="settings-field wide">
            <span>Reminders bridge URL</span>
            <input
              type="text"
              value={bridgeUrl}
              placeholder="http://192.168.1.100:8781"
              onChange={(event) => setBridgeUrl(event.target.value)}
            />
          </label>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>Bridge token</span>
              <input
                type="password"
                value={bridgeToken}
                placeholder="shared secret"
                onChange={(event) => setBridgeToken(event.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>List name</span>
              <input
                type="text"
                value={bridgeList}
                placeholder="Grocery"
                onChange={(event) => setBridgeList(event.target.value)}
              />
            </label>
          </div>
          <div className="settings-toggle-row">
            <button
              type="button"
              className="settings-secondary-btn"
              disabled={!bridgeUrl.trim()}
              onClick={async () => {
                setBridgeTest("Testing…");
                const r = await window.surfaceKiosk?.remindersTest?.(
                  bridgeUrl.trim(),
                  bridgeToken.trim(),
                  bridgeList.trim() || "Grocery",
                );
                setBridgeTest(
                  r?.ok ? `✓ Connected — ${r.count ?? 0} open item(s)` : `✗ ${r?.error ?? "failed"}`,
                );
              }}
            >
              Test bridge
            </button>
            {bridgeTest ? <span className="settings-help">{bridgeTest}</span> : null}
          </div>
          <p className="settings-help">Fallback: a Home Assistant to-do entity.</p>
          <EntityPicker
            states={states}
            domain="todo"
            value={groceryEntityId}
            onChange={setGroceryEntityId}
            allowClear
            placeholder="todo.shopping_list"
          />
        </section>

        {/* PHOTOS */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Photos</h2>
          </div>
          <div className="settings-toggle-row">
            <span>Shuffle</span>
            <Switch checked={photoShuffle} onChange={setPhotoShuffle} />
          </div>
          <p className="settings-help">
            Paste an iCloud <strong>shared album</strong> link and its photos play on the lock
            screen automatically (refreshed hourly). On iPhone: open the shared album → share icon
            → Copy Link.
          </p>
          <label className="settings-field wide">
            <span>iCloud shared album link</span>
            <input
              type="text"
              value={icloudAlbumUrl}
              placeholder="https://photos.icloud.com/shared/album/…"
              onChange={(event) => setIcloudAlbumUrl(event.target.value)}
            />
          </label>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>Seconds per photo</span>
              <input
                value={photoIntervalSeconds}
                inputMode="numeric"
                onChange={(event) => setPhotoIntervalSeconds(event.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Transition</span>
              <select
                value={photoTransition}
                onChange={(event) => setPhotoTransition(event.target.value as "crossfade" | "cut")}
              >
                <option value="crossfade">Crossfade</option>
                <option value="cut">Cut</option>
              </select>
            </label>
          </div>
          <p className="settings-help">Videos &amp; Live Photos play 10s, muted.</p>
        </section>

        {/* CAMERAS */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Camera popups</h2>
            <Switch checked={cameraOverlayEnabled} onChange={setCameraOverlayEnabled} />
          </div>
          <p className="settings-help">Default camera shown when a doorbell/motion trigger fires.</p>
          <EntityPicker
            states={states}
            domain="camera"
            value={defaultCameraEntityId}
            onChange={setDefaultCameraEntityId}
            allowClear
            placeholder="camera.driveway"
          />
        </section>

        {/* AUTO-DIM */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Auto-dim</h2>
            <Switch checked={screenPowerEnabled} onChange={setScreenPowerEnabled} />
          </div>
          <p className="settings-help">Optional ambient-light sensor used to decide when it's dark.</p>
          <EntityPicker
            states={states}
            domain="sensor"
            value={ambientLightEntityId}
            onChange={setAmbientLightEntityId}
            allowClear
            placeholder="sensor.illuminance"
          />
        </section>

        {/* FEATURES */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Features</h2>
          </div>
          <div className="settings-toggles">
            <ToggleRow label="Face recognition" checked={faceEnabled} onChange={setFaceEnabled} />
            <ToggleRow label="Surface camera bridge" checked={bridgeEnabled} onChange={setBridgeEnabled} />
            <ToggleRow label="Browser camera" checked={cameraEnabled} onChange={setCameraEnabled} />
            <ToggleRow
              label="Trust HA certificate"
              checked={allowSelfSignedCertificate}
              onChange={setAllowSelfSignedCertificate}
            />
          </div>
        </section>

        {/* ADVANCED */}
        <details className="settings-advanced">
          <summary>
            <ChevronDown size={18} />
            <span>Advanced</span>
            <small>Connection, timing, bridge &amp; camera details</small>
          </summary>

          <div className="settings-advanced-body">
            <Field label="Home Assistant URL" wide>
              <input value={baseUrl} placeholder="https://homeassistant.local"
                onChange={(e) => setBaseUrl(e.target.value)} />
            </Field>
            <Field label="Dashboard URL" wide>
              <input value={dashboardUrl} placeholder="https://…/lovelace/default_view?kiosk"
                onChange={(e) => setDashboardUrl(e.target.value)} />
            </Field>
            <Field label="Long-lived access token" wide>
              <div className="settings-token">
                <input value={accessToken} type={showToken ? "text" : "password"} placeholder="Paste token"
                  onChange={(e) => setAccessToken(e.target.value)} />
                <button type="button" aria-label={showToken ? "Hide" : "Show"}
                  onClick={() => setShowToken((v) => !v)}>
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field label="Event prefix">
              <input value={eventPrefix} placeholder="surface_kiosk"
                onChange={(e) => setEventPrefix(e.target.value)} />
            </Field>
            <Field label="Bridge source">
              <select value={preferredSourceKind}
                onChange={(e) => setPreferredSourceKind(e.target.value as "Infrared" | "Color")}>
                <option value="Color">Color</option>
                <option value="Infrared">Infrared</option>
              </select>
            </Field>
            <Field label="Photos after no face (s)">
              <input value={photosAfterNoFaceSeconds} inputMode="numeric"
                onChange={(e) => setPhotosAfterNoFaceSeconds(e.target.value)} />
            </Field>
            <Field label="Face reset (s)">
              <input value={faceResetSeconds} inputMode="numeric"
                onChange={(e) => setFaceResetSeconds(e.target.value)} />
            </Field>

            <Field label="Dim after (s)">
              <input value={dimAfterSeconds} inputMode="numeric"
                onChange={(e) => setDimAfterSeconds(e.target.value)} />
            </Field>
            <Field label="Dim amount (%)">
              <input value={dimOpacityPercent} inputMode="numeric"
                onChange={(e) => setDimOpacityPercent(e.target.value)} />
            </Field>
            <Field label="Deep sleep after (s)">
              <input value={deepSleepAfterSeconds} inputMode="numeric"
                onChange={(e) => setDeepSleepAfterSeconds(e.target.value)} />
            </Field>
            <Field label="Deep sleep action">
              <select value={deepSleepAction}
                onChange={(e) => setDeepSleepAction(e.target.value as typeof deepSleepAction)}>
                <option value="dim">Stay dim</option>
                <option value="photos">Photos</option>
                <option value="blackout">Blackout</option>
              </select>
            </Field>
            <Field label="Deep sleep when">
              <select value={deepSleepCondition}
                onChange={(e) => setDeepSleepCondition(e.target.value as typeof deepSleepCondition)}>
                <option value="never">Never</option>
                <option value="quiet-hours">Quiet hours</option>
                <option value="ambient-dark">Ambient dark</option>
                <option value="either">Either</option>
                <option value="both">Both</option>
              </select>
            </Field>
            <Field label="Quiet hours start">
              <input value={quietHoursStart} placeholder="22:30"
                onChange={(e) => setQuietHoursStart(e.target.value)} />
            </Field>
            <Field label="Quiet hours end">
              <input value={quietHoursEnd} placeholder="06:30"
                onChange={(e) => setQuietHoursEnd(e.target.value)} />
            </Field>
            <Field label="Dark threshold (lux)">
              <input value={ambientLightThresholdLux} inputMode="numeric"
                onChange={(e) => setAmbientLightThresholdLux(e.target.value)} />
            </Field>
            <Field label="Talk entity">
              <input value={talkEntityId} placeholder="button.front_door_talk"
                onChange={(e) => setTalkEntityId(e.target.value)} />
            </Field>
            <Field label="Camera dismiss (s)">
              <input value={cameraDismissSeconds} inputMode="numeric"
                onChange={(e) => setCameraDismissSeconds(e.target.value)} />
            </Field>
            <Field label="Snapshot refresh (s)">
              <input value={snapshotRefreshSeconds} inputMode="numeric"
                onChange={(e) => setSnapshotRefreshSeconds(e.target.value)} />
            </Field>
            <Field label="Doorbell / motion triggers" wide>
              <textarea value={cameraTriggerIds} rows={3}
                placeholder="binary_sensor.driveway_person_detected"
                onChange={(e) => setCameraTriggerIds(e.target.value)} />
            </Field>
            <Field label="Trigger → camera bindings" wide>
              <textarea value={cameraBindings} rows={3}
                placeholder="binary_sensor.driveway_person_detected = camera.driveway"
                onChange={(e) => setCameraBindings(e.target.value)} />
            </Field>
            <label className="settings-checkbox-line">
              <input type="checkbox" checked={useWindowsDisplayPower}
                onChange={(e) => setUseWindowsDisplayPower(e.target.checked)} />
              <span>Use Windows display power for blackout</span>
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`calendar-switch ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="settings-toggle-row">
      <span>{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`settings-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
