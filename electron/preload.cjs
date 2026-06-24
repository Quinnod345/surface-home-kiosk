const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("surfaceKiosk", {
  readConfig: () => ipcRenderer.invoke("config:read"),
  saveConfig: (config) => ipcRenderer.invoke("config:write", config),
  readEnrollments: () => ipcRenderer.invoke("enrollments:read"),
  writeEnrollments: (store) => ipcRenderer.invoke("enrollments:write", store),
  checkModels: () => ipcRenderer.invoke("models:check"),
  testHomeAssistant: (config) => ipcRenderer.invoke("ha:test", config),
  fireHomeAssistantEvent: (eventType, payload) =>
    ipcRenderer.invoke("ha:fire-event", eventType, payload),
  callHomeAssistantService: (domain, service, payload) =>
    ipcRenderer.invoke("ha:call-service", domain, service, payload),
  setKioskMode: (enabled) => ipcRenderer.invoke("window:kiosk", enabled),
  reload: () => ipcRenderer.invoke("window:reload"),
});
