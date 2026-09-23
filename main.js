const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const http = require("http");
const { ensureBackendEnvironment } = require("./setup-dependencies");
const { autoUpdater } = require("electron-updater");

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.log("[AUTO-UPDATER] Check error (ignored):", err.message);
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[AUTO-UPDATER] Update available: v${info.version}`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[AUTO-UPDATER] Update downloaded: v${info.version}`);
  });
}

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

// Disable hardware acceleration issues & allow communication with local 127.0.0.1 backend
app.commandLine.appendSwitch("disable-site-isolation-trials");
app.commandLine.appendSwitch("allow-running-insecure-content");
app.commandLine.appendSwitch("disable-features", "BlockInsecurePrivateNetworkRequests");
app.commandLine.appendSwitch("disable-web-security");

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

let lastBackendStderrLines = [];

async function startPythonBackend(onStatus) {
  // Check if backend is already running and healthy
  const alreadyHealthy = await checkBackendHealth();
  if (alreadyHealthy) {
    console.log(`[ELECTRON] Backend is already running and healthy on port ${BACKEND_PORT}`);
    if (onStatus) onStatus("Local backend engine active ✓", 100);
    return true;
  }

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

  lastBackendStderrLines = [];
  const logFile = path.join(appDataDir, "backend.log");
  let logStream = null;
  try {
    logStream = fs.createWriteStream(logFile, { flags: "a" });
  } catch {
    // Ignore log stream error
  }

  const isBinary = backendEnv.type === "binary";
  const spawnCmd = backendEnv.command;
  const spawnArgs = isBinary
    ? ["--port", String(BACKEND_PORT)]
    : ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)];

  try {
    // ── macOS PATH fix ──────────────────────────────────────────────────────
    // Electron GUI apps on macOS inherit a stripped PATH (/usr/bin:/bin) that
    // resolves to Apple's old system Python 3.9 stub, NOT the user's installed
    // Python 3.13 (Homebrew, python.org, pyenv, etc.) which has uvicorn/fastapi.
    // We explicitly prepend all known macOS Python binary directories so the
    // correct interpreter is found before the system stub.
    const macExtraPaths = process.platform !== "win32" ? [
      "/opt/homebrew/bin",                                        // Homebrew (Apple Silicon)
      "/usr/local/bin",                                           // Homebrew (Intel) / python.org
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",  // python.org 3.13
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",  // python.org 3.12
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",  // python.org 3.11
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",  // python.org 3.10
      path.join(process.env.HOME || "", ".pyenv", "shims"),      // pyenv shims
      path.join(process.env.HOME || "", ".pyenv", "bin"),        // pyenv
      path.join(process.env.HOME || "", ".local", "bin"),        // pip --user installs
    ] : [];
    const augmentedPath = [...macExtraPaths, process.env.PATH || ""].join(":");

    console.log(`[ELECTRON] Launching backend: ${spawnCmd} ${spawnArgs.join(" ")} (cwd: ${backendDir})`);
    console.log(`[ELECTRON] Effective PATH: ${augmentedPath.substring(0, 200)}...`);
    pythonProcess = spawn(spawnCmd, spawnArgs, {
      cwd: backendDir,
      env: {
        ...process.env,
        PATH: augmentedPath,
        PYTHONUNBUFFERED: "1",
        DATAKARKHANA_DATA_DIR: appDataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false, // CRITICAL: false prevents Windows cmd.exe from breaking paths with spaces
    });
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
    const text = data.toString();
    console.log(`[BACKEND STDOUT] ${text.trim()}`);
    if (logStream) logStream.write(text);
  });

  pythonProcess.stderr.on("data", (data) => {
    const text = data.toString();
    console.error(`[BACKEND STDERR] ${text.trim()}`);
    if (logStream) logStream.write(text);
    lastBackendStderrLines.push(text.trim());
    if (lastBackendStderrLines.length > 20) lastBackendStderrLines.shift();
  });

  pythonProcess.on("close", (code) => {
    console.log(`[ELECTRON] Python backend process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      console.error("[ELECTRON] Last backend error messages:", lastBackendStderrLines.join("\n"));
    }
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
    width: 460,
    height: 420,
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
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background: #070b14;
          color: #f8fafc;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 24px 48px rgba(0,0,0,0.7);
          overflow: hidden;
          user-select: none;
          padding: 32px 36px;
          gap: 0;
        }
        .logo-box {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 28px rgba(6,182,212,0.45);
          margin-bottom: 14px;
        }
        .logo-box svg { width: 30px; height: 30px; fill: #fff; }
        h1 {
          font-size: 17px;
          font-weight: 800;
          letter-spacing: 0.6px;
          color: #f8fafc;
        }
        .subtitle {
          font-size: 10px;
          color: #64748b;
          margin-top: 3px;
          letter-spacing: 0.3px;
        }
        /* ── Checklist ── */
        .checklist {
          width: 100%;
          margin-top: 22px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .step {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(255,255,255,0.035);
          border: 1px solid rgba(255,255,255,0.06);
          transition: background 0.3s, border-color 0.3s;
        }
        .step.active {
          background: rgba(6,182,212,0.08);
          border-color: rgba(6,182,212,0.25);
        }
        .step.done {
          background: rgba(16,185,129,0.07);
          border-color: rgba(16,185,129,0.2);
        }
        .step.error {
          background: rgba(239,68,68,0.07);
          border-color: rgba(239,68,68,0.25);
        }
        .icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 13px;
          transition: background 0.3s;
        }
        .icon-pending  { background: rgba(255,255,255,0.06); }
        .icon-active   { background: rgba(6,182,212,0.18); }
        .icon-done     { background: rgba(16,185,129,0.2); }
        .icon-error    { background: rgba(239,68,68,0.2); }
        /* Spinner ring */
        .spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(6,182,212,0.25);
          border-top-color: #06b6d4;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        /* Dot for pending */
        .dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #334155;
        }
        /* Check mark */
        .checkmark { color: #10b981; font-size: 14px; line-height: 1; }
        /* Cross mark */
        .crossmark { color: #ef4444; font-size: 14px; line-height: 1; }
        .step-info { flex: 1; min-width: 0; }
        .step-label {
          font-size: 11.5px;
          font-weight: 600;
          color: #cbd5e1;
          transition: color 0.3s;
        }
        .step.active .step-label { color: #e2e8f0; }
        .step.done   .step-label { color: #86efac; }
        .step.error  .step-label { color: #fca5a5; }
        .step-detail {
          font-size: 10px;
          color: #475569;
          margin-top: 2px;
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: color 0.3s;
        }
        .step.active .step-detail { color: #38bdf8; }
        .step.done   .step-detail { color: #4ade80; }
        .step.error  .step-detail { color: #f87171; }
        /* Bottom bar */
        .bottom {
          margin-top: 20px;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .loader-bar {
          width: 100%;
          height: 2px;
          background: rgba(255,255,255,0.07);
          border-radius: 999px;
          overflow: hidden;
          position: relative;
        }
        .loader-bar::after {
          content: '';
          position: absolute;
          top: 0; left: 0;
          height: 100%;
          width: 35%;
          background: linear-gradient(90deg, #06b6d4, #3b82f6);
          border-radius: 999px;
          animation: slide 1.1s infinite ease-in-out;
        }
        @keyframes slide { 0% { left: -35%; } 100% { left: 100%; } }
        .status-text {
          font-size: 10px;
          color: #38bdf8;
          font-family: monospace;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="logo-box">
        <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <h1>DATAKARKHANA DESKTOP</h1>
      <div class="subtitle">Local Automation &amp; Lead Generation Engine</div>

      <div class="checklist">
        <div class="step" id="step-python">
          <div class="icon icon-pending" id="step-python-icon"><div class="dot"></div></div>
          <div class="step-info">
            <div class="step-label">Python Engine Setup</div>
            <div class="step-detail" id="step-python-detail">Waiting...</div>
          </div>
        </div>
        <div class="step" id="step-backend">
          <div class="icon icon-pending" id="step-backend-icon"><div class="dot"></div></div>
          <div class="step-info">
            <div class="step-label">Local Backend Server</div>
            <div class="step-detail" id="step-backend-detail">Waiting...</div>
          </div>
        </div>
        <div class="step" id="step-frontend">
          <div class="icon icon-pending" id="step-frontend-icon"><div class="dot"></div></div>
          <div class="step-info">
            <div class="step-label">Frontend UI</div>
            <div class="step-detail" id="step-frontend-detail">Waiting...</div>
          </div>
        </div>
        <div class="step" id="step-launch">
          <div class="icon icon-pending" id="step-launch-icon"><div class="dot"></div></div>
          <div class="step-info">
            <div class="step-label">Launching Application</div>
            <div class="step-detail" id="step-launch-detail">Waiting...</div>
          </div>
        </div>
      </div>

      <div class="bottom">
        <div class="loader-bar"></div>
        <div class="status-text" id="status">Starting up...</div>
      </div>

      <script>
        function setStep(id, state, detail) {
          const row  = document.getElementById('step-' + id);
          const icon = document.getElementById('step-' + id + '-icon');
          const det  = document.getElementById('step-' + id + '-detail');
          if (!row) return;
          row.className = 'step ' + state;
          if (detail !== undefined && det) det.textContent = detail;
          if (state === 'active') {
            icon.className = 'icon icon-active';
            icon.innerHTML = '<div class="spinner"></div>';
          } else if (state === 'done') {
            icon.className = 'icon icon-done';
            icon.innerHTML = '<span class="checkmark">✓</span>';
          } else if (state === 'error') {
            icon.className = 'icon icon-error';
            icon.innerHTML = '<span class="crossmark">✕</span>';
          } else {
            icon.className = 'icon icon-pending';
            icon.innerHTML = '<div class="dot"></div>';
          }
        }
      </script>
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

/**
 * Update a named checklist step on the splash screen.
 * @param {string} stepId   - One of: 'python' | 'backend' | 'frontend' | 'launch'
 * @param {'pending'|'active'|'done'|'error'} state
 * @param {string} [detail] - Short status text shown under the label
 */
function updateSplashStep(stepId, state, detail) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    const js = `typeof setStep === 'function' && setStep(${JSON.stringify(stepId)}, ${JSON.stringify(state)}, ${JSON.stringify(detail ?? null)});`;
    splashWindow.webContents.executeJavaScript(js).catch(() => {});
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
      webSecurity: false,
      allowRunningInsecureContent: true,
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
    setupAutoUpdater();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function initApp() {
  createSplashWindow();

  // Give the splash window a moment to fully render before we start updating it
  await new Promise((r) => setTimeout(r, 350));

  // ── Step 1: Python Engine Setup ─────────────────────────
  updateSplashStep("python", "active", "Checking Python & dependencies...");
  updateSplashStatus("Checking Python engine and dependencies...");

  let isBackendHealthy = await checkBackendHealth();
  if (!isBackendHealthy) {
    const started = await startPythonBackend((msg) => {
      updateSplashStatus(msg);
      updateSplashStep("python", "active", msg);
    });
    if (started === false) {
      updateSplashStep("python", "error", "Failed to start Python engine");
      return;
    }
    updateSplashStep("python", "done", "Python engine ready");

    // ── Step 2: Wait for backend to become healthy ────────
    updateSplashStep("backend", "active", "Starting local API server...");
    updateSplashStatus("Starting local backend server...");

    const backendStart = Date.now();
    while (Date.now() - backendStart < 45000) {
      await new Promise((r) => setTimeout(r, 800));
      isBackendHealthy = await checkBackendHealth();
      if (isBackendHealthy) break;
      const elapsed = Math.round((Date.now() - backendStart) / 1000);
      updateSplashStep("backend", "active", `Waiting for API server... (${elapsed}s)`);
      updateSplashStatus(`Starting local backend engine... (${elapsed}s)`);
    }

    if (isBackendHealthy) {
      updateSplashStep("backend", "done", "API server is healthy ✓");
    } else {
      updateSplashStep("backend", "error", "Backend did not respond in time");
    }
  } else {
    // Backend was already running
    updateSplashStep("python", "done", "Python engine already running");
    updateSplashStep("backend", "done", "API server already healthy ✓");
  }

  updateSplashStatus("Backend ready ✓  Launching application...");

  // ── Step 3: Frontend UI ───────────────────────────────
  if (!app.isPackaged) {
    updateSplashStep("frontend", "active", "Checking Next.js dev server...");
    let isFrontendReady = await checkFrontendReady();
    if (!isFrontendReady) {
      startFrontendDevServer();
      updateSplashStep("frontend", "active", "Compiling frontend UI...");
      updateSplashStatus("Starting Frontend UI...");

      const frontendStart = Date.now();
      while (Date.now() - frontendStart < 60000) {
        await new Promise((r) => setTimeout(r, 1000));
        isFrontendReady = await checkFrontendReady();
        if (isFrontendReady) {
          updateSplashStep("frontend", "done", "Frontend UI ready ✓");
          updateSplashStatus("Frontend ready ✓  Launching app...");
          break;
        }
        const elapsed = Math.round((Date.now() - frontendStart) / 1000);
        updateSplashStep("frontend", "active", `Compiling... (${elapsed}s)`);
        updateSplashStatus(`Starting Frontend UI... (${elapsed}s)`);
      }
    } else {
      updateSplashStep("frontend", "done", "Frontend UI already running ✓");
    }
  } else {
    updateSplashStep("frontend", "done", "Cloud frontend active ✓");
    updateSplashStatus("Launching DataKarkhana Engine...");
  }

  // ── Step 4: Launch ────────────────────────────────────
  updateSplashStep("launch", "active", "Opening application window...");
  updateSplashStatus("Launching application window...");

  // Small delay to ensure Next.js is fully hydrated
  await new Promise((r) => setTimeout(r, 500));

  updateSplashStep("launch", "done", "All systems go!");
  await new Promise((r) => setTimeout(r, 300));

  createMainWindow();
}

// ── IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.handle("app:version", () => app.getVersion());

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

/**
 * Polls /api/health every 2 s until it responds or maxWaitMs elapses.
 * Returns true if the server came up, false on timeout.
 */
async function waitForBackendReady(maxWaitMs = 40000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const healthy = await checkBackendHealth();
    if (healthy) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

ipcMain.handle("backend:restart", async () => {
  console.log("[ELECTRON] Manual backend restart triggered — killing orphan on port", BACKEND_PORT);
  // Kill any existing managed process first
  if (pythonProcess) {
    try { pythonProcess.kill("SIGKILL"); } catch { /* ignore */ }
    pythonProcess = null;
    await new Promise((r) => setTimeout(r, 800)); // let OS reclaim the port
  }
  killOrphanOnPort(BACKEND_PORT);
  await new Promise((r) => setTimeout(r, 500)); // small settle delay

  const spawned = await startPythonBackend();
  if (!spawned) return { success: false, reason: "spawn_failed" };

  // Wait until the server is actually accepting HTTP requests
  const ready = await waitForBackendReady(40000);
  console.log(`[ELECTRON] Backend restart ${ready ? "succeeded" : "timed out (40 s)"}`);
  return { success: ready };
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
