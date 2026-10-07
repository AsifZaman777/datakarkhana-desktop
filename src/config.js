/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Centralized configuration management for the desktop application.
 *   - Defines network ports (backend: 8000, frontend: 3000) and service URLs.
 *   - Resolves filesystem paths for root assets (icons, preload scripts).
 *   - Manages dynamic frontend URL state (local vs cloud Vercel fallback).
 *   - Sets Chromium security and networking command-line switches.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to eliminate
 *                 hardcoded constants and decouple configuration from process
 *                 lifecycle management.
 * ============================================================================
 */

const { app } = require("electron");
const path = require("path");

const BACKEND_PORT = 8000;
const FRONTEND_PORT = 3000;
const CLOUD_FRONTEND_URL = "https://datakarkhana-frontend.vercel.app";
const LOCAL_FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/health`;

const APP_ROOT = path.resolve(__dirname, "..");
const ICON_PATH = path.join(APP_ROOT, "icon.png");
const PRELOAD_PATH = path.join(APP_ROOT, "preload.js");

let frontendBaseUrl = (
  process.env.FRONTEND_URL ||
  (app.isPackaged ? CLOUD_FRONTEND_URL : LOCAL_FRONTEND_URL)
).replace(/\/$/, "");

function getFrontendBaseUrl() {
  return frontendBaseUrl;
}

function setFrontendBaseUrl(url) {
  frontendBaseUrl = (url || "").replace(/\/$/, "");
}

function getFrontendAuthUrl() {
  return `${frontendBaseUrl}/auth`;
}

function getFrontendDevUrl() {
  return getFrontendAuthUrl();
}

/**
 * Configure Chromium command-line switches to allow local backend communication
 * and prevent site isolation / network blocks.
 */
function applyChromeCommandLineSwitches() {
  app.commandLine.appendSwitch("disable-site-isolation-trials");
  app.commandLine.appendSwitch("allow-running-insecure-content");
  app.commandLine.appendSwitch("disable-features", "BlockInsecurePrivateNetworkRequests");
  app.commandLine.appendSwitch("disable-web-security");
}

module.exports = {
  BACKEND_PORT,
  FRONTEND_PORT,
  CLOUD_FRONTEND_URL,
  LOCAL_FRONTEND_URL,
  BACKEND_HEALTH_URL,
  APP_ROOT,
  ICON_PATH,
  PRELOAD_PATH,
  getFrontendBaseUrl,
  setFrontendBaseUrl,
  getFrontendAuthUrl,
  getFrontendDevUrl,
  applyChromeCommandLineSwitches,
};
