/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Central registration and execution of Inter-Process Communication (IPC) channels.
 *   - App information and manual update triggers ('app:version', 'app:check-updates').
 *   - Backend status checks, manual restart requests, and log viewer folder opening.
 *   - License status validation and license key activation via HTTP bridge.
 *   - Graceful application quit handler ('app:quit').
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to consolidate all
 *                 IPC channels and decouple renderer-facing APIs from app bootstrapping.
 * ============================================================================
 */

const { app, ipcMain, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const { BACKEND_PORT, BACKEND_HEALTH_URL } = require("./config");
const { getLogsDir } = require("./logger");
const { checkForUpdatesDirectly } = require("./updater");
const { restartBackendProcess } = require("./backend");

/**
 * Register all IPC handlers and listeners for communication between renderer and main process.
 */
function registerIpcHandlers() {
  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle("app:check-updates", async () => {
    return checkForUpdatesDirectly();
  });

  ipcMain.handle("backend:status", async () => {
    return new Promise((resolve) => {
      const req = http.get(BACKEND_HEALTH_URL, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const isHealthy = res.statusCode === 200 && json.status === "healthy";
            const isDbOk = json.database === "ok" || (!json.database && isHealthy);
            resolve({
              healthy: isHealthy && isDbOk,
              backend: res.statusCode === 200,
              database: isDbOk,
              port: BACKEND_PORT,
              details: json,
            });
          } catch {
            resolve({
              healthy: res.statusCode === 200,
              backend: res.statusCode === 200,
              database: false,
              port: BACKEND_PORT,
            });
          }
        });
      });
      req.on("error", (err) => {
        resolve({ healthy: false, backend: false, database: false, port: BACKEND_PORT, error: err.message });
      });
      req.setTimeout(2500, () => {
        req.destroy();
        resolve({ healthy: false, backend: false, database: false, port: BACKEND_PORT, error: "timeout" });
      });
    });
  });

  ipcMain.handle("backend:restart", async () => {
    return restartBackendProcess();
  });

  ipcMain.handle("backend:open-logs", async () => {
    const appDataDir = app.getPath("userData");
    const logsDir = getLogsDir(appDataDir);
    try {
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      await shell.openPath(logsDir);
      return { success: true, path: logsDir };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("license:status", async () => {
    return new Promise((resolve) => {
      http
        .get(`http://127.0.0.1:${BACKEND_PORT}/api/license/status`, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ valid: false, status: "parse_error" });
            }
          });
        })
        .on("error", (err) => {
          resolve({ valid: false, status: "connection_error", message: err.message });
        });
    });
  });

  ipcMain.handle("license:activate", async (_, licenseKey) => {
    return new Promise((resolve) => {
      const postData = JSON.stringify({ license_key: licenseKey });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: BACKEND_PORT,
          path: "/api/license/activate",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ success: false, message: "Response parse error" });
            }
          });
        }
      );
      req.on("error", (err) => {
        resolve({ success: false, message: err.message });
      });
      req.write(postData);
      req.end();
    });
  });

  ipcMain.on("app:quit", () => {
    app.quit();
  });
}

module.exports = {
  registerIpcHandlers,
};
