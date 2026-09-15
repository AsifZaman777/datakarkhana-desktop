const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  getLicenseStatus: () => ipcRenderer.invoke("license:status"),
  activateLicense: (key) => ipcRenderer.invoke("license:activate", key),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  restartBackend: () => ipcRenderer.invoke("backend:restart"),
  quitApp: () => ipcRenderer.send("app:quit")
});
