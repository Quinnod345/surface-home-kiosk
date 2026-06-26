import {
  Home,
  Images,
  Maximize2,
  Minimize2,
  Radio,
  RefreshCw,
  ScanFace,
  Settings,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DashboardMode,
  defaultConfig,
  loadKioskConfig,
  saveKioskConfig,
  accentForPerson,
  accentPalette,
  getProfilePrefs,
  isAdminPerson,
  type KioskConfig,
  type PersonProfile,
} from "./config";
import { resolveKioskAssetUrl } from "./assetUrl";
import {
  CameraAlertOverlay,
  type CameraAlert,
} from "./CameraAlertOverlay";
import { EnrollmentPanel } from "./EnrollmentPanel";
import { checkFaceModelFiles, loadFaceApi } from "./faceApiRuntime";
import { HomeCenterDashboard } from "./HomeCenterDashboard";
import { IdleClock } from "./IdleClock";
import { SettingsView } from "./SettingsView";
import { UserSettingsView } from "./UserSettingsView";
import {
  loadEnrollments,
  mergePeople,
  type EnrolledPerson,
} from "./enrollmentStore";
import {
  callHomeAssistantService,
  fireKioskEvent,
  friendlyStateName,
  type HaState,
  kioskPayload,
  setHomeAssistantText,
} from "./homeAssistant";
import { useCameraFeed } from "./useCameraFeed";
import {
  useFaceRecognition,
  type FaceRecognitionStatus,
} from "./useFaceRecognition";
import { useHomeAssistantStates } from "./useHomeAssistantStates";
import { useMotionPresence } from "./useMotionPresence";
import { useNativeBridgeFrames } from "./useNativeBridgeFrames";
import { useAmbientDarkness } from "./useAmbientDarkness";
import { useRemoteFaceRecognition } from "./useRemoteFaceRecognition";
import { ControlsWarmup } from "./ControlsWarmup";
import { useTodayAgenda } from "./useCalendar";
import { CalendarOverlay } from "./CalendarOverlay";
import { WeatherGlance } from "./WeatherGlance";
import { StartupIndicator, type StartupTask } from "./StartupIndicator";
import { Slideshow, type MediaSlide } from "./Slideshow";

function isImagePath(pathname: string) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(pathname);
}

function hasHomeAssistantConfig(config: KioskConfig) {
  return Boolean(
    config.homeAssistant.baseUrl &&
      config.homeAssistant.dashboardUrl &&
      config.homeAssistant.accessToken,
  );
}

function faceStatusLabel(status: FaceRecognitionStatus, peopleCount: number) {
  if (status === "no-reference-faces" || peopleCount === 0) return "Enroll";
  if (status === "model-error") return "Model error";
  return status;
}

function entityDomain(entityId: string) {
  return entityId.split(".")[0] ?? "";
}

function entitySearchText(state: HaState) {
  return `${state.entity_id} ${friendlyStateName(state)}`.toLowerCase();
}

function isAvailableHaState(state: HaState) {
  return state.state !== "unavailable" && state.state !== "unknown";
}

function isCameraTriggerCandidate(state: HaState) {
  if (entityDomain(state.entity_id) !== "binary_sensor") return false;
  if (state.state !== "on") return false;

  const text = entitySearchText(state);
  const deviceClass = state.attributes?.device_class;
  const deviceClassText = typeof deviceClass === "string" ? deviceClass : "";
  const cameraPlace = /(doorbell|driveway|front|side|backyard|yard|porch|entry|entrance)/;
  const cameraSignal = /(person|motion|visitor|ding|detected|occupancy|presence)/;

  return (
    (["motion", "occupancy", "presence"].includes(deviceClassText) &&
      cameraPlace.test(text)) ||
    (cameraSignal.test(text) && cameraPlace.test(text)) ||
    /person_detected|motion_detected|doorbell/.test(text)
  );
}

function configuredCameraBinding(config: KioskConfig, triggerEntityId: string) {
  return config.cameraOverlay.cameraBindings.find(
    (binding) => binding.triggerEntityId === triggerEntityId,
  )?.cameraEntityId;
}

function entityTokens(entityId: string) {
  return new Set(
    entityId
      .replace(/^[^.]+\./, "")
      .split(/[_\W]+/)
      .filter((token) => token.length > 1 && !["camera", "binary", "sensor"].includes(token)),
  );
}

function bestCameraForTrigger(
  trigger: HaState,
  states: HaState[],
  config: KioskConfig,
) {
  const configured = configuredCameraBinding(config, trigger.entity_id);
  if (configured) {
    const configuredState = states.find((state) => state.entity_id === configured);
    if (configuredState) return configuredState;
    return {
      entity_id: configured,
      state: "unknown",
      attributes: { friendly_name: configured.replace(/^camera\./, "").replace(/_/g, " ") },
    };
  }

  const cameras = states.filter(
    (state) => entityDomain(state.entity_id) === "camera" && isAvailableHaState(state),
  );
  const triggerTokens = entityTokens(trigger.entity_id);
  let best: { state: HaState; score: number } | null = null;

  for (const camera of cameras) {
    const cameraTokens = entityTokens(camera.entity_id);
    let score = 0;
    for (const token of cameraTokens) {
      if (triggerTokens.has(token)) score += 1;
    }
    if (entitySearchText(trigger).includes(friendlyStateName(camera).toLowerCase())) {
      score += 2;
    }
    if (!best || score > best.score) best = { state: camera, score };
  }

  if (best && best.score > 0) return best.state;

  if (config.cameraOverlay.defaultCameraEntityId) {
    const defaultState = states.find(
      (state) => state.entity_id === config.cameraOverlay.defaultCameraEntityId,
    );
    if (defaultState) return defaultState;
    return {
      entity_id: config.cameraOverlay.defaultCameraEntityId,
      state: "unknown",
      attributes: {
        friendly_name: config.cameraOverlay.defaultCameraEntityId
          .replace(/^camera\./, "")
          .replace(/_/g, " "),
      },
    };
  }

  return cameras[0] ?? null;
}

