import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type HomeAssistantConfig = {
  baseUrl?: string;
  accessToken?: string;
  dashboardUrl?: string;
  eventPrefix?: string;
};

type KioskConfig = {
  homeAssistant?: HomeAssistantConfig;
  [key: string]: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let loadedConfig: KioskConfig = {};

protocol.registerSchemesAsPrivileged([
  {
    scheme: "kiosk",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

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

async function writeConfig(_event: unknown, config: KioskConfig) {
  const nextConfig = {
    ...config,
    runtime: undefined,
  };
  await fs.mkdir(path.dirname(userConfigPath()), { recursive: true });
  await fs.writeFile(userConfigPath(), JSON.stringify(nextConfig, null, 2), "utf8");
  loadedConfig = nextConfig;
  return {
    ...nextConfig,
    runtime: {
      configPath: userConfigPath(),
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

function haConfigFrom(config: KioskConfig) {
  const homeAssistant = config.homeAssistant ?? {};
  const baseUrl = homeAssistant.baseUrl?.replace(/\/$/, "");
  const accessToken = homeAssistant.accessToken;

  if (!baseUrl || !accessToken) {
    throw new Error("Home Assistant URL/token is not configured.");
  }

  return { baseUrl, accessToken };
}

async function getHomeAssistant(config: KioskConfig) {
  const { baseUrl, accessToken } = haConfigFrom(config);
  const response = await fetch(`${baseUrl}/api/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const body = await response.text();
  return body ? JSON.parse(body) : { ok: true };
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

function distAssetPath(requestUrl: string) {
  const distRoot = path.join(appRoot(), "dist");
  const url = new URL(requestUrl);
  const requestPath =
    url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const filePath = path.normalize(path.join(distRoot, requestPath));
  const relativePath = path.relative(distRoot, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

function registerKioskProtocol() {
  protocol.handle("kiosk", (request) => {
    const filePath = distAssetPath(request.url);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const fullscreen = process.env.SURFACE_KIOSK === "1";
  const useDevServer =
    Boolean(process.env.VITE_DEV_SERVER_URL) ||
    (process.env.NODE_ENV !== "production" &&
      process.env.SURFACE_KIOSK !== "1" &&
      !app.isPackaged);

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

  if (useDevServer) {
    mainWindow.loadURL(devServerUrl());
  } else {
    mainWindow.loadURL("kiosk://app/index.html");
  }
}

app.whenReady().then(() => {
  registerKioskProtocol();

  ipcMain.handle("config:read", readConfig);
  ipcMain.handle("config:write", writeConfig);
  ipcMain.handle("ha:test", (_event, config: KioskConfig) =>
    getHomeAssistant(config),
  );
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
