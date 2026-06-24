import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HomeAssistantConfig = {
  baseUrl?: string;
  accessToken?: string;
};

type KioskConfig = {
  homeAssistant?: HomeAssistantConfig;
  [key: string]: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let loadedConfig: KioskConfig = {};

function appRoot() {
  return path.resolve(__dirname, "..", "..");
}

function devServerUrl() {
  return process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
}

function userConfigPath() {
  return path.join(app.getPath("userData"), "kiosk-config.json");
}

function configCandidates() {
  const root = appRoot();
  return [
    userConfigPath(),
    path.join(root, "public", "kiosk-config.local.json"),
    path.join(root, "public", "kiosk-config.json"),
    path.join(root, "dist", "kiosk-config.json"),
    path.join(root, "public", "kiosk-config.example.json"),
  ];
}

async function readJsonIfPresent(filePath: string) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as KioskConfig;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    console.warn(`Could not read config at ${filePath}:`, error);
    return undefined;
  }
}

async function readConfig() {
  for (const candidate of configCandidates()) {
    const config = await readJsonIfPresent(candidate);
    if (config) {
      loadedConfig = config;
      return {
        ...config,
        runtime: {
          ...(typeof config.runtime === "object" ? config.runtime : {}),
          configPath: candidate,
          userConfigPath: userConfigPath(),
        },
      };
    }
  }

  loadedConfig = {};
  return {
    runtime: {
      configPath: null,
      userConfigPath: userConfigPath(),
    },
  };
}

function haConfig() {
  const homeAssistant = loadedConfig.homeAssistant ?? {};
  const baseUrl = homeAssistant.baseUrl?.replace(/\/$/, "");
  const accessToken = homeAssistant.accessToken;

  if (!baseUrl || !accessToken) {
    throw new Error("Home Assistant baseUrl/accessToken is not configured.");
  }

  return { baseUrl, accessToken };
}

async function postHomeAssistant(pathname: string, payload: unknown) {
  const { baseUrl, accessToken } = haConfig();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function createWindow() {
  const fullscreen = process.env.SURFACE_KIOSK === "1";

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0f1115",
    fullscreen,
    kiosk: fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    mainWindow.loadURL(devServerUrl());
  } else {
    mainWindow.loadFile(path.join(appRoot(), "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("config:read", readConfig);
  ipcMain.handle("ha:fire-event", async (_event, eventType: string, payload) =>
    postHomeAssistant(`/api/events/${encodeURIComponent(eventType)}`, payload),
  );
  ipcMain.handle(
    "ha:call-service",
    async (_event, domain: string, service: string, payload) =>
      postHomeAssistant(
        `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
        payload,
      ),
  );
  ipcMain.handle("window:kiosk", (_event, enabled: boolean) => {
    mainWindow?.setKiosk(enabled);
    mainWindow?.setFullScreen(enabled);
  });
  ipcMain.handle("window:reload", () => mainWindow?.webContents.reload());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
