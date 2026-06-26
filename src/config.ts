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
  // Admins (Quinn) can edit system-wide settings and every profile's settings.
  // Non-admins can only edit their own profile preferences.
  isAdmin?: boolean;
};

// Per-profile theme. Only the accent (and optionally the display font) change; the
// accent drives the whole UI tint (chrome + background) via CSS custom properties.
export type ProfileTheme = {
  accent?: string;
  fontDisplay?: string;
};

// Settings that belong to a single person, not the device. Each user customises
// their own dashboard; shared/system settings (photos, dimming, HA, lock screen)
// live on the top-level config and are admin-only.
export type ProfilePreferences = {
  theme?: ProfileTheme;
  // Calendars this person's in-dashboard calendar view shows. Empty/undefined =
  // all discovered calendars. (The lock-screen agenda is always the shared set.)
  calendarEntityIds?: string[];
  // Dashboard section keys this person has hidden (see DASHBOARD_SECTIONS).
  hiddenSections?: string[];
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
    // How one photo gives way to the next.
    transition?: "crossfade" | "cut";
    // Play the album in random order (reshuffled each loop) rather than in order.
    shuffle?: boolean;
    // Optional iCloud shared-album link; its photos are pulled in automatically
    // and shown alongside (or instead of) the local `photos`.
    icloudSharedAlbumUrl?: string;
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
    // When set, recognition runs on a remote service (e.g. a Mac mini) instead of
    // on the Surface GPU. The kiosk relays frames and uses the returned matches.
    remoteUrl?: string;
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
  calendar: {
    enabled: boolean;
    entityId: string;
    // Per-calendar colour overrides (entity_id -> hex). Calendars without an
    // override get a stable colour from the default palette.
    colors?: Record<string, string>;
    // Calendars the user has toggled off (entity_id list). Hidden calendars are
    // still discovered but not fetched/shown until re-enabled.
    hidden?: string[];
  };
  // Travel-time estimates for events that have a location. The token lives only
  // in the on-device config and is used from the main process, never the bundle.
  travel: {
    provider: "none" | "mapbox";
    mapboxToken?: string;
    // Trip origin. If set, this address is geocoded and used as the start point;
    // otherwise the HA zone's lat/long is used.
    originAddress?: string;
    // HA zone whose lat/long is the trip origin (fallback when no originAddress).
    homeZoneEntityId: string;
    // Show a "leave by"/"leave now" nudge this many minutes before departure.
    leaveBufferMinutes: number;
  };
  weather: {
    enabled: boolean;
    entityId: string;
  };
  // The grocery view. Two backends: a Home Assistant todo entity, OR a native
  // Apple Reminders list via the Mac "reminders bridge" (a small service on a Mac
  // on the LAN that uses EventKit — the only way to read AND add to an iCloud
  // *shared* list, which CalDAV/CloudKit-web cannot do). When `bridgeUrl` is set
  // it takes precedence over `entityId`. The token lives on-device only.
  grocery: {
    enabled: boolean;
    entityId: string;
    bridgeUrl?: string;
    bridgeToken?: string;
    bridgeList?: string;
  };
  people: PersonProfile[];
  // Per-person preferences keyed by person id. Separate from `people` so it merges
  // cleanly with face-enrollment data and survives re-enrollment.
  profilePrefs?: Record<string, ProfilePreferences>;
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
    transition: "crossfade",
    shuffle: true,
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
    remoteUrl: "ws://192.168.1.100:8770",
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
  calendar: {
    enabled: true,
    entityId: "calendar.family_calendar",
  },
  travel: {
    provider: "none",
    homeZoneEntityId: "zone.home",
    leaveBufferMinutes: 30,
  },
  weather: {
    enabled: true,
    entityId: "weather.home",
  },
  grocery: {
    enabled: true,
    entityId: "todo.shopping_list",
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
    } else if (value !== undefined && value !== null) {
      // Treat null like "unset" so a saved null doesn't clobber a numeric default
      // (e.g. photosAfterNoFaceMs/faceResetMs), which breaks timeout comparisons.
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

// ---------------------------------------------------------------------------
// Per-user settings, theming, and access control
// ---------------------------------------------------------------------------

// Dashboard sections a user can individually hide. The key is what's stored in
// ProfilePreferences.hiddenSections and checked by the dashboard at render time.
export const DASHBOARD_SECTIONS: { key: string; label: string }[] = [
  { key: "rooms", label: "Rooms" },
  { key: "media", label: "Media" },
  { key: "agenda", label: "Today / Agenda" },
  { key: "cameras", label: "Cameras" },
  { key: "climate", label: "Climate" },
  { key: "fans", label: "Fans" },
  { key: "weather", label: "Weather" },
  { key: "grocery", label: "Groceries" },
  { key: "calendar", label: "Calendar" },
];

// Default accents for the people who pre-date per-profile theming, keyed by first
// name. New/unknown people fall back to a stable hashed accent.
const BUILTIN_ACCENTS: Record<string, string> = {
  mark: "#5b9cf2",
  rachel: "#b47be6",
  nora: "#ff5fa2",
  quinn: "#f0b45c",
};

// Default amber from :root, used when there's no active person.
export const DEFAULT_ACCENT = "#f0b45c";

const ACCENT_CHOICES = [
  "#f0b45c", // amber
  "#5b9cf2", // blue
  "#b47be6", // purple
  "#ff5fa2", // pink
  "#5fd0a8", // teal
  "#f2785b", // coral
  "#7c8cf8", // indigo
  "#e0c050", // gold
];

export function isAdminPerson(person?: PersonProfile | null): boolean {
  if (!person) return false;
  if (person.isAdmin) return true;
  // Quinn is the device owner/admin even if the flag was never persisted.
  return /\bquinn\b/i.test(person.displayName);
}

export function getProfilePrefs(
  config: KioskConfig,
  personId?: string | null,
): ProfilePreferences {
  if (!personId) return {};
  return config.profilePrefs?.[personId] ?? {};
}

// Pure update: returns a new config with this person's prefs merged in.
export function setProfilePrefs(
  config: KioskConfig,
  personId: string,
  prefs: ProfilePreferences,
): KioskConfig {
  return {
    ...config,
    profilePrefs: {
      ...(config.profilePrefs ?? {}),
      [personId]: { ...(config.profilePrefs?.[personId] ?? {}), ...prefs },
    },
  };
}

function firstName(person: PersonProfile): string {
  return person.displayName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Resolve a person's accent: explicit theme override, then a built-in default by
// name, then a stable hashed colour so every new profile is themed automatically.
export function accentForPerson(config: KioskConfig, person: PersonProfile): string {
  const override = getProfilePrefs(config, person.id).theme?.accent;
  if (override) return override;
  const builtin = BUILTIN_ACCENTS[firstName(person)];
  if (builtin) return builtin;
  return ACCENT_CHOICES[hashString(person.id || person.displayName) % ACCENT_CHOICES.length];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace("#", "").trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) {
    return { r: 240, g: 180, b: 92 }; // amber fallback
  }
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function lightenHex(hex: string, amount = 0.25): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel: number) =>
    Math.round(channel + (255 - channel) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

// Derive the three CSS custom properties the UI reads off a single accent hex.
export function accentPalette(accent: string): {
  accent: string;
  accentHi: string;
  accentRgb: string;
} {
  const { r, g, b } = hexToRgb(accent);
  return { accent, accentHi: lightenHex(accent, 0.25), accentRgb: `${r}, ${g}, ${b}` };
}

export function dashboardUrlFor(config: KioskConfig, personId?: string | null) {
  const person = config.people.find((candidate) => candidate.id === personId);
  if (person?.dashboardUrl) return person.dashboardUrl;

  if (person?.dashboardPath) {
    return new URL(person.dashboardPath, config.homeAssistant.baseUrl).toString();
  }

  return config.homeAssistant.dashboardUrl;
}
