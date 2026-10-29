const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");

test("Preload script context bridge surface and structure", () => {
  const preloadPath = path.resolve(__dirname, "..", "preload.js");
  assert.ok(fs.existsSync(preloadPath), "preload.js must exist");

  const content = fs.readFileSync(preloadPath, "utf8");
  
  // Verify contextBridge exposeInMainWorld calls
  assert.ok(content.includes("contextBridge.exposeInMainWorld"), "Should expose API securely via contextBridge");
  assert.ok(content.includes("electronAPI"), "Window API namespace must be 'electronAPI'");
  
  // Verify expected API methods exposed to renderer
  const expectedMethods = [
    "isElectron",
    "getAppVersion",
    "checkForUpdates",
    "getLicenseStatus",
    "activateLicense",
    "getBackendStatus",
    "restartBackend",
    "quitApp",
    "setZoomFactor",
    "getZoomFactor"
  ];

  for (const method of expectedMethods) {
    assert.ok(content.includes(method), `preload.js must expose ${method}`);
  }
});

test("Packaged vs Dev resource filtering and build targets in package.json", () => {
  const pkgPath = path.resolve(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.equal(pkg.name, "datakhuji");
  assert.ok(pkg.version, "Version must be specified");
  assert.equal(pkg.main, "main.js", "Entry point must be main.js");
  assert.ok(pkg.build, "electron-builder configuration must exist");
  assert.equal(pkg.build.appId, "com.datakarkhana.desktop");
  assert.ok(Array.isArray(pkg.build.extraResources), "extraResources must be configured for bundled backend");
});

