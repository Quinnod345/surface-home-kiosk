export type DashboardMode = "idle" | "dashboard";

export type CameraEntityBinding = {
  triggerEntityId: string;
  cameraEntityId: string;
};

export type ScreenPowerAction = "dim" | "photos" | "blackout";

export type ScreenPowerCondition = "never" | "quiet-hours" | "ambient-dark" | "either" | "both";

export type PersonProfile = {
  id: string;
  displayName: string;
  dashboardUrl?: string;
  dashboardPath?: string;
  referenceImageUrls?: string[];
  faceDescriptors?: number[][];
  greeting?: string;
};

export type KioskConfig = {
  deviceName: string;
  debug: boolean;
  homeAssistant: {
    baseUrl: string;
    dashboardUrl: string;
    accessToken?: string;
    eventPrefix: string;
    allowSelfSignedCertificate: boolean;
    occupancyEntityId?: string;
    activePersonEntityId?: string;
  };
  slideshow: {
    photos: string[];
    intervalMs: number;
  };
  camera: {
    enabled: boolean;
    width: number;
    height: number;
    motionSensitivity: number;
    motionHoldMs: number;
    closeFaceRatio: number;
  };
  faceRecognition: {
    enabled: boolean;
    modelUrl: string;
    matchThreshold: number;
    scanIntervalMs: number;
    openDashboardOnRecognition: boolean;
    greetCooldownMs: number;
  };
  nativeBridge: {
    enabled: boolean;
    url: string;
    preferredSourceKind: "Infrared" | "Color";
  };
  behavior: {
    dashboardIdleTimeoutMs: number;
    faceResetMs: number;
    photosAfterNoFaceMs: number;
    returnToPhotosOnIdle: boolean;
    openDashboardOnCloseFace: boolean;
    openDashboardOnTap: boolean;
  };
  screenPower: {
    enabled: boolean;
    dimAfterMs: number;
    dimOpacity: number;
    deepSleepAfterMs: number;
    deepSleepAction: ScreenPowerAction;
    deepSleepCondition: ScreenPowerCondition;
    quietHoursStart: string;
    quietHoursEnd: string;
    ambientLightEntityId?: string;
    ambientLightThresholdLux: number;
    useWindowsDisplayPower: boolean;
  };
  cameraOverlay: {
    enabled: boolean;
    triggerEntityIds: string[];
    cameraBindings: CameraEntityBinding[];
    defaultCameraEntityId?: string;
    talkEntityId?: string;
    dismissAfterMs: number;
    snapshotRefreshMs: number;
  };
  people: PersonProfile[];
  runtime?: {
    configPath?: string | null;
    statePath?: string;
    userConfigPath?: string;
  };
};

export const defaultConfig: KioskConfig = {
  deviceName: "surface-pro-3-kiosk",
  debug: false,
  homeAssistant: {
    baseUrl: "https://homeassistant.local",
    dashboardUrl: "https://homeassistant.local/lovelace/default_view?kiosk",
    eventPrefix: "surface_kiosk",
    allowSelfSignedCertificate: true,
  },
  slideshow: {
    photos: ["/photos/README.md"],
    intervalMs: 12000,
  },
  camera: {
    enabled: true,
    width: 640,
    height: 480,
    motionSensitivity: 0.075,
    motionHoldMs: 9000,
    closeFaceRatio: 0.34,
  },
  faceRecognition: {
    enabled: true,
    modelUrl: "/models",
    matchThreshold: 0.5,
    scanIntervalMs: 1400,
    openDashboardOnRecognition: true,
    greetCooldownMs: 180000,
  },
  nativeBridge: {
    enabled: true,
    url: "ws://127.0.0.1:8765/events",
    preferredSourceKind: "Infrared",
  },
  behavior: {
    dashboardIdleTimeoutMs: 90000,
    faceResetMs: 120000,
    photosAfterNoFaceMs: 30000,
    returnToPhotosOnIdle: true,
    openDashboardOnCloseFace: true,
    openDashboardOnTap: true,
  },
  screenPower: {
    enabled: true,
    dimAfterMs: 30000,
    dimOpacity: 0.5,
    deepSleepAfterMs: 120000,
    deepSleepAction: "photos",
    deepSleepCondition: "either",
    quietHoursStart: "22:30",
    quietHoursEnd: "06:30",
    ambientLightThresholdLux: 8,
    useWindowsDisplayPower: false,
  },
  cameraOverlay: {
    enabled: true,
    triggerEntityIds: [],
    cameraBindings: [],
    dismissAfterMs: 120000,
    snapshotRefreshMs: 2000,
  },
  people: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isObject(override)) return base;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged as T;
}

export function normalizeConfig(config: unknown): KioskConfig {
  return deepMerge(defaultConfig as unknown as Record<string, unknown>, config) as KioskConfig;
}

export async function loadKioskConfig(): Promise<KioskConfig> {
  if (window.surfaceKiosk) {
    return normalizeConfig(await window.surfaceKiosk.readConfig());
  }

  const localConfig = window.localStorage.getItem("surface-home-kiosk.config.v1");
  if (localConfig) {
    try {
      return normalizeConfig(JSON.parse(localConfig));
    } catch (error) {
      console.warn("Could not load locally saved kiosk config", error);
    }
  }

  try {
    const response = await fetch("/kiosk-config.json", { cache: "no-store" });
    if (response.ok) {
      return normalizeConfig(await response.json());
    }
  } catch (error) {
    console.warn("Could not load kiosk-config.json", error);
  }

  return defaultConfig;
}

export async function saveKioskConfig(config: KioskConfig): Promise<KioskConfig> {
  const normalized = normalizeConfig(config);

  if (window.surfaceKiosk) {
    return normalizeConfig(await window.surfaceKiosk.saveConfig(normalized));
  }

  if (window.location.protocol === "kiosk:" || window.location.protocol === "file:") {
    throw new Error("Desktop bridge unavailable. Reload the kiosk app and try again.");
  }

  window.localStorage.setItem(
    "surface-home-kiosk.config.v1",
    JSON.stringify(normalized),
  );
  return normalized;
}

export function dashboardUrlFor(config: KioskConfig, personId?: string | null) {
  const person = config.people.find((candidate) => candidate.id === personId);
  if (person?.dashboardUrl) return person.dashboardUrl;

  if (person?.dashboardPath) {
    return new URL(person.dashboardPath, config.homeAssistant.baseUrl).toString();
  }

  return config.homeAssistant.dashboardUrl;
}
