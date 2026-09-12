const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const http = require("http");
const { ensureBackendEnvironment } = require("./setup-dependencies");

let mainWindow = null;
let splashWindow = null;
let pythonProcess = null;
let frontendProcess = null;
const BACKEND_PORT = 8000;
const FRONTEND_PORT = 3000;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
const FRONTEND_BASE_URL = (
  process.env.FRONTEND_URL ||
  (app.isPackaged ? "https://datakarkhana-frontend.vercel.app" : `http://localhost:${FRONTEND_PORT}`)
).replace(/\/$/, "");
const FRONTEND_AUTH_URL = `${FRONTEND_BASE_URL}/auth`;
const FRONTEND_DEV_URL = FRONTEND_AUTH_URL;

// Disable hardware acceleration issues on older GPUs if needed
app.commandLine.appendSwitch("disable-site-isolation-trials");

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(BACKEND_HEALTH_URL, (res) => {
      if (res.statusCode !== 200) {
        return resolve(false);
      }
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json.status === "healthy" && (!json.database || json.database === "ok"));
        } catch {
          resolve(true);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function checkFrontendReady() {
  return new Promise((resolve) => {
    const req = http.get(FRONTEND_BASE_URL, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findPythonCommand() {
  const candidates = ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return cmd;
    } catch {
      // Continue searching
    }
  }
  return "python3";
}

function findNpmCommand() {
  const candidates = ["npm"];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return cmd;
    } catch {
      // Continue searching
    }
  }
  return "npm";
}

function killOrphanOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`).toString();
      const lines = out.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid)) {
          execSync(`taskkill /pid ${pid} /F`);
        }
      }
    } else {
      const out = execSync(`lsof -t -i :${port}`).toString().trim();
      if (out) {
        const pids = out.split("\n").join(" ");
        execSync(`kill -9 ${pids}`);
      }
    }
  } catch {
    // Port is free or kill completed
  }
}

function getBackendDir() {
  const candidates = [
    path.join(process.resourcesPath || "", "datakarkhana-backend"),
    path.resolve(__dirname, "..", "datakarkhana-backend"),
    path.resolve(process.resourcesPath || "", "..", "datakarkhana-backend"),
    path.resolve(app.getAppPath(), "..", "datakarkhana-backend"),
    path.resolve(process.cwd(), "datakarkhana-backend"),
    path.resolve(process.cwd(), "..", "datakarkhana-backend"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "main.py"))) {
      return dir;
    }
  }
  return path.resolve(__dirname, "..", "datakarkhana-backend");
}

async function startPythonBackend(onStatus) {
  killOrphanOnPort(BACKEND_PORT);

  const backendDir = getBackendDir();
  const appDataDir = app.getPath("userData");

  let backendEnv;
  try {
    backendEnv = await ensureBackendEnvironment({ backendDir, appDataDir }, onStatus);
  } catch (err) {
    console.error("[ELECTRON] Failed to prepare backend environment:", err);
    if (onStatus) onStatus(`Setup error: ${err.message}`);
    dialog.showErrorBox(
      "DataKarkhana Backend Setup Error",
      `Could not initialize the standalone Python engine:\n\n${err.message}\n\nPlease check your internet connection or install Python 3.10+ manually.`
    );
    return false;
  }

  const isWin = process.platform === "win32";

  try {
    if (backendEnv.type === "binary") {
      console.log(`[ELECTRON] Launching standalone backend binary: ${backendEnv.command}`);
      pythonProcess = spawn(backendEnv.command, ["--port", String(BACKEND_PORT)], {
        cwd: backendDir,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: isWin,
      });
    } else {
      console.log(`[ELECTRON] Starting Python backend from ${backendDir} using ${backendEnv.command}...`);
      pythonProcess = spawn(
        backendEnv.command,
        ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
        {
          cwd: backendDir,
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: isWin,
        }
      );
    }
  } catch (err) {
    console.error("[ELECTRON] Synchronous spawn error:", err);
    dialog.showErrorBox("Backend Launch Error", `Failed to spawn backend process: ${err.message}`);
    return false;
  }

  pythonProcess.on("error", (err) => {
    console.error("[ELECTRON] Python backend process error:", err);
    if (onStatus) onStatus(`Backend error: ${err.message}`);
    dialog.showErrorBox(
      "Backend Startup Failed",
      `Python backend could not be started (${err.code || err.message}).\nCommand: ${backendEnv.command}\n\nPlease verify that security software has not blocked the Python executable.`
    );
    pythonProcess = null;
  });

  pythonProcess.stdout.on("data", (data) => {
    console.log(`[BACKEND STDOUT] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error(`[BACKEND STDERR] ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[ELECTRON] Python backend process exited with code ${code}`);
    pythonProcess = null;
  });

  return true;
}

