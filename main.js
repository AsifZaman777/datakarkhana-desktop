/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Main process entry point and top-level lifecycle orchestrator.
 *   - Configures Chromium flags prior to application ready state.
 *   - Registers IPC listeners across main and renderer contexts.
 *   - Orchestrates multi-stage boot sequence in initApp() with splash progress:
 *       1. Python engine preparation & dependency setup
 *       2. Backend process spawn and HTTP health readiness verification
 *       3. Frontend target resolution (local dev vs cloud Vercel fallback)
 *       4. Main window presentation and auto-updater initialization
 *   - Hooks into Electron lifecycle events (whenReady, before-quit, will-quit,
 *     window-all-closed, activate) and terminates all child processes cleanly.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Decomposed monolithic 1,230+ line main.js into modular services
 *                 under src/ (config, logger, updater, splash, mainWindow,
 *                 backend, frontend, ipc). Transformed main.js into a clean orchestrator.
 * ============================================================================
 */

const { app, BrowserWindow, dialog, shell } = require("electron");
const { applyChromeCommandLineSwitches } = require("./src/config");
const { getLogFilePath } = require("./src/logger");
const { setupAutoUpdater } = require("./src/updater");
const {
  createSplashWindow,
  updateSplashStatus,
  updateSplashStep,
  getSplashWindow,
} = require("./src/splash");
const { createMainWindow, getMainWindow } = require("./src/mainWindow");
const {
  checkBackendHealth,
  startPythonBackend,
  cleanupBackendProcess,
  getPythonProcess,
  getLastBackendStderrLines,
} = require("./src/backend");
const {
  cleanupFrontendProcess,
  resolveFrontendTarget,
} = require("./src/frontend");
const { registerIpcHandlers } = require("./src/ipc");

// Apply required Chromium flags before app ready
applyChromeCommandLineSwitches();

// Register all IPC listeners
registerIpcHandlers();

function cleanupChildProcesses() {
  cleanupBackendProcess();
  cleanupFrontendProcess();
}

async function initApp() {
  const appDataDir = app.getPath("userData");
  createSplashWindow();

  try {
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
      let backendTerminated = false;
      const logFilePath = getLogFilePath(appDataDir);

      while (Date.now() - backendStart < 45000) {
        await new Promise((r) => setTimeout(r, 800));
        isBackendHealthy = await checkBackendHealth();
        if (isBackendHealthy) break;

        // Check if Python process died unexpectedly
        if (!getPythonProcess()) {
          backendTerminated = true;
          break;
        }

        const elapsed = Math.round((Date.now() - backendStart) / 1000);
        updateSplashStep("backend", "active", `Waiting for API server... (${elapsed}s)`);
        updateSplashStatus(`Starting local backend engine... (${elapsed}s)`);
      }

      if (isBackendHealthy) {
        updateSplashStep("backend", "done", "API server is healthy ✓");
      } else {
        updateSplashStep(
          "backend",
          "error",
          backendTerminated ? "Backend process exited with error" : "Backend did not respond in time"
        );
        const lastErrors = getLastBackendStderrLines();
        const recentErrors =
          lastErrors.length > 0
            ? lastErrors.slice(-6).join("\n")
            : "Python backend process terminated unexpectedly before port 8000 opened.";

        const res = dialog.showMessageBoxSync(getSplashWindow() || getMainWindow(), {
          type: "error",
          title: "Backend Server Startup Error",
          message: "The local backend server failed to initialize.",
          detail: `${recentErrors}\n\nFull log file saved at:\n${logFilePath}`,
          buttons: ["Open Backend Log", "Exit"],
          defaultId: 0,
        });

        if (res === 0) {
          shell.openPath(logFilePath);
        }
        return;
      }
    } else {
      // Backend was already running
      updateSplashStep("python", "done", "Python engine already running");
      updateSplashStep("backend", "done", "API server already healthy ✓");
    }

    updateSplashStatus("Backend ready ✓  Launching application...");

    // ── Step 3: Frontend UI ───────────────────────────────
    updateSplashStep("frontend", "active", "Detecting frontend UI...");
    updateSplashStatus("Connecting to frontend UI...");

    await resolveFrontendTarget({ updateSplashStep, updateSplashStatus });

    // ── Step 4: Launch ────────────────────────────────────
    updateSplashStep("launch", "active", "Opening application window...");
    updateSplashStatus("Launching application window...");

    // Small delay to ensure Next.js is fully hydrated
    await new Promise((r) => setTimeout(r, 500));

    updateSplashStep("launch", "done", "All systems go!");
    await new Promise((r) => setTimeout(r, 300));

    createMainWindow({
      onShow: (win) => {
        setupAutoUpdater(() => win);
      },
    });
  } catch (err) {
    console.error("[ELECTRON] Fatal error during initApp:", err);
    updateSplashStatus(`Startup error: ${err.message}`);
    updateSplashStep("launch", "error", err.message);
    dialog.showErrorBox(
      "Application Startup Error",
      `An unexpected error occurred during application initialization:\n\n${err.stack || err.message}`
    );
  }
}

// ── Lifecycle & Clean Process Termination ─────────────────────────────────

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
    createMainWindow({
      onShow: (win) => {
        setupAutoUpdater(() => win);
      },
    });
  }
});
