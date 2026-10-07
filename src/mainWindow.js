/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Primary application window lifecycle and security/navigation management.
 *   - Creates and configures the main Electron BrowserWindow with preload scripts.
 *   - Enforces window title formatting including current release version.
 *   - Guards against navigating to the root marketing page ('/'), routing to '/auth'.
 *   - Intercepts external URLs and redirects them to the OS default browser.
 *   - Coordinates the splash-to-main transition with safety timeouts.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to isolate window
 *                 creation parameters, web security preferences, and navigation guards.
 * ============================================================================
 */

const { app, BrowserWindow, shell } = require("electron");
const {
  ICON_PATH,
  PRELOAD_PATH,
  getFrontendBaseUrl,
  getFrontendAuthUrl,
} = require("./config");
const { closeSplashWindow } = require("./splash");

let mainWindow = null;

/**
 * Creates the primary application window.
 * @param {object} options
 * @param {Function} [options.onShow] - Callback when mainWindow becomes visible (e.g. initialize updater)
 */
function createMainWindow({ onShow } = {}) {
  const appVersion = app.getVersion();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: `DataKarkhana Desktop v${appVersion}`,
    backgroundColor: "#070b14",
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  // Ensure window title bar always prominently displays application name and release version
  mainWindow.on("page-title-updated", (event, title) => {
    event.preventDefault();
    const ver = app.getVersion();
    if (title && !title.includes(`v${ver}`)) {
      mainWindow.setTitle(`${title} — DataKarkhana Desktop v${ver}`);
    } else {
      mainWindow.setTitle(`DataKarkhana Desktop v${ver}`);
    }
  });

  const targetDevUrl = getFrontendAuthUrl();
  mainWindow.loadURL(targetDevUrl);

  // Prevent desktop application from opening or showing the marketing landing website page ('/')
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsedUrl = new URL(url);
      const baseUrlParsed = new URL(getFrontendBaseUrl());
      if (parsedUrl.origin === baseUrlParsed.origin) {
        if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
          event.preventDefault();
          mainWindow.loadURL(targetDevUrl);
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
  });

  // Open external links in user's default browser instead of inside Desktop Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      const baseUrlParsed = new URL(getFrontendBaseUrl());
      if (parsedUrl.origin !== baseUrlParsed.origin) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      // Ignore URL parsing errors
    }
    return { action: "allow" };
  });

  let splashClosed = false;
  function safeCloseSplash() {
    if (splashClosed) return;
    splashClosed = true;

    closeSplashWindow();

    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      if (typeof onShow === "function") {
        onShow(mainWindow);
      }
    }
  }

  // Safety fallback: ensure splash is never permanently stuck if network/rendering stalls
  const splashSafetyTimer = setTimeout(safeCloseSplash, 12000);

  mainWindow.once("ready-to-show", () => {
    clearTimeout(splashSafetyTimer);
    safeCloseSplash();
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[ELECTRON] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    clearTimeout(splashSafetyTimer);
    safeCloseSplash();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = {
  createMainWindow,
  getMainWindow,
};