function activeCameraTrigger(states: HaState[], config: KioskConfig) {
  const explicitIds = new Set(config.cameraOverlay.triggerEntityIds);

  return states.find((state) => {
    if (!isAvailableHaState(state)) return false;
    if (explicitIds.size > 0) {
      return explicitIds.has(state.entity_id) && state.state === "on";
    }
    return isCameraTriggerCandidate(state);
  });
}

function timeToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWithinQuietHours(now: Date, startValue: string, endValue: string) {
  const start = timeToMinutes(startValue);
  const end = timeToMinutes(endValue);
  if (start === null || end === null || start === end) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function haStateNumber(state: HaState | undefined) {
  if (!state) return null;
  const direct = Number(state.state);
  if (Number.isFinite(direct)) return direct;

  const measurement = state.attributes?.measurement;
  if (typeof measurement === "number" && Number.isFinite(measurement)) return measurement;
  if (typeof measurement === "string" && Number.isFinite(Number(measurement))) {
    return Number(measurement);
  }

  return null;
}

function isAmbientDark(states: HaState[], config: KioskConfig) {
  const entityId = config.screenPower.ambientLightEntityId;
  if (!entityId) return false;

  const value = haStateNumber(states.find((state) => state.entity_id === entityId));
  return value !== null && value <= config.screenPower.ambientLightThresholdLux;
}

function shouldUseDeepSleep(states: HaState[], config: KioskConfig, now: Date) {
  const quiet = isWithinQuietHours(
    now,
    config.screenPower.quietHoursStart,
    config.screenPower.quietHoursEnd,
  );
  const dark = isAmbientDark(states, config);

  switch (config.screenPower.deepSleepCondition) {
    case "never":
      return false;
    case "quiet-hours":
      return quiet;
    case "ambient-dark":
      return dark;
    case "both":
      return quiet && dark;
    case "either":
    default:
      return quiet || dark;
  }
}

export default function App() {
  const [config, setConfig] = useState<KioskConfig>(defaultConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [mode, setMode] = useState<DashboardMode>("idle");
  const [activePersonId, setActivePersonId] = useState<string | null>(null);
  // Debug override for previewing a profile's theme/colors without face recognition.
  // `undefined` = follow live recognition; `null` = force "Home" (no person);
  // a string = force that person id. Toggled from the identity pill in the top bar.
  const [debugPersonId, setDebugPersonId] = useState<string | null | undefined>(undefined);
  const [personMenuOpen, setPersonMenuOpen] = useState(false);
  const [icloudSlides, setIcloudSlides] = useState<MediaSlide[]>([]);
  const [isKiosk, setIsKiosk] = useState(false);
  const [statusVisible, setStatusVisible] = useState(false);
  const [warmupActive, setWarmupActive] = useState(true);
  const [modelsReady, setModelsReady] = useState(false);
  const [startupExpired, setStartupExpired] = useState(false);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  // When set, the per-user settings panel is open for this person id.
  const [userSettingsPersonId, setUserSettingsPersonId] = useState<string | null>(null);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [enrolledPeople, setEnrolledPeople] = useState<EnrolledPerson[]>([]);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [cameraAlert, setCameraAlert] = useState<CameraAlert | null>(null);
  const [screenPowerMode, setScreenPowerMode] = useState<
    "awake" | "dim" | "blackout"
  >("awake");
  const [haStatus, setHaStatus] = useState<"idle" | "ok" | "error">("idle");
  const [haError, setHaError] = useState<string | null>(null);
  const [modelTestStatus, setModelTestStatus] = useState<
    "idle" | "testing" | "ok" | "error"
  >("idle");
  const [modelTestMessage, setModelTestMessage] = useState<string | null>(null);
  const lastInteractionAtRef = useRef(Date.now());
  // When the user explicitly picks Photos, don't let face recognition yank them
  // straight back to the dashboard until they interact or this window passes.
  const stayOnPhotosUntilRef = useRef(0);
  const lastFaceSeenAtRef = useRef<number | null>(null);
  const lastGreetedRef = useRef<Record<string, number>>({});
  const lastOccupancyRef = useRef(false);
  const openedFirstRunRef = useRef(false);
  const controlsTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const dismissedCameraAlertRef = useRef<string | null>(null);
  const displayPowerOffRef = useRef(false);

  const effectiveConfig = useMemo<KioskConfig>(
    () => ({
      ...config,
      people: mergePeople(config.people, enrolledPeople),
    }),
    [config, enrolledPeople],
  );

  const { videoRef, status: cameraStatus, stream: cameraStream } = useCameraFeed(
    effectiveConfig.camera.enabled,
    effectiveConfig.camera.width,
    effectiveConfig.camera.height,
  );
  // Use the infrared camera only when the room is dark; in a lit room the normal
  // camera is enough and the IR emitter can stay off.
  const isDark = useAmbientDarkness(
    videoRef,
    cameraStatus === "active",
    effectiveConfig.nativeBridge.enabled,
  );
  const nativeBridge = useNativeBridgeFrames(
    effectiveConfig,
    effectiveConfig.nativeBridge.enabled && isDark,
  );
  const motion = useMotionPresence(
    videoRef,
    cameraStatus === "active",
    effectiveConfig.camera.motionSensitivity,
    effectiveConfig.camera.motionHoldMs,
  );
  const bridgeInput = useMemo(
    () => ({
      dataUrl: nativeBridge.frame?.dataUrl,
      sourceKind: nativeBridge.frame?.sourceKind,
      connected: nativeBridge.status === "connected",
      at: nativeBridge.frame?.at,
    }),
    [
      nativeBridge.frame?.dataUrl,
      nativeBridge.frame?.sourceKind,
      nativeBridge.frame?.at,
      nativeBridge.status,
    ],
  );
  // When a remote recognition service is configured (e.g. a Mac mini), run there
  // and keep tfjs off the Surface GPU; otherwise recognize locally.
  const remoteRecognitionEnabled = Boolean(
    effectiveConfig.faceRecognition.enabled && effectiveConfig.faceRecognition.remoteUrl,
  );
  const localFace = useFaceRecognition(
    videoRef,
    effectiveConfig,
    cameraStatus === "active",
    bridgeInput,
    !remoteRecognitionEnabled,
  );
  const remoteFace = useRemoteFaceRecognition(
    videoRef,
    effectiveConfig,
    cameraStatus === "active",
    bridgeInput,
    remoteRecognitionEnabled,
  );
  const faceRecognition = remoteRecognitionEnabled ? remoteFace : localFace;

  const slides = useMemo<MediaSlide[]>(() => {
    const local: MediaSlide[] = effectiveConfig.slideshow.photos
      .filter(isImagePath)
      .map((path) => ({ type: "image", url: resolveKioskAssetUrl(path) }));
    // iCloud album media first; fall back to bundled photos when the album is
    // empty/unconfigured.
    return icloudSlides.length ? [...icloudSlides, ...local] : local;
  }, [effectiveConfig.slideshow.photos, icloudSlides]);

  // Pull media from a configured iCloud shared album (signed URLs expire, so
  // refresh hourly). Done in the main process to avoid CORS.
  const icloudAlbumUrl = effectiveConfig.slideshow.icloudSharedAlbumUrl;
  useEffect(() => {
    const url = icloudAlbumUrl?.trim();
    if (!url || !window.surfaceKiosk?.getIcloudAlbumPhotos) {
      setIcloudSlides([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const items = await window.surfaceKiosk!.getIcloudAlbumPhotos(url);
        if (!cancelled && Array.isArray(items) && items.length) {
          setIcloudSlides(items as MediaSlide[]);
        }
      } catch {
        // keep whatever we had
      }
    };
    void load();
    const id = window.setInterval(load, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [icloudAlbumUrl]);
  // The debug override (when set) wins over live recognition so the dashboard,
  // greeting and per-profile theme all follow the previewed person.
  const effectivePersonId = debugPersonId !== undefined ? debugPersonId : activePersonId;
  const activePerson = useMemo(
    () =>
      effectiveConfig.people.find((person) => person.id === effectivePersonId) ?? null,
    [effectivePersonId, effectiveConfig.people],
  );
  // Per-user accent theme, keyed off the recognized person's first name. Unknown
  // people fall through to the default (Quinn) palette.
  const themeKey = useMemo(() => {
    const name = (activePerson?.displayName ?? activePerson?.id ?? "").trim().toLowerCase();
    if (name.startsWith("mark")) return "mark";
    if (name.startsWith("rachel")) return "rachel";
    if (name.startsWith("nora")) return "nora";
    return undefined;
  }, [activePerson]);

  // Preferences for whoever is currently shown (live recognition or debug override).
  const activePrefs = useMemo(
    () => getProfilePrefs(effectiveConfig, activePerson?.id),
    [effectiveConfig, activePerson],
  );

  // Drive the accent (and background tint) from the person's stored hex so every
  // profile is themed automatically — no per-name CSS needed. Inline vars win over
  // the legacy data-theme blocks.
  const themeStyle = useMemo<CSSProperties | undefined>(() => {
    if (!activePerson) return undefined;
    const palette = accentPalette(accentForPerson(effectiveConfig, activePerson));
    const vars: Record<string, string> = {
      "--amber": palette.accent,
      "--amber-hi": palette.accentHi,
      "--amber-rgb": palette.accentRgb,
    };
    if (activePrefs.theme?.fontDisplay) {
      vars["--font-display"] = activePrefs.theme.fontDisplay;
    }
    return vars as CSSProperties;
  }, [activePerson, activePrefs, effectiveConfig]);

  // Boot warm-up progress shown to the user so the kiosk doesn't feel broken
  // while models/camera/service spin up on first load.
  const startupTasks = useMemo<StartupTask[]>(() => {
    const tasks: StartupTask[] = [];
    if (effectiveConfig.camera.enabled) {
      tasks.push({ label: "Camera", done: cameraStatus === "active" });
    }
    if (effectiveConfig.faceRecognition.enabled) {
      tasks.push({ label: "Face models", done: modelsReady });
      if (effectiveConfig.faceRecognition.remoteUrl) {
        tasks.push({ label: "Recognition service", done: faceRecognition.status === "ready" });
      }
    }
    return tasks;
  }, [
    effectiveConfig.camera.enabled,
    effectiveConfig.faceRecognition.enabled,
    effectiveConfig.faceRecognition.remoteUrl,
    cameraStatus,
    modelsReady,
    faceRecognition.status,
  ]);
  const showStartup =
    mode === "idle" &&
    !startupExpired &&
    (warmupActive || (startupTasks.length > 0 && !startupTasks.every((task) => task.done)));
  const homeAssistantConfigured = useMemo(
    () => hasHomeAssistantConfig(effectiveConfig),
    [effectiveConfig],
  );
  const homeAssistant = useHomeAssistantStates(
    effectiveConfig,
    homeAssistantConfigured,
    8000,
  );
  const calendarEvents = useTodayAgenda(
    effectiveConfig,
    homeAssistant.states,
    homeAssistantConfigured,
  );
  const homeAssistantSetupNeeded = configLoaded && !homeAssistantConfigured;
  const cameraSetupNeeded =
    configLoaded &&
    (!effectiveConfig.faceRecognition.enabled || !effectiveConfig.camera.enabled);
  const faceEnrollmentNeeded =
    configLoaded &&
    effectiveConfig.faceRecognition.enabled &&
    effectiveConfig.people.length === 0;
  const setupNeeded = homeAssistantSetupNeeded || cameraSetupNeeded;
  const guidedStartNeeded = setupNeeded || faceEnrollmentNeeded;
  const faceStatusText = faceStatusLabel(
    faceRecognition.status,
    effectiveConfig.people.length,
  );

  const sendEvent = useCallback(
    async (name: string, payload: Record<string, unknown>) => {
      const result = await fireKioskEvent(effectiveConfig, name, payload);
      if (result.ok) {
        setHaStatus("ok");
        setHaError(null);
      } else {
        setHaStatus("error");
        setHaError(result.error);
      }
    },
    [effectiveConfig],
  );

  const callService = useCallback(
    async (domain: string, service: string, payload: Record<string, unknown>) => {
      const result = await callHomeAssistantService(
        effectiveConfig,
        domain,
        service,
        payload,
      );
      if (result.ok) {
        setHaStatus("ok");
        setHaError(null);
        void homeAssistant.refresh();
      } else {
        setHaStatus("error");
        setHaError(result.error);
      }
    },
    [effectiveConfig, homeAssistant],
  );

  const wakeScreen = useCallback(() => {
    setScreenPowerMode("awake");
    if (displayPowerOffRef.current) {
      displayPowerOffRef.current = false;
      void window.surfaceKiosk?.setDisplayPower(true);
    }
  }, []);

  // Touching the lock-screen calendar should keep the screen awake and reset the
  // idle timers, but NOT open the dashboard (the overlay stops the tap from
  // reaching the global handler that would otherwise enter the dashboard).
  const keepAwake = useCallback(() => {
    lastInteractionAtRef.current = Date.now();
    wakeScreen();
  }, [wakeScreen]);

  // Persist a config change (e.g. calendar colours/visibility) optimistically:
  // update in memory immediately, then write it through to disk.
  const persistConfig = useCallback((next: KioskConfig) => {
    setConfig(next);
    void saveKioskConfig(next).then((saved) => setConfig(saved)).catch(() => {});
  }, []);

  // The person whose per-user settings panel is open (if any).
  const userSettingsPerson = useMemo(
    () => effectiveConfig.people.find((p) => p.id === userSettingsPersonId) ?? null,
    [effectiveConfig.people, userSettingsPersonId],
  );

  // Settings access: admins (Quinn) get the full system settings; everyone else
  // only edits their own profile. With no one recognized, the device owner opens
  // system settings.
  const openSettings = useCallback(() => {
    if (activePerson && !isAdminPerson(activePerson)) {
      setUserSettingsPersonId(activePerson.id);
    } else {
      setShowSetup(true);
    }
  }, [activePerson]);

  const revealControls = useCallback(() => {
    wakeScreen();
    setControlsVisible(true);
    if (controlsTimerRef.current) {
      window.clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsTimerRef.current = null;
    }, 7000);
  }, [wakeScreen]);

  const toggleStatus = useCallback(() => {
    setStatusVisible((visible) => {
      const next = !visible;
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      if (next) {
        statusTimerRef.current = window.setTimeout(() => {
          setStatusVisible(false);
          statusTimerRef.current = null;
        }, 6000);
      }
      return next;
    });
  }, []);

  const enterDashboard = useCallback(
    (reason: string, person?: PersonProfile | null) => {
      lastInteractionAtRef.current = Date.now();
      wakeScreen();
      if (person) setActivePersonId(person.id);
      if (configLoaded && !homeAssistantConfigured) {
        setMode("idle");
        setShowSetup(true);
        return;
      }
      setMode("dashboard");
      void sendEvent("dashboard_opened", {
        ...kioskPayload(effectiveConfig, "dashboard", person ?? activePerson),
        reason,
      });
    },
    [
      activePerson,
      configLoaded,
      effectiveConfig,
      homeAssistantConfigured,
      sendEvent,
      wakeScreen,
    ],
  );

  const returnToPhotos = useCallback(
    (reason: string) => {
      setMode("idle");
      void sendEvent("slideshow_opened", {
        ...kioskPayload(effectiveConfig, "idle", activePerson),
        reason,
      });
    },
    [activePerson, effectiveConfig, sendEvent],
  );

  const recordInteraction = useCallback(() => {
    lastInteractionAtRef.current = Date.now();
    stayOnPhotosUntilRef.current = 0;
    wakeScreen();
    if (mode === "idle" && effectiveConfig.behavior.openDashboardOnTap) {
      enterDashboard("touch", activePerson);
    }
  }, [
    activePerson,
    effectiveConfig.behavior.openDashboardOnTap,
    enterDashboard,
    mode,
    wakeScreen,
  ]);

  useEffect(() => {
    let cancelled = false;

    loadKioskConfig()
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .finally(() => {
        if (!cancelled) setConfigLoaded(true);
      });

    loadEnrollments().then((store) => {
      if (!cancelled) setEnrolledPeople(store.people);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!homeAssistantSetupNeeded || openedFirstRunRef.current) return;
    openedFirstRunRef.current = true;
    setShowSetup(true);
  }, [homeAssistantSetupNeeded]);

  // Pre-render the control popups off-screen for a few seconds so React/V8/CSS
  // warm up, then unmount so there's no ongoing paint cost. Makes the first real
  // menu open fast instead of paying ~150ms of first-time work.
  useEffect(() => {
    const id = window.setTimeout(() => setWarmupActive(false), 3500);
    return () => window.clearTimeout(id);
  }, []);

  // Never let the startup overlay stick around past 30s, even if a task stalls.
  useEffect(() => {
    const id = window.setTimeout(() => setStartupExpired(true), 30000);
    return () => window.clearTimeout(id);
  }, []);

  // Pre-warm the face-recognition models a few seconds after boot (deferred so it
  // doesn't compete with the first paint) so opening face registration is instant.
  // Resolves the "models" startup task either way so the overlay never hangs.
  useEffect(() => {
    if (!effectiveConfig.faceRecognition.enabled) {
      setModelsReady(true);
      return;
    }
    const id = window.setTimeout(() => {
      void loadFaceApi(effectiveConfig.faceRecognition.modelUrl)
        .then(() => setModelsReady(true))
        .catch(() => setModelsReady(true));
    }, 1500);
    return () => window.clearTimeout(id);
  }, [effectiveConfig.faceRecognition.enabled, effectiveConfig.faceRecognition.modelUrl]);


  useEffect(() => {
    const interval = window.setInterval(() => {
      if (cameraAlert) {
        wakeScreen();
        return;
      }

      const lastFaceSeenAt = lastFaceSeenAtRef.current;
      const noFaceFor = lastFaceSeenAt ? Date.now() - lastFaceSeenAt : Number.POSITIVE_INFINITY;
      const interactionIdleFor = Date.now() - lastInteractionAtRef.current;
      const screenIdleFor = Math.min(noFaceFor, interactionIdleFor);
      const shouldDim =
        effectiveConfig.screenPower.enabled &&
        screenIdleFor > effectiveConfig.screenPower.dimAfterMs;
      const shouldDeepSleepNow =
        shouldDim &&
        screenIdleFor > effectiveConfig.screenPower.deepSleepAfterMs &&
        shouldUseDeepSleep(homeAssistant.states, effectiveConfig, new Date());

      if (!shouldDim) {
        wakeScreen();
      } else if (shouldDeepSleepNow) {
        if (effectiveConfig.screenPower.deepSleepAction === "blackout") {
          setScreenPowerMode("blackout");
          if (
            effectiveConfig.screenPower.useWindowsDisplayPower &&
            !displayPowerOffRef.current
          ) {
            displayPowerOffRef.current = true;
            void window.surfaceKiosk?.setDisplayPower(false);
          }
        } else {
          setScreenPowerMode("dim");
          if (effectiveConfig.screenPower.deepSleepAction === "photos" && mode !== "idle") {
            returnToPhotos("screen-power");
          }
        }
      } else {
        setScreenPowerMode("dim");
      }

      if (
        activePersonId &&
        noFaceFor > effectiveConfig.behavior.faceResetMs
      ) {
        setActivePersonId(null);
        void setHomeAssistantText(
          effectiveConfig,
          effectiveConfig.homeAssistant.activePersonEntityId,
          "No face detected",
        );
      }

      if (
        mode === "dashboard" &&
        effectiveConfig.behavior.returnToPhotosOnIdle &&
        interactionIdleFor > effectiveConfig.behavior.dashboardIdleTimeoutMs &&
        noFaceFor > effectiveConfig.behavior.photosAfterNoFaceMs
      ) {
        returnToPhotos("idle-timeout");
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [
    activePersonId,
    cameraAlert,
    effectiveConfig.screenPower,
    effectiveConfig.behavior.dashboardIdleTimeoutMs,
    effectiveConfig.behavior.faceResetMs,
    effectiveConfig.behavior.photosAfterNoFaceMs,
    effectiveConfig.behavior.returnToPhotosOnIdle,
    effectiveConfig.homeAssistant.activePersonEntityId,
    mode,
    returnToPhotos,
    effectiveConfig,
    homeAssistant.states,
    wakeScreen,
  ]);

  useEffect(() => {
    if (motion.occupied === lastOccupancyRef.current) return;
    lastOccupancyRef.current = motion.occupied;

    void sendEvent("occupancy_changed", {
      device: effectiveConfig.deviceName,
      occupied: motion.occupied,
      score: Number(motion.score.toFixed(4)),
      at: new Date().toISOString(),
    });
  }, [effectiveConfig.deviceName, motion.occupied, motion.score, sendEvent]);

  useEffect(() => {
    if (faceRecognition.lastDetectionAt) {
      lastFaceSeenAtRef.current = Date.now();
      wakeScreen();
    }
  }, [faceRecognition.lastDetectionAt, wakeScreen]);

  useEffect(() => {
    const person = faceRecognition.person;
    if (!person) return;

    lastFaceSeenAtRef.current = Date.now();

    const lastGreetedAt = lastGreetedRef.current[person.id] ?? 0;
    if (Date.now() - lastGreetedAt > effectiveConfig.faceRecognition.greetCooldownMs) {
      lastGreetedRef.current[person.id] = Date.now();
      void sendEvent("person_recognized", {
        device: effectiveConfig.deviceName,
        person_id: person.id,
        person_name: person.displayName,
        close: faceRecognition.face?.close ?? false,
        distance: faceRecognition.face?.distance ?? null,
        at: new Date().toISOString(),
      });
      void setHomeAssistantText(
        effectiveConfig,
        effectiveConfig.homeAssistant.activePersonEntityId,
        person.displayName,
      );
    }

    setActivePersonId(person.id);

    if (
      Date.now() >= stayOnPhotosUntilRef.current &&
      (effectiveConfig.faceRecognition.openDashboardOnRecognition ||
        (faceRecognition.face?.close &&
          effectiveConfig.behavior.openDashboardOnCloseFace))
    ) {
      enterDashboard(
        faceRecognition.face?.close ? "recognized-close-face" : "recognized-face",
        person,
      );
    }
  }, [
    effectiveConfig,
    enterDashboard,
    faceRecognition.face?.close,
    faceRecognition.face?.distance,
    faceRecognition.person,
    sendEvent,
  ]);

  useEffect(() => {
    if (
      Date.now() >= stayOnPhotosUntilRef.current &&
      mode === "idle" &&
      faceRecognition.face?.close &&
      effectiveConfig.behavior.openDashboardOnCloseFace
    ) {
      enterDashboard("close-face", faceRecognition.person);
    }
  }, [
    effectiveConfig.behavior.openDashboardOnCloseFace,
    enterDashboard,
    faceRecognition.face?.close,
    faceRecognition.person,
    mode,
  ]);

  const openCameraAlert = useCallback(
    (entityId: string, triggerEntityId?: string) => {
      wakeScreen();
      const cameraState = homeAssistant.states.find(
        (state) => state.entity_id === entityId,
      );
      setCameraAlert({
        entityId,
        title: cameraState ? friendlyStateName(cameraState) : entityId,
        triggerEntityId,
        openedAt: Date.now(),
      });
      setMode("dashboard");
    },
    [homeAssistant.states, wakeScreen],
  );

  useEffect(() => {
    if (!effectiveConfig.cameraOverlay.enabled || !homeAssistantConfigured) return;
    if (homeAssistant.states.length === 0) return;

    const trigger = activeCameraTrigger(homeAssistant.states, effectiveConfig);
    if (!trigger) return;

    const camera = bestCameraForTrigger(trigger, homeAssistant.states, effectiveConfig);
    if (!camera) return;

    const alertKey = `${trigger.entity_id}:${trigger.last_changed ?? trigger.last_updated ?? trigger.state}`;
    if (dismissedCameraAlertRef.current === alertKey) return;
    if (
      cameraAlert?.triggerEntityId === trigger.entity_id &&
      cameraAlert.entityId === camera.entity_id
    ) {
      return;
    }

    setCameraAlert({
      entityId: camera.entity_id,
      title: friendlyStateName(camera),
      triggerEntityId: trigger.entity_id,
      openedAt: Date.now(),
    });
    wakeScreen();
    setMode("dashboard");
    void sendEvent("camera_alert_opened", {
      device: effectiveConfig.deviceName,
      trigger_entity_id: trigger.entity_id,
      camera_entity_id: camera.entity_id,
      at: new Date().toISOString(),
    });
  }, [
    cameraAlert?.entityId,
    cameraAlert?.triggerEntityId,
    effectiveConfig,
    homeAssistant.states,
    homeAssistantConfigured,
    sendEvent,
    wakeScreen,
  ]);

  const closeCameraAlert = useCallback(() => {
    if (cameraAlert?.triggerEntityId) {
      const trigger = homeAssistant.states.find(
        (state) => state.entity_id === cameraAlert.triggerEntityId,
      );
      dismissedCameraAlertRef.current = trigger
        ? `${trigger.entity_id}:${trigger.last_changed ?? trigger.last_updated ?? trigger.state}`
        : cameraAlert.triggerEntityId;
    }
    setCameraAlert(null);
  }, [cameraAlert, homeAssistant.states]);

  useEffect(
    () => () => {
      if (controlsTimerRef.current) {
        window.clearTimeout(controlsTimerRef.current);
      }
    },
    [],
  );

  const showFallbackPhoto = slides.length === 0;
  const testPerson = activePerson ?? effectiveConfig.people[0] ?? null;

  function runRecognitionTest() {
    if (!testPerson) return;
    setActivePersonId(testPerson.id);
    enterDashboard("recognition-test", testPerson);
  }

  async function runModelTest() {
    setModelTestStatus("testing");
    setModelTestMessage(null);
    try {
      if (window.surfaceKiosk?.checkModels) {
        const modelFiles = await window.surfaceKiosk.checkModels();
        if (!modelFiles.ok) {
          const missing = modelFiles.files
            .filter((file) => !file.exists || file.size <= 0)
            .map((file) => file.name)
            .join(", ");
          throw new Error(`Missing model files in ${modelFiles.modelsDir}: ${missing}`);
        }
      }

      await checkFaceModelFiles(effectiveConfig.faceRecognition.modelUrl);
      await loadFaceApi(effectiveConfig.faceRecognition.modelUrl);
      setModelTestStatus("ok");
      setModelTestMessage("Models loaded.");
    } catch (error) {
      setModelTestStatus("error");
      setModelTestMessage(
        error instanceof Error ? error.message : "Face models could not load.",
      );
    }
  }

  return (
    <main
      className={`app app-${mode}`}
      data-theme={themeKey}
      style={themeStyle}
      onPointerDown={recordInteraction}
      onKeyDown={recordInteraction}
      tabIndex={0}
    >
      <video ref={videoRef} className="camera-probe" muted playsInline />
      {warmupActive ? <ControlsWarmup /> : null}

      <section className="idle-stage" aria-hidden={mode !== "idle"}>
        {showFallbackPhoto ? (
          <div className="photo-fallback" />
        ) : (
          <Slideshow
            slides={slides}
            intervalMs={effectiveConfig.slideshow.intervalMs}
            transition={effectiveConfig.slideshow.transition ?? "crossfade"}
            shuffle={effectiveConfig.slideshow.shuffle ?? true}
            videoMs={10000}
          />
        )}
        <div className="idle-shade" />
        {showStartup ? <StartupIndicator tasks={startupTasks} /> : null}
        <IdleClock />
        {effectiveConfig.weather?.enabled ? (
          <div className="idle-weather">
            <WeatherGlance
              state={
                homeAssistant.states.find(
                  (s) => s.entity_id === effectiveConfig.weather?.entityId,
                ) ??
                homeAssistant.states.find((s) => s.entity_id.startsWith("weather.")) ??
                null
              }
              variant="lock"
            />
          </div>
        ) : null}
        {effectiveConfig.calendar?.enabled ? (
          <CalendarOverlay events={calendarEvents} onInteract={keepAwake} />
        ) : null}
        <div className="idle-status">
          <span className={motion.occupied ? "status-dot live" : "status-dot"} />
          <span>{motion.occupied ? "Room active" : "Room quiet"}</span>
          {faceRecognition.person ? (
            <span>{faceRecognition.person.displayName}</span>
          ) : null}
        </div>
      </section>

      <section className="dashboard-stage" aria-hidden={mode !== "dashboard"}>
        {!homeAssistantConfigured ? (
          <div className="dashboard-empty">
            <span className="eyebrow">Home Assistant</span>
            <h2>Connect your dashboard</h2>
            <button type="button" className="save-action" onClick={() => setShowSetup(true)}>
              <Settings size={18} />
              <span>Setup</span>
            </button>
          </div>
        ) : mode === "dashboard" ? (
          <HomeCenterDashboard
            config={effectiveConfig}
            states={homeAssistant.states}
            status={homeAssistant.status}
            error={homeAssistant.error}
            activePerson={activePerson}
            hiddenSections={activePrefs.hiddenSections}
            calendarEntityIds={activePrefs.calendarEntityIds}
            onCallService={callService}
            onOpenCamera={openCameraAlert}
            onRefresh={homeAssistant.refresh}
            onSaveConfig={persistConfig}
          />
        ) : null}
      </section>

      <button
        type="button"
        className="corner-hotzone top-right"
        aria-label="Show controls"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={revealControls}
      />
      <button
        type="button"
        className="corner-hotzone top-left"
        aria-label="Show controls"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={revealControls}
      />
      <button
        type="button"
        className="corner-hotzone bottom-left"
        aria-label="Show controls"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={revealControls}
      />
      <button
        type="button"
        className="corner-hotzone bottom-right"
        aria-label="Show controls"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={revealControls}
      />

      <div className="center-identity" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`identity-pill ${debugPersonId !== undefined ? "debugging" : ""}`}
          aria-label="Switch active profile"
          aria-expanded={personMenuOpen}
          onClick={() => setPersonMenuOpen((open) => !open)}
        >
          <Home size={18} />
          <span>{activePerson?.displayName ?? "Home"}</span>
          {debugPersonId !== undefined ? (
            <span className="identity-debug-dot" title="Debug override active" />
          ) : null}
        </button>
        {personMenuOpen ? (
          <div className="person-menu" role="menu">
            <div className="person-menu-label">View as (debug)</div>
            <button
              type="button"
              role="menuitem"
              className={`person-menu-item ${debugPersonId === undefined ? "active" : ""}`}
              onClick={() => {
                setDebugPersonId(undefined);
                setPersonMenuOpen(false);
              }}
            >
              Live (face recognition)
            </button>
            <button
              type="button"
              role="menuitem"
              className={`person-menu-item ${debugPersonId === null ? "active" : ""}`}
              onClick={() => {
                setDebugPersonId(null);
                setPersonMenuOpen(false);
              }}
            >
              Home (no person)
            </button>
            {effectiveConfig.people.map((person) => (
              <button
                key={person.id}
                type="button"
                role="menuitem"
                className={`person-menu-item ${debugPersonId === person.id ? "active" : ""}`}
                onClick={() => {
                  setDebugPersonId(person.id);
                  setPersonMenuOpen(false);
                }}
              >
                {person.displayName}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="person-menu-item subtle"
              onClick={() => {
                toggleStatus();
                setPersonMenuOpen(false);
              }}
            >
              {statusVisible ? "Hide status" : "Show status"}
            </button>
          </div>
        ) : null}
        <div className={`status-pill ${statusVisible ? "visible" : ""}`}>
          <span title={`Camera: ${cameraStatus}`}>
            <Video size={16} />
            {cameraStatus}
          </span>
          <span title={`Face recognition: ${faceRecognition.status}`}>
            <ScanFace size={16} />
            {faceStatusText}
          </span>
          <span title={`Recognition input: ${faceRecognition.activeSource}`}>
            <ScanFace size={16} />
            {faceRecognition.activeSource === "native-infrared"
              ? "IR"
              : faceRecognition.activeSource === "native-color"
                ? "bridge"
                : faceRecognition.activeSource === "browser-color"
                  ? "RGB"
                  : "—"}
          </span>
          <span title={nativeBridge.error ?? `Native bridge: ${nativeBridge.status}`}>
            <Radio size={16} />
            {nativeBridge.status}
          </span>
          <span title={haError ?? "Home Assistant event bridge"}>
            <span
              className={`status-dot ${
                homeAssistant.status === "ok" || haStatus === "ok"
                  ? "ok"
                  : homeAssistant.status === "error" || haStatus === "error"
                    ? "error"
                    : ""
              }`}
            />
            HA
          </span>
        </div>
      </div>

      <div
        className={`control-dock ${controlsVisible ? "visible" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dock-group">
          <button
            type="button"
            title="Photos"
            aria-label="Photos"
            onClick={(event) => {
              event.stopPropagation();
              stayOnPhotosUntilRef.current = Date.now() + 90000;
              returnToPhotos("button");
            }}
          >
            <Images size={18} />
          </button>
          <button
            type="button"
            title="Dashboard"
            aria-label="Dashboard"
            onClick={(event) => {
              event.stopPropagation();
              enterDashboard("button", activePerson);
            }}
          >
            <Home size={18} />
          </button>
          <button
            type="button"
            title="Enroll face"
            aria-label="Enroll face"
            onClick={(event) => {
              event.stopPropagation();
              setShowEnrollment(true);
            }}
          >
            <UserPlus size={18} />
          </button>
          <button
            type="button"
            title="Test recognition"
            aria-label="Test recognition"
            onClick={(event) => {
              event.stopPropagation();
              setShowTestPanel(true);
            }}
          >
            <ScanFace size={18} />
          </button>
          <button
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={(event) => {
              event.stopPropagation();
              openSettings();
            }}
          >
            <Settings size={18} />
          </button>
          <button
            type="button"
            title={isKiosk ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isKiosk ? "Exit fullscreen" : "Fullscreen"}
            onClick={(event) => {
              event.stopPropagation();
              const next = !isKiosk;
              setIsKiosk(next);
              void window.surfaceKiosk?.setKioskMode(next);
            }}
          >
            {isKiosk ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            type="button"
            title="Reload"
            aria-label="Reload"
            onClick={(event) => {
              event.stopPropagation();
              if (window.surfaceKiosk) void window.surfaceKiosk.reload();
              else window.location.reload();
            }}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="dock-group profile-dock">
          <span className="profile-dock-label">View as</span>
          <button
            type="button"
            title="Live (face recognition)"
            className={`profile-chip ${debugPersonId === undefined ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              setDebugPersonId(undefined);
            }}
          >
            <ScanFace size={14} />
            <span>Live</span>
          </button>
          <button
            type="button"
            title="Home (no person)"
            className={`profile-chip ${debugPersonId === null ? "active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              setDebugPersonId(null);
            }}
          >
            <Home size={14} />
            <span>Home</span>
          </button>
          {effectiveConfig.people.map((person) => (
            <button
              key={person.id}
              type="button"
              title={`View as ${person.displayName}`}
              className={`profile-chip ${debugPersonId === person.id ? "active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setDebugPersonId(person.id);
              }}
            >
              <span>{person.displayName.split(" ")[0] || person.displayName}</span>
            </button>
          ))}
        </div>
      </div>

      {cameraAlert ? (
        <CameraAlertOverlay
          alert={cameraAlert}
          config={effectiveConfig}
          onClose={closeCameraAlert}
          onCallService={callService}
        />
      ) : null}

      <div
        className={`screen-power-overlay screen-power-${screenPowerMode}`}
        style={{
          opacity:
            screenPowerMode === "blackout"
              ? 1
              : screenPowerMode === "dim"
                ? effectiveConfig.screenPower.dimOpacity
                : 0,
        }}
      />

      {setupNeeded ? (
        <aside
          className="setup-strip"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setShowSetup(true)}
        >
          <Settings size={16} />
          <span>
            {homeAssistantSetupNeeded
              ? "Home Assistant needs a URL and token."
              : "Camera or recognition is turned off."}
          </span>
        </aside>
      ) : null}

      {guidedStartNeeded && !showSetup && !showEnrollment && !showTestPanel ? (
        <aside
          className="guided-start"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div>
            <span className="eyebrow">Guided setup</span>
            <h2>
              {homeAssistantSetupNeeded
                ? "Connect Home Assistant"
                : "Enroll the first face"}
            </h2>
            <p>
              {homeAssistantSetupNeeded
                ? "Add the dashboard URL and a long-lived token, then test the connection."
                : "Use the live preview to capture three angles and create the local face embedding."}
            </p>
          </div>
          <div className="guided-actions">
            <button type="button" onClick={() => setShowSetup(true)}>
              <Settings size={18} />
              <strong>Home Assistant</strong>
              <span>{homeAssistantConfigured ? "Ready" : "Needs setup"}</span>
            </button>
            <button type="button" onClick={() => setShowEnrollment(true)}>
              <UserPlus size={18} />
              <strong>Register face</strong>
              <span>
                {faceEnrollmentNeeded
                  ? "No samples yet"
                  : `${effectiveConfig.people.length} enrolled`}
              </span>
            </button>
            <button type="button" onClick={() => setShowTestPanel(true)}>
              <ScanFace size={18} />
              <strong>Test</strong>
              <span>{faceStatusText}</span>
            </button>
          </div>
        </aside>
      ) : null}

      {showSetup ? (
        <div className="settings-stage" onPointerDown={(event) => event.stopPropagation()}>
          <SettingsView
            config={config}
            states={homeAssistant.states}
            people={effectiveConfig.people}
            onEditProfile={(personId) => {
              setShowSetup(false);
              setUserSettingsPersonId(personId);
            }}
            onClose={() => setShowSetup(false)}
            onSaved={(saved) => {
              setConfig(saved);
            }}
          />
        </div>
      ) : null}

      {userSettingsPerson ? (
        <div className="settings-stage" onPointerDown={(event) => event.stopPropagation()}>
          <UserSettingsView
            config={config}
            states={homeAssistant.states}
            person={userSettingsPerson}
            editingAsAdmin={
              isAdminPerson(activePerson) && userSettingsPerson.id !== activePerson?.id
            }
            onClose={() => setUserSettingsPersonId(null)}
            onSaved={(saved) => setConfig(saved)}
          />
        </div>
      ) : null}

      {showEnrollment ? (
        <EnrollmentPanel
          config={effectiveConfig}
          stream={cameraStream}
          video={videoRef.current}
          bridgeFrameDataUrl={nativeBridge.frame?.dataUrl}
          bridgeSourceKind={nativeBridge.frame?.sourceKind}
          onClose={() => setShowEnrollment(false)}
          onSaved={(people) => setEnrolledPeople(people)}
        />
      ) : null}

      {showTestPanel ? (
        <aside
          className="test-panel"
          aria-label="Recognition test"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="panel-header">
            <div>
              <span className="eyebrow">Recognition test</span>
              <h2>{faceRecognition.person?.displayName ?? "No match yet"}</h2>
            </div>
            <button
              type="button"
              aria-label="Close recognition test"
              onClick={() => setShowTestPanel(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="test-grid">
            <span>Camera</span>
            <strong>{cameraStatus}</strong>
            <span>Bridge</span>
            <strong>{nativeBridge.status}</strong>
            <span>Source</span>
            <strong>{faceRecognition.activeSource}</strong>
            <span>Face</span>
            <strong>{faceRecognition.status}</strong>
            <span>Models</span>
            <strong>{modelTestMessage ?? modelTestStatus}</strong>
            <span>Match</span>
            <strong>{faceRecognition.face?.confidenceLabel ?? "none"}</strong>
          </div>
          <div className="panel-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={modelTestStatus === "testing"}
              onClick={runModelTest}
            >
              <ScanFace size={18} />
              <span>{modelTestStatus === "testing" ? "Testing" : "Test models"}</span>
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setShowEnrollment(true)}
            >
              <UserPlus size={18} />
              <span>Enroll</span>
            </button>
            <button
              type="button"
              className="save-action"
              disabled={!testPerson}
              onClick={runRecognitionTest}
            >
              <ScanFace size={18} />
              <span>Test welcome</span>
            </button>
          </div>
        </aside>
      ) : null}

      {config.debug ? (
        <aside className="debug-panel">
          <span>motion {motion.score.toFixed(3)}</span>
          <span>face {faceRecognition.face?.confidenceLabel ?? "none"}</span>
          <span>screen {screenPowerMode}</span>
        </aside>
      ) : null}
    </main>
  );
}
