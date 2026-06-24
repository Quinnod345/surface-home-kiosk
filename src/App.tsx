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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DashboardMode,
  defaultConfig,
  loadKioskConfig,
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
import { SetupPanel } from "./SetupPanel";
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

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  utterance.pitch = 1.02;
  window.speechSynthesis.speak(utterance);
}

function isImagePath(pathname: string) {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(pathname);
}

function personGreeting(person: PersonProfile) {
  return person.greeting ?? `Welcome, ${person.displayName}.`;
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
  const [photoIndex, setPhotoIndex] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [isKiosk, setIsKiosk] = useState(false);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
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
  const lastFaceSeenAtRef = useRef<number | null>(null);
  const lastGreetedRef = useRef<Record<string, number>>({});
  const lastOccupancyRef = useRef(false);
  const openedFirstRunRef = useRef(false);
  const controlsTimerRef = useRef<number | null>(null);
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
  const nativeBridge = useNativeBridgeFrames(effectiveConfig);
  const motion = useMotionPresence(
    videoRef,
    cameraStatus === "active",
    effectiveConfig.camera.motionSensitivity,
    effectiveConfig.camera.motionHoldMs,
  );
  const faceRecognition = useFaceRecognition(
    videoRef,
    effectiveConfig,
    cameraStatus === "active",
    nativeBridge.frame?.dataUrl,
  );

  const photos = useMemo(
    () => effectiveConfig.slideshow.photos.filter(isImagePath),
    [effectiveConfig.slideshow.photos],
  );
  const activePerson = useMemo(
    () =>
      effectiveConfig.people.find((person) => person.id === activePersonId) ?? null,
    [activePersonId, effectiveConfig.people],
  );
  const homeAssistantConfigured = useMemo(
    () => hasHomeAssistantConfig(effectiveConfig),
    [effectiveConfig],
  );
  const homeAssistant = useHomeAssistantStates(
    effectiveConfig,
    homeAssistantConfigured,
    5000,
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

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (photos.length <= 1) return;
    const interval = window.setInterval(() => {
      setPhotoIndex((index) => (index + 1) % photos.length);
    }, effectiveConfig.slideshow.intervalMs);
    return () => window.clearInterval(interval);
  }, [effectiveConfig.slideshow.intervalMs, photos.length]);

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
    if (faceRecognition.face) {
      lastFaceSeenAtRef.current = Date.now();
      wakeScreen();
    }
  }, [faceRecognition.face, wakeScreen]);

  useEffect(() => {
    const person = faceRecognition.person;
    if (!person) return;

    lastFaceSeenAtRef.current = Date.now();

    const lastGreetedAt = lastGreetedRef.current[person.id] ?? 0;
    if (Date.now() - lastGreetedAt > effectiveConfig.faceRecognition.greetCooldownMs) {
      lastGreetedRef.current[person.id] = Date.now();
      speak(personGreeting(person));
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
      effectiveConfig.faceRecognition.openDashboardOnRecognition ||
      (faceRecognition.face?.close &&
        effectiveConfig.behavior.openDashboardOnCloseFace)
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

  const currentPhoto = photos[photoIndex % Math.max(1, photos.length)];
  const showFallbackPhoto = !currentPhoto;
  const testPerson = activePerson ?? effectiveConfig.people[0] ?? null;

  function runRecognitionTest() {
    if (!testPerson) return;
    setActivePersonId(testPerson.id);
    speak(personGreeting(testPerson));
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
      onPointerDown={recordInteraction}
      onKeyDown={recordInteraction}
      tabIndex={0}
    >
      <video ref={videoRef} className="camera-probe" muted playsInline />

      <section className="idle-stage" aria-hidden={mode !== "idle"}>
        {showFallbackPhoto ? (
          <div className="photo-fallback" />
        ) : (
          <img
            className="idle-photo"
            src={resolveKioskAssetUrl(currentPhoto)}
            alt=""
            draggable={false}
          />
        )}
        <div className="idle-shade" />
        <div className="idle-clock">
          <span>{timeFormatter.format(clock)}</span>
          <small>{dateFormatter.format(clock)}</small>
        </div>
        <div className="idle-status">
          <span className={motion.occupied ? "status-dot live" : "status-dot"} />
          <span>{motion.occupied ? "Room active" : "Room quiet"}</span>
          {faceRecognition.person ? (
            <span>{faceRecognition.person.displayName}</span>
          ) : null}
        </div>
      </section>

      <section className="dashboard-stage" aria-hidden={mode !== "dashboard"}>
        {homeAssistantConfigured ? (
          <HomeCenterDashboard
            config={effectiveConfig}
            states={homeAssistant.states}
            status={homeAssistant.status}
            error={homeAssistant.error}
            activePerson={activePerson}
            onCallService={callService}
            onOpenCamera={openCameraAlert}
            onRefresh={() => void homeAssistant.refresh()}
          />
        ) : (
          <div className="dashboard-empty">
            <span className="eyebrow">Home Assistant</span>
            <h2>Connect your dashboard</h2>
            <button type="button" className="save-action" onClick={() => setShowSetup(true)}>
              <Settings size={18} />
              <span>Setup</span>
            </button>
          </div>
        )}
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
        <div className="identity-pill">
          <Home size={18} />
          <span>{activePerson?.displayName ?? "Home"}</span>
        </div>
        <div className="status-pill">
          <span title={`Camera: ${cameraStatus}`}>
            <Video size={16} />
            {cameraStatus}
          </span>
          <span title={`Face recognition: ${faceRecognition.status}`}>
            <ScanFace size={16} />
            {faceStatusText}
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
            title="Setup"
            aria-label="Setup"
            onClick={(event) => {
              event.stopPropagation();
              setShowSetup(true);
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
        <SetupPanel
          config={config}
          onClose={() => setShowSetup(false)}
          onSaved={(saved) => {
            setConfig(saved);
          }}
        />
      ) : null}

      {showEnrollment ? (
        <EnrollmentPanel
          config={effectiveConfig}
          stream={cameraStream}
          video={videoRef.current}
          bridgeFrameDataUrl={nativeBridge.frame?.dataUrl}
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
