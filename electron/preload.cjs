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
  getHomeAssistantStates: () => ipcRenderer.invoke("ha:get-states"),
  getCalendar: (entityId, start, end) =>
    ipcRenderer.invoke("ha:get-calendar", entityId, start, end),
  deleteCalendarEvent: (entityId, uid, recurrenceId, recurrenceRange) =>
    ipcRenderer.invoke("ha:calendar-delete", entityId, uid, recurrenceId, recurrenceRange),
  getHomeAssistantState: (entityId) => ipcRenderer.invoke("ha:get-state", entityId),
  getHomeAssistantCameraSnapshot: (entityId) =>
    ipcRenderer.invoke("ha:get-camera-snapshot", entityId),
  estimateTravel: (destText) => ipcRenderer.invoke("travel:estimate", destText),
  listTodo: (entityId) => ipcRenderer.invoke("ha:todo-list", entityId),
  getIcloudAlbumPhotos: (albumUrl) => ipcRenderer.invoke("photos:icloud-album", albumUrl),
  remindersItems: () => ipcRenderer.invoke("reminders:items"),
  remindersAdd: (title) => ipcRenderer.invoke("reminders:add", title),
  remindersComplete: (id) => ipcRenderer.invoke("reminders:complete", id),
  remindersUncomplete: (id) => ipcRenderer.invoke("reminders:uncomplete", id),
  remindersDelete: (id) => ipcRenderer.invoke("reminders:delete", id),
  remindersHealth: () => ipcRenderer.invoke("reminders:health"),
  remindersTest: (url, token, list) => ipcRenderer.invoke("reminders:test", url, token, list),
  setKioskMode: (enabled) => ipcRenderer.invoke("window:kiosk", enabled),
  setDisplayPower: (enabled) => ipcRenderer.invoke("window:display-power", enabled),
  reload: () => ipcRenderer.invoke("window:reload"),
});
