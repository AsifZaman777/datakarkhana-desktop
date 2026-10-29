const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");

const config = require("../src/config");
const logger = require("../src/logger");
const setupDeps = require("../setup-dependencies");

test("Desktop Configuration Defaults and Constants", () => {
  assert.equal(config.BACKEND_PORT, 8000, "Backend port should be 8000");
  assert.equal(config.FRONTEND_PORT, 3000, "Frontend port should be 3000");
  assert.ok(config.CLOUD_FRONTEND_URL.startsWith("https://"), "Cloud frontend URL must be HTTPS");
  assert.equal(config.LOCAL_FRONTEND_URL, "http://localhost:3000", "Local frontend URL should point to port 3000");
  assert.equal(config.BACKEND_HEALTH_URL, "http://127.0.0.1:8000/api/health", "Backend health URL should point to port 8000 health endpoint");
  assert.ok(fs.existsSync(config.ICON_PATH), "icon.png should exist");
  assert.ok(fs.existsSync(config.PRELOAD_PATH), "preload.js should exist");
});

test("Dynamic Frontend Base URL updates", () => {
  const original = config.getFrontendBaseUrl();
  try {
    config.setFrontendBaseUrl("http://localhost:3000/");
    assert.equal(config.getFrontendBaseUrl(), "http://localhost:3000", "Trailing slash should be trimmed");
    assert.equal(config.getFrontendAuthUrl(), "http://localhost:3000/auth", "Auth URL should append /auth");
  } finally {
    config.setFrontendBaseUrl(original);
  }
});

test("Desktop Logger file path naming and directory generation", () => {
  const fakeUserData = path.join(__dirname, "mock_userData");
  const logsDir = logger.getLogsDir(fakeUserData);
  assert.equal(logsDir, path.join(fakeUserData, "logs"));

  const logFile = logger.getLogFilePath(fakeUserData, "2026-10-29");
  assert.equal(logFile, path.join(logsDir, "backend-2026-10-29.log"));
});

test("Python Standalone Dependency Helper Functions", () => {
  const fakeUserData = path.join(__dirname, "mock_userData");
  const portableDir = setupDeps.getPortablePythonDir(fakeUserData);
  assert.equal(portableDir, path.join(fakeUserData, "python-runtime"));

  // Check testPythonExecutable on standard known executables
  const pythonWorks = setupDeps.testPythonExecutable("python");
  assert.equal(typeof pythonWorks, "boolean");

  // Verify non-existent binary returns false rather than crashing
  const badExeWorks = setupDeps.testPythonExecutable("non_existent_binary_12345");
  assert.equal(badExeWorks, false);
});

