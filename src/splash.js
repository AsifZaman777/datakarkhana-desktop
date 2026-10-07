/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Startup splash screen window and checklist progress presentation.
 *   - Creates and displays a transparent, frameless BrowserWindow during boot.
 *   - Hosts the dark-themed HTML/CSS checklist UI (Python, Backend, UI, Launch).
 *   - Provides safe JavaScript injection methods to update progress text and
 *     step icons/states (pending, active, done, error).
 *   - Handles graceful closing and reference cleanup when mainWindow is ready.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to separate
 *                 embedded splash markup, styles, and progress state logic.
 * ============================================================================
 */

const { app, BrowserWindow } = require("electron");
const { ICON_PATH } = require("./config");

let splashWindow = null;

function createSplashWindow() {
  const appVersion = app.getVersion();

  splashWindow = new BrowserWindow({
    width: 480,
    height: 430,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#070b14",
    icon: ICON_PATH,
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
        .title-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        h1 {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: 0.6px;
          color: #f8fafc;
        }
        .version-badge {
          display: inline-flex;
          align-items: center;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 6px;
          background: rgba(6,182,212,0.18);
          color: #38bdf8;
          border: 1px solid rgba(6,182,212,0.35);
          letter-spacing: 0.5px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .subtitle {
          font-size: 10px;
          color: #64748b;
          margin-top: 4px;
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
      <div class="title-row">
        <h1>DATAKARKHANA DESKTOP</h1>
        <span class="version-badge">v${appVersion}</span>
      </div>
      <div class="subtitle">Local Automation &amp; Lead Generation Engine • Release v${appVersion}</div>

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
  return splashWindow;
}

function updateSplashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents
      .executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(text)};`)
      .catch(() => {});
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

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function getSplashWindow() {
  return splashWindow;
}

module.exports = {
  createSplashWindow,
  updateSplashStatus,
  updateSplashStep,
  closeSplashWindow,
  getSplashWindow,
};
