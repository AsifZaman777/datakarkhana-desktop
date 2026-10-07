/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Frontend UI resolution and Next.js dev server subprocess management.
 *   - Probes availability of frontend targets via HTTP/HTTPS.
 *   - Detects development mode vs packaged distribution.
 *   - Launches Next.js dev server (`npm run dev`) during local development.
 *   - Polls compilation readiness and updates splash screen status.
 *   - Gracefully terminates dev server processes and process groups on app exit.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to isolate frontend
 *                 URL probing, Next.js dev server lifecycle, and fallback mechanisms.
 * ============================================================================
 */

const { app } = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn, execSync } = require("child_process");
const {
  FRONTEND_PORT,
  LOCAL_FRONTEND_URL,
  CLOUD_FRONTEND_URL,
  APP_ROOT,
  getFrontendBaseUrl,
  setFrontendBaseUrl,
} = require("./config");

let frontendProcess = null;

function checkFrontendReady(targetUrl) {
  const urlToCheck = targetUrl || getFrontendBaseUrl();
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlToCheck);
      const client = parsed.protocol === "https:" ? https : http;
      const req = client.get(urlToCheck, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2500, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
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

function startFrontendDevServer() {
  const frontendDir = path.resolve(APP_ROOT, "..", "datakarkhana-frontend");
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

function cleanupFrontendProcess() {
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

/**
 * Resolves the frontend URL to connect to, starting local dev server if appropriate.
 * @param {object} callbacks - { updateSplashStep, updateSplashStatus }
 * @returns {Promise<string>} resolved URL
 */
async function resolveFrontendTarget({ updateSplashStep, updateSplashStatus }) {
  let resolvedFrontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : null;

  if (!resolvedFrontendUrl) {
    // 1. First probe if local Next.js frontend is already active on localhost:3000
    const isLocalRunning = await checkFrontendReady(LOCAL_FRONTEND_URL);

    if (isLocalRunning) {
      resolvedFrontendUrl = LOCAL_FRONTEND_URL;
      console.log(`[ELECTRON] Local frontend detected at ${LOCAL_FRONTEND_URL}`);
      if (updateSplashStep) updateSplashStep("frontend", "done", "Connected to local UI (localhost:3000) ✓");
    } else if (!app.isPackaged) {
      // 2. In unpackaged dev mode, start local dev server if not running
      if (updateSplashStep) updateSplashStep("frontend", "active", "Starting local Next.js dev server...");
      if (updateSplashStatus) updateSplashStatus("Starting Frontend UI...");
      startFrontendDevServer();

      const frontendStart = Date.now();
      let isReady = false;
      while (Date.now() - frontendStart < 60000) {
        await new Promise((r) => setTimeout(r, 1000));
        isReady = await checkFrontendReady(LOCAL_FRONTEND_URL);
        if (isReady) {
          if (updateSplashStep) updateSplashStep("frontend", "done", "Frontend UI ready ✓");
          if (updateSplashStatus) updateSplashStatus("Frontend ready ✓  Launching app...");
          break;
        }
        const elapsed = Math.round((Date.now() - frontendStart) / 1000);
        if (updateSplashStep) updateSplashStep("frontend", "active", `Compiling... (${elapsed}s)`);
        if (updateSplashStatus) updateSplashStatus(`Starting Frontend UI... (${elapsed}s)`);
      }
      resolvedFrontendUrl = LOCAL_FRONTEND_URL;
    } else {
      // 3. In packaged / win-unpacked mode: local server not active, fall back to cloud Vercel frontend
      console.log(`[ELECTRON] Local frontend not running on ${FRONTEND_PORT}, falling back to cloud: ${CLOUD_FRONTEND_URL}`);
      if (updateSplashStep) updateSplashStep("frontend", "active", "Connecting to cloud frontend...");
      const isCloudReady = await checkFrontendReady(CLOUD_FRONTEND_URL);
      resolvedFrontendUrl = CLOUD_FRONTEND_URL;
      if (updateSplashStep) updateSplashStep("frontend", "done", isCloudReady ? "Cloud frontend active ✓" : "Cloud frontend reachable ✓");
    }
  } else {
    if (updateSplashStep) updateSplashStep("frontend", "done", `Custom frontend (${resolvedFrontendUrl}) ✓`);
  }

  setFrontendBaseUrl(resolvedFrontendUrl);
  return resolvedFrontendUrl;
}

function getFrontendProcess() {
  return frontendProcess;
}

module.exports = {
  checkFrontendReady,
  findNpmCommand,
  startFrontendDevServer,
  cleanupFrontendProcess,
  resolveFrontendTarget,
  getFrontendProcess,
};
