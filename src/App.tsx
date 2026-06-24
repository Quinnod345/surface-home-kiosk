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
  dashboardUrlFor,
  type DashboardMode,
  defaultConfig,
  loadKioskConfig,
  type KioskConfig,
  type PersonProfile,
} from "./config";
import { resolveKioskAssetUrl } from "./assetUrl";
import { EnrollmentPanel } from "./EnrollmentPanel";
import { SetupPanel } from "./SetupPanel";
import {
  loadEnrollments,
  mergePeople,
  type EnrolledPerson,
} from "./enrollmentStore";
import {
  fireKioskEvent,
  kioskPayload,
  setHomeAssistantText,
} from "./homeAssistant";
import { useCameraFeed } from "./useCameraFeed";
import { useFaceRecognition } from "./useFaceRecognition";
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
  const [haStatus, setHaStatus] = useState<"idle" | "ok" | "error">("idle");
  const [haError, setHaError] = useState<string | null>(null);
  const lastInteractionAtRef = useRef(Date.now());
  const lastGreetedRef = useRef<Record<string, number>>({});
  const lastOccupancyRef = useRef(false);

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
  const dashboardUrl = useMemo(
    () => dashboardUrlFor(effectiveConfig, activePersonId),
    [activePersonId, effectiveConfig],
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

  const enterDashboard = useCallback(
    (reason: string, person?: PersonProfile | null) => {
      lastInteractionAtRef.current = Date.now();
      if (person) setActivePersonId(person.id);
      setMode("dashboard");
      void sendEvent("dashboard_opened", {
        ...kioskPayload(effectiveConfig, "dashboard", person ?? activePerson),
        reason,
      });
    },
    [activePerson, effectiveConfig, sendEvent],
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
    if (mode === "idle" && effectiveConfig.behavior.openDashboardOnTap) {
      enterDashboard("touch", activePerson);
    }
  }, [
    activePerson,
    effectiveConfig.behavior.openDashboardOnTap,
    enterDashboard,
    mode,
  ]);

  useEffect(() => {
    loadKioskConfig()
      .then((loaded) => setConfig(loaded))
      .finally(() => setConfigLoaded(true));
    setEnrolledPeople(loadEnrollments().people);
  }, []);

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
      if (
        mode === "dashboard" &&
        effectiveConfig.behavior.returnToPhotosOnIdle &&
        Date.now() - lastInteractionAtRef.current >
          effectiveConfig.behavior.dashboardIdleTimeoutMs
      ) {
        returnToPhotos("idle-timeout");
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [
    effectiveConfig.behavior.dashboardIdleTimeoutMs,
    effectiveConfig.behavior.returnToPhotosOnIdle,
    mode,
    returnToPhotos,
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
    const person = faceRecognition.person;
    if (!person) return;

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

  const currentPhoto = photos[photoIndex % Math.max(1, photos.length)];
  const showFallbackPhoto = !currentPhoto;
  const setupNeeded =
    configLoaded &&
    (!config.homeAssistant.dashboardUrl ||
      !config.homeAssistant.accessToken ||
      config.homeAssistant.dashboardUrl.includes("homeassistant.local") ||
      !config.faceRecognition.enabled ||
      !config.camera.enabled);

  const testPerson = activePerson ?? effectiveConfig.people[0] ?? null;

  function runRecognitionTest() {
    if (!testPerson) return;
    setActivePersonId(testPerson.id);
    speak(personGreeting(testPerson));
    enterDashboard("recognition-test", testPerson);
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
        <iframe
          key={dashboardUrl}
          className="ha-frame"
          title="Home Assistant"
          src={dashboardUrl}
          allow="camera; microphone; fullscreen"
        />
      </section>

      <div className="top-rail">
        <div className="rail-group identity">
          <Home size={18} />
          <span>{activePerson?.displayName ?? "Home"}</span>
        </div>

        <div className="rail-group telemetry">
          <span title={`Camera: ${cameraStatus}`}>
            <Video size={16} />
            {cameraStatus}
          </span>
          <span title={`Face recognition: ${faceRecognition.status}`}>
            <ScanFace size={16} />
            {faceRecognition.status}
          </span>
          <span title={nativeBridge.error ?? `Native bridge: ${nativeBridge.status}`}>
            <Radio size={16} />
            {nativeBridge.status}
          </span>
          <span title={haError ?? "Home Assistant event bridge"}>
            <span className={`status-dot ${haStatus}`} />
            HA
          </span>
        </div>

        <div className="rail-group controls">
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

      {setupNeeded ? (
        <aside
          className="setup-strip"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setShowSetup(true)}
        >
          <Settings size={16} />
          <span>Setup needed: Home Assistant, camera, or recognition is incomplete.</span>
        </aside>
      ) : null}

      {showSetup ? (
        <SetupPanel
          config={config}
          onClose={() => setShowSetup(false)}
          onSaved={(saved) => {
            setConfig(saved);
            setShowSetup(false);
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
            <span>Match</span>
            <strong>{faceRecognition.face?.confidenceLabel ?? "none"}</strong>
          </div>
          <div className="panel-actions">
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
          <span>url {dashboardUrl}</span>
        </aside>
      ) : null}
    </main>
  );
}
