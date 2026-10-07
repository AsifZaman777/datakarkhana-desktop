/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Application auto-update lifecycle management via electron-updater.
 *   - Runs periodic background checks against GitHub releases.
 *   - Emits IPC update status events to mainWindow webContents.
 *   - Updates window download progress bar during update transfers.
 *   - Displays native dialogs notifying users of new releases and restart options.
 *   - Handles manual update check requests triggered by IPC.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to isolate update
 *                 polling, download event handlers, and update alert dialogs.
 * ============================================================================
 */

const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

/**
 * Sets up background auto-update watchers and dialog notifications.
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 */
function setupAutoUpdater(getMainWindow) {
  if (!app.isPackaged) {
    console.log("[AUTO-UPDATER] Development mode detected — auto-updates disabled.");
    return;
  }

  console.log(`[AUTO-UPDATER] Initializing update watcher for DataKarkhana Desktop v${app.getVersion()}...`);

  // Check on startup after 4 seconds
  setTimeout(() => {
    console.log("[AUTO-UPDATER] Performing initial check for GitHub releases...");
    autoUpdater.checkForUpdates().catch((err) => {
      console.log("[AUTO-UPDATER] Startup update check error (safe to ignore):", err.message);
    });
  }, 4000);

  // Periodic background check every 2 hours
  setInterval(() => {
    console.log("[AUTO-UPDATER] Performing periodic check for GitHub releases...");
    autoUpdater.checkForUpdates().catch((err) => {
      console.log("[AUTO-UPDATER] Periodic update check error (safe to ignore):", err.message);
    });
  }, 2 * 60 * 60 * 1000);

  autoUpdater.on("checking-for-update", () => {
    console.log("[AUTO-UPDATER] Checking GitHub releases repository for new updates...");
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:update-checking");
    }
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[AUTO-UPDATER] New update available: v${info.version}`);
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:update-available", info);
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Update Available — DataKarkhana Desktop",
        message: `A new version (v${info.version}) of DataKarkhana Desktop is available!`,
        detail: `Current version: v${app.getVersion()}\nLatest version: v${info.version}\n\nThe update is downloading automatically in the background. You can continue using DataKarkhana uninterrupted. Once the download finishes, you will be prompted to restart and apply it.`,
        buttons: ["OK, Download in Background"],
        defaultId: 0,
      });
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log(`[AUTO-UPDATER] Application is up to date (current version: v${app.getVersion()})`);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent || 0);
    const speed = Math.round((progressObj.bytesPerSecond || 0) / 1024);
    console.log(`[AUTO-UPDATER] Downloading update: ${percent}% (${speed} KB/s)`);
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progressObj.percent / 100);
      mainWindow.webContents.send("app:update-download-progress", progressObj);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[AUTO-UPDATER] Update downloaded successfully: v${info.version}`);
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send("app:update-downloaded", info);

      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "Update Ready to Install",
          message: `DataKarkhana Desktop v${info.version} is ready to install!`,
          detail:
            "The new update has been downloaded. Would you like to restart DataKarkhana now to apply it immediately, or install it automatically when you close the app?",
          buttons: ["Restart & Install Now", "Install Later (On Exit)"],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            // Restart immediately and apply update
            setImmediate(() => autoUpdater.quitAndInstall(false, true));
          }
        });
    }
  });

  autoUpdater.on("error", (err) => {
    console.log("[AUTO-UPDATER] Update error:", err == null ? "unknown" : (err.stack || err).toString());
    const mainWindow = getMainWindow ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
  });
}

/**
 * Manual update check invoked via IPC.
 */
async function checkForUpdatesDirectly() {
  if (!app.isPackaged) {
    return { status: "dev", message: "Auto-updater is disabled in development mode." };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    return {
      status: "ok",
      currentVersion: app.getVersion(),
      updateAvailable: Boolean(res && res.updateInfo && res.updateInfo.version !== app.getVersion()),
      version: res?.updateInfo?.version,
      releaseNotes: res?.updateInfo?.releaseNotes,
    };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

module.exports = {
  autoUpdater,
  setupAutoUpdater,
  checkForUpdatesDirectly,
};
