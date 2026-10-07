/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Subprocess lifecycle and health management for the local Python API backend.
 *   - Detects backend codebase directory across dev and packaged distributions.
 *   - Terminates orphaned processes occupying the backend port (8000).
 *   - Verifies Python standalone environment and dependencies via setup-dependencies.
 *   - Spawns backend process (FastAPI/Uvicorn or binary) with OS-tailored PATH.
 *   - Streams and logs stdout/stderr and buffers recent error output for crash reporting.
 *   - Performs HTTP health polling and manages on-demand backend restarts.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to encapsulate
 *                 backend process spawning, health verification, and error recovery.
 * ============================================================================
 */

const { app, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const http = require("http");
const { ensureBackendEnvironment } = require("../setup-dependencies");
const { BACKEND_PORT, BACKEND_HEALTH_URL, APP_ROOT } = require("./config");
const { getBackendLogStream, writeBackendLog, getDateTag } = require("./logger");

let pythonProcess = null;
let lastBackendStderrLines = [];

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

function killOrphanOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`).toString();
      const lines = out.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid) && Number(pid) > 0) {
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
    path.resolve(APP_ROOT, "..", "datakarkhana-backend"),
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
  return path.resolve(APP_ROOT, "..", "datakarkhana-backend");
}

async function startPythonBackend(onStatus) {
  // If WE already own a running backend process, skip re-spawning
  if (pythonProcess) {
    const alreadyHealthy = await checkBackendHealth();
    if (alreadyHealthy) {
      console.log(`[ELECTRON] Backend is already running and healthy on port ${BACKEND_PORT}`);
      if (onStatus) onStatus("Local backend engine active ✓", 100);
      return true;
    }
  }

  // Always kill any orphan from a previous session before starting fresh
  console.log(`[ELECTRON] Clearing port ${BACKEND_PORT} before startup...`);
  killOrphanOnPort(BACKEND_PORT);
  await new Promise((r) => setTimeout(r, 600)); // let OS release the port

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
  // Open (or rotate to) today's dated log file under <userData>/logs/
  getBackendLogStream(appDataDir);

  const isBinary = backendEnv.type === "binary";
  const spawnCmd = backendEnv.command;
  const spawnArgs = isBinary
    ? ["--port", String(BACKEND_PORT)]
    : ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)];

  try {
    // ── macOS PATH fix ──────────────────────────────────────────────────────
    const macExtraPaths =
      process.platform !== "win32"
        ? [
            "/opt/homebrew/bin", // Homebrew (Apple Silicon)
            "/usr/local/bin", // Homebrew (Intel) / python.org
            "/Library/Frameworks/Python.framework/Versions/3.13/bin", // python.org 3.13
            "/Library/Frameworks/Python.framework/Versions/3.12/bin", // python.org 3.12
            "/Library/Frameworks/Python.framework/Versions/3.11/bin", // python.org 3.11
            "/Library/Frameworks/Python.framework/Versions/3.10/bin", // python.org 3.10
            path.join(process.env.HOME || "", ".pyenv", "shims"), // pyenv shims
            path.join(process.env.HOME || "", ".pyenv", "bin"), // pyenv
            path.join(process.env.HOME || "", ".local", "bin"), // pip --user installs
          ]
        : [];
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
    writeBackendLog(appDataDir, "STDOUT", text);
  });

  pythonProcess.stderr.on("data", (data) => {
    const text = data.toString();
    console.error(`[BACKEND STDERR] ${text.trim()}`);
    writeBackendLog(appDataDir, "STDERR", text);
    lastBackendStderrLines.push(text.trim());
    if (lastBackendStderrLines.length > 20) lastBackendStderrLines.shift();
  });

  pythonProcess.on("close", (code) => {
    console.log(`[ELECTRON] Python backend process exited with code ${code}`);
    writeBackendLog(appDataDir, "ELECTRON", `Python backend process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      console.error("[ELECTRON] Last backend error messages:", lastBackendStderrLines.join("\n"));
    }
    pythonProcess = null;
  });

  return true;
}

async function restartBackendProcess() {
  console.log("[ELECTRON] Manual backend restart triggered — killing orphan on port", BACKEND_PORT);
  // Kill any existing managed process first
  if (pythonProcess) {
    try {
      pythonProcess.kill("SIGKILL");
    } catch {
      /* ignore */
    }
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
}

function cleanupBackendProcess() {
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
}

function getPythonProcess() {
  return pythonProcess;
}

function getLastBackendStderrLines() {
  return [...lastBackendStderrLines];
}

module.exports = {
  checkBackendHealth,
  waitForBackendReady,
  findPythonCommand,
  killOrphanOnPort,
  getBackendDir,
  startPythonBackend,
  restartBackendProcess,
  cleanupBackendProcess,
  getPythonProcess,
  getLastBackendStderrLines,
};
