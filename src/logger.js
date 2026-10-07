/**
 * ============================================================================
 * RESPONSIBILITY:
 *   Logging subsystem for the local backend process.
 *   - Automatically creates and manages daily log files in <userData>/logs/.
 *   - Rotates active write streams automatically on calendar day rollover.
 *   - Formats timestamped entries with severity tags (STDOUT, STDERR, ELECTRON).
 *   - Appends session startup banners for each application execution.
 *
 * CHANGE HISTORY:
 *   - 2026-10-07: Extracted from monolithic main.js into src/ to isolate file
 *                 streaming, stream rotation, and backend logging utilities.
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

let _currentLogStream = null;
let _currentLogDate = null; // "YYYY-MM-DD" of the open stream

function _getDateTag() {
  return new Date().toISOString().slice(0, 10); // "2026-10-01"
}

function _getTimestamp() {
  return new Date().toISOString(); // "2026-10-01T18:05:23.456Z"
}

function getLogsDir(appDataDir) {
  return path.join(appDataDir, "logs");
}

function getLogFilePath(appDataDir, dateTag) {
  const date = dateTag || _getDateTag();
  return path.join(getLogsDir(appDataDir), `backend-${date}.log`);
}

/**
 * Returns a writable stream for today's backend log file.
 * Opens a new file whenever the calendar date changes (daily rotation).
 */
function getBackendLogStream(appDataDir) {
  const today = _getDateTag();

  // Rotate if the date has changed since we opened the stream
  if (_currentLogStream && _currentLogDate !== today) {
    try {
      _currentLogStream.end();
    } catch {
      /* ignore */
    }
    _currentLogStream = null;
    _currentLogDate = null;
  }

  if (_currentLogStream) return _currentLogStream;

  try {
    const logsDir = getLogsDir(appDataDir);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const logFile = path.join(logsDir, `backend-${today}.log`);
    _currentLogStream = fs.createWriteStream(logFile, { flags: "a", encoding: "utf8" });
    _currentLogDate = today;

    // Write a session-start banner so each app launch is clearly visible in the file
    const banner = `\n${"-".repeat(80)}\n[${_getTimestamp()}] [SESSION START] DataKarkhana Desktop Backend\n${"-".repeat(80)}\n`;
    _currentLogStream.write(banner);
  } catch (err) {
    console.warn("[LOGGER] Could not open backend log file:", err.message);
    _currentLogStream = null;
  }

  return _currentLogStream;
}

/** Write a single log line with timestamp and level prefix. */
function writeBackendLog(appDataDir, level, text) {
  const stream = getBackendLogStream(appDataDir);
  if (!stream) return;
  const lines = text.replace(/\r/g, "").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    stream.write(`[${_getTimestamp()}] [${level}] ${line}\n`);
  }
}

module.exports = {
  getLogsDir,
  getLogFilePath,
  getBackendLogStream,
  writeBackendLog,
  getDateTag: _getDateTag,
  getTimestamp: _getTimestamp,
};