function startFrontendDevServer() {
  const frontendDir = path.resolve(__dirname, "..", "datakarkhana-frontend");
  const npmCmd = findNpmCommand();

  console.log(`[ELECTRON] Starting Next.js frontend from ${frontendDir}...`);

  try {
    frontendProcess = spawn(npmCmd, ["run", "dev"], {
      cwd: frontendDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
    });
  } catch (err) {
    console.error("[ELECTRON] Synchronous frontend spawn error:", err);
    return;
  }

  frontendProcess.on("error", (err) => {
    console.error("[ELECTRON] Frontend dev server process error:", err);
    frontendProcess = null;
  });

  frontendProcess.stdout.on("data", (data) => {
    console.log(`[FRONTEND STDOUT] ${data.toString().trim()}`);
  });

  frontendProcess.stderr.on("data", (data) => {
    // Next.js logs warnings to stderr; don't treat as critical
    console.log(`[FRONTEND STDERR] ${data.toString().trim()}`);
  });

  frontendProcess.on("close", (code) => {
    console.log(`[ELECTRON] Frontend dev server exited with code ${code}`);
    frontendProcess = null;
  });
}

function createSplashWindow() {
  const appIcon = path.join(__dirname, "icon.png");

  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#070b14",
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const splashHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background: #070b14;
          color: #f8fafc;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
          overflow: hidden;
          user-select: none;
        }
        .logo-box {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 24px rgba(6, 182, 212, 0.4);
          margin-bottom: 20px;
        }
        .logo-box svg {
          width: 36px;
          height: 36px;
          fill: #ffffff;
        }
        h1 {
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .subtitle {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 4px;
          letter-spacing: 0.3px;
        }
        .status-text {
          font-size: 11px;
          color: #38bdf8;
          margin-top: 24px;
          font-family: monospace;
        }
        .loader-bar {
          width: 200px;
          height: 3px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
          margin-top: 12px;
          overflow: hidden;
          position: relative;
        }
        .loader-bar::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          width: 40%;
          background: linear-gradient(90deg, #06b6d4, #3b82f6);
          border-radius: 999px;
          animation: slide 1.2s infinite ease-in-out;
        }
        @keyframes slide {
          0% { left: -40%; }
          100% { left: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="logo-box">
        <svg viewBox="0 0 24 24">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      </div>
      <h1>DATAKARKHANA DESKTOP</h1>
      <div class="subtitle">Local Automation & Lead Generation Engine</div>
      <div class="status-text" id="status">Initializing Python Engine...</div>
      <div class="loader-bar"></div>
    </body>
    </html>
  `;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
}

function updateSplashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.executeJavaScript(
      `document.getElementById('status').textContent = ${JSON.stringify(text)};`
    ).catch(() => {});
  }
}

function createMainWindow() {
  const appIcon = path.join(__dirname, "icon.png");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: "DataKarkhana Desktop",
    backgroundColor: "#070b14",
    icon: appIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  mainWindow.loadURL(FRONTEND_DEV_URL);

  // Prevent desktop application from opening or showing the marketing landing website page ('/')
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsedUrl = new URL(url);
      const baseUrlParsed = new URL(FRONTEND_BASE_URL);
      if (parsedUrl.origin === baseUrlParsed.origin) {
        if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
          event.preventDefault();
          mainWindow.loadURL(FRONTEND_DEV_URL);
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  });

  // Open external links in user's default browser instead of inside Desktop Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      const baseUrlParsed = new URL(FRONTEND_BASE_URL);
      if (parsedUrl.origin !== baseUrlParsed.origin) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
    return { action: "allow" };
  });

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function initApp() {
  createSplashWindow();

  // ── Step 1: Start Python Backend ────────────────────────
  let isBackendHealthy = await checkBackendHealth();
  if (!isBackendHealthy) {
    updateSplashStatus("Checking Python engine and dependencies...");
    const started = await startPythonBackend((msg) => updateSplashStatus(msg));
    if (started === false) {
      return;
    }

    // Poll until healthy (up to 45 seconds)
    const backendStart = Date.now();
    while (Date.now() - backendStart < 45000) {
      await new Promise((r) => setTimeout(r, 800));
      isBackendHealthy = await checkBackendHealth();
      if (isBackendHealthy) break;
    }
  }
  updateSplashStatus("Backend ready ✓  Starting Frontend UI...");

  // ── Step 2: Start Frontend Dev Server (Development Only) ───
  if (!app.isPackaged) {
    let isFrontendReady = await checkFrontendReady();
    if (!isFrontendReady) {
      startFrontendDevServer();

      // Poll until frontend is ready (up to 60 seconds — Next.js can take a while on first compile)
      const frontendStart = Date.now();
      while (Date.now() - frontendStart < 60000) {
        await new Promise((r) => setTimeout(r, 1000));
        isFrontendReady = await checkFrontendReady();
        if (isFrontendReady) {
          updateSplashStatus("Frontend ready ✓  Launching app...");
          break;
        }
        // Update splash with elapsed time
        const elapsed = Math.round((Date.now() - frontendStart) / 1000);
        updateSplashStatus(`Starting Frontend UI... (${elapsed}s)`);
      }
    }
  } else {
    updateSplashStatus("Launching DataKarkhana Engine...");
  }

  // Small delay to ensure Next.js is fully hydrated
  await new Promise((r) => setTimeout(r, 500));

  createMainWindow();
}

// ── IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("backend:status", async () => {
  const healthy = await checkBackendHealth();
  return { healthy, port: BACKEND_PORT };
});

ipcMain.handle("license:status", async () => {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${BACKEND_PORT}/api/license/status`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ valid: false, status: "parse_error" });
        }
      });
    }).on("error", (err) => {
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

// ── Lifecycle & Clean Process Termination ─────────────────────────────────

function cleanupChildProcesses() {
  if (pythonProcess) {
    console.log("[ELECTRON] Terminating Python backend subprocess...");
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${pythonProcess.pid} /T /F`);
      } else {
        pythonProcess.kill("SIGTERM");
      }
    } catch {
      // Process might already be dead
    }
    pythonProcess = null;
  }

  if (frontendProcess) {
    console.log("[ELECTRON] Terminating Frontend dev server subprocess...");
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${frontendProcess.pid} /T /F`);
      } else {
        // Kill the process group (npm spawns child processes)
        try {
          process.kill(-frontendProcess.pid, "SIGTERM");
        } catch {
          frontendProcess.kill("SIGTERM");
        }
      }
    } catch {
      // Process might already be dead
    }
    frontendProcess = null;
  }
}

app.on("before-quit", cleanupChildProcesses);
app.on("will-quit", cleanupChildProcesses);

app.whenReady().then(initApp);

app.on("window-all-closed", () => {
  cleanupChildProcesses();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
