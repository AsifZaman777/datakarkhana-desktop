const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  getLicenseStatus: () => ipcRenderer.invoke("license:status"),
  activateLicense: (key) => ipcRenderer.invoke("license:activate", key),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  restartBackend: () => ipcRenderer.invoke("backend:restart"),
  toggleDevTools: () => ipcRenderer.invoke("app:toggleDevTools"),
  openDevTools: () => ipcRenderer.invoke("app:openDevTools"),
  closeDevTools: () => ipcRenderer.invoke("app:closeDevTools"),
  isDevToolsOpened: () => ipcRenderer.invoke("app:isDevToolsOpened"),
  setDebugMode: (enabled) => ipcRenderer.invoke("app:setDebugMode", enabled),
  getDebugMode: () => ipcRenderer.invoke("app:getDebugMode"),
  onDevToolsChange: (callback) => {
    const handler = (_, isOpen) => callback(isOpen);
    ipcRenderer.on("devtools:state-changed", handler);
    return () => ipcRenderer.removeListener("devtools:state-changed", handler);
  },
  quitApp: () => ipcRenderer.send("app:quit")
});
