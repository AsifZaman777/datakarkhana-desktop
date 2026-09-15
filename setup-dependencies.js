const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync, execFileSync } = require("child_process");

// URLs for official standalone portable Python distributions (astral-sh / python-build-standalone)
const PYTHON_STANDALONE_RELEASE = "20241016";
const PYTHON_VERSION = "3.11.10";
const PYTHON_DOWNLOAD_URLS = {
  "win32-x64": `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
  "darwin-arm64": `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-aarch64-apple-darwin-install_only.tar.gz`,
  "darwin-x64": `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-x86_64-apple-darwin-install_only.tar.gz`,
  "linux-x64": `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
};

/**
 * Returns candidate paths for bundled standalone backend executable.
 */
function findStandaloneBackendBinary(backendDir) {
  const binaryNames =
    process.platform === "win32"
      ? ["datakarkhana-backend.exe", "backend.exe", "main.exe"]
      : ["datakarkhana-backend", "backend", "main"];

  const candidateDirs = [
    backendDir,
    path.join(backendDir, "dist"),
    path.join(backendDir, "dist", "datakarkhana-backend"),
    path.join(backendDir, "build"),
    path.resolve(process.resourcesPath || "", "backend"),
    path.resolve(process.resourcesPath || "", "datakarkhana-backend"),
  ];

  for (const dir of candidateDirs) {
    for (const name of binaryNames) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) {
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch {
          return fullPath;
        }
      }
    }
  }
  return null;
}

/**
 * Returns the default directory where portable Python is stored.
 */
function getPortablePythonDir(appDataDir) {
  return path.join(appDataDir, "python-runtime");
}

/**
 * Returns the executable path inside the portable Python directory if installed.
 */
function getPortablePythonExe(appDataDir) {
  const runtimeDir = getPortablePythonDir(appDataDir);
  const candidates =
    process.platform === "win32"
      ? [
          path.join(runtimeDir, "python", "install", "python.exe"),
          path.join(runtimeDir, "python", "python.exe"),
          path.join(runtimeDir, "python.exe"),
          path.join(runtimeDir, "install", "python.exe"),
        ]
      : [
          path.join(runtimeDir, "python", "install", "bin", "python3"),
          path.join(runtimeDir, "python", "bin", "python3"),
          path.join(runtimeDir, "bin", "python3"),
        ];

  for (const exe of candidates) {
    if (fs.existsSync(exe)) {
      return exe;
    }
  }
  return null;
}

/**
 * Tests if a given python command/executable works.
 */
function testPythonExecutable(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans system for installed Python.
 */
function findSystemPython(backendDir, appDataDir) {
  // 1. Check local virtual environment in backend folder
  if (backendDir) {
    const venvCandidates =
      process.platform === "win32"
        ? [
            path.join(backendDir, "venv", "Scripts", "python.exe"),
            path.join(backendDir, ".venv", "Scripts", "python.exe"),
            path.join(backendDir, "env", "Scripts", "python.exe"),
          ]
        : [
            path.join(backendDir, "venv", "bin", "python3"),
            path.join(backendDir, ".venv", "bin", "python3"),
            path.join(backendDir, "env", "bin", "python3"),
          ];

    for (const venvExe of venvCandidates) {
      if (fs.existsSync(venvExe) && testPythonExecutable(venvExe)) {
        return venvExe;
      }
    }
  }

  // 2. Check portable runtime in user data
  if (appDataDir) {
    const portableExe = getPortablePythonExe(appDataDir);
    if (portableExe && testPythonExecutable(portableExe)) {
      return portableExe;
    }
  }

  // 3. Check Windows standard install locations
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const winCandidates = [
      "py",
      "python",
      "python3",
      path.join(localAppData, "Programs", "Python", "Python313", "python.exe"),
      path.join(localAppData, "Programs", "Python", "Python312", "python.exe"),
      path.join(localAppData, "Programs", "Python", "Python311", "python.exe"),
      path.join(localAppData, "Programs", "Python", "Python310", "python.exe"),
      path.join(programFiles, "Python313", "python.exe"),
      path.join(programFiles, "Python312", "python.exe"),
      path.join(programFiles, "Python311", "python.exe"),
      path.join(programFiles, "Python310", "python.exe"),
      path.join(programFilesX86, "Python311", "python.exe"),
    ];

    for (const cmd of winCandidates) {
      if (testPythonExecutable(cmd)) {
        return cmd;
      }
    }
  } else {
    // 4. Check macOS / Linux common paths
    // IMPORTANT: Check absolute paths BEFORE bare "python3" because on macOS,
    // Electron GUI apps inherit a stripped PATH that resolves "python3" to
    // Apple's system stub at /usr/bin/python3 (Python 3.9, no pip packages).
    // The user's real Python (with uvicorn/fastapi/selenium) is typically at
    // one of the absolute paths below.
    const home = process.env.HOME || "";
    const unixCandidates = [
      "/opt/homebrew/bin/python3",                                        // Homebrew (Apple Silicon M1/M2/M3)
      "/usr/local/bin/python3",                                           // Homebrew (Intel Mac) / python.org
      "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",  // python.org 3.13
      "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",  // python.org 3.12
      "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",  // python.org 3.11
      "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3",  // python.org 3.10
      "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
      path.join(home, ".pyenv", "shims", "python3"),                     // pyenv
      path.join(home, ".pyenv", "versions", "3.13.0", "bin", "python3"),
      path.join(home, ".pyenv", "versions", "3.12.0", "bin", "python3"),
      path.join(home, ".pyenv", "versions", "3.11.0", "bin", "python3"),
      path.join(home, ".local", "bin", "python3"),                       // pip --user
      "python3",                                                          // fallback (bare command, may hit system Python)
      "/usr/bin/python3",                                                 // Apple system Python 3.9 (last resort)
      "python",
    ];

    for (const cmd of unixCandidates) {
      if (testPythonExecutable(cmd)) {
        return cmd;
      }
    }
  }

  return null;
}

/**
 * Downloads a file with redirect support and progress reporting.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    function get(currentUrl) {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return get(res.headers.location);
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            return reject(new Error(`Failed to download (${res.statusCode}): ${url}`));
          }

          const total = parseInt(res.headers["content-length"] || "0", 10);
          let downloaded = 0;

          res.on("data", (chunk) => {
            downloaded += chunk.length;
            if (total && onProgress) {
              const pct = Math.round((downloaded / total) * 100);
              onProgress(pct, downloaded, total);
            }
          });

          res.pipe(file);

          file.on("finish", () => {
            file.close(resolve);
          });
        })
        .on("error", (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });
    }

    get(url);
  });
}

/**
 * Extracts a tar.gz file using built-in system tar.
 */
function extractArchive(archivePath, targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const isWin = process.platform === "win32";
  try {
    const cmd = `tar -xzf "${archivePath}" -C "${targetDir}"`;
    execSync(cmd, { stdio: "ignore", shell: isWin });
  } catch (err) {
    if (isWin) {
      // Fallback for Windows if system tar isn't in default PATH
      const sysTar = "C:\\Windows\\System32\\tar.exe";
      if (fs.existsSync(sysTar)) {
        execSync(`"${sysTar}" -xzf "${archivePath}" -C "${targetDir}"`, { stdio: "ignore", shell: true });
        return;
      }
    }
    throw new Error(`Failed to extract Python runtime archive: ${err.message}`);
  }
}

/**
 * Downloads and sets up portable Python if no Python is detected on customer PC.
 */
async function downloadPortablePython(appDataDir, onStatus) {
  const platformKey = `${process.platform}-${process.arch}`;
  const downloadUrl = PYTHON_DOWNLOAD_URLS[platformKey] || PYTHON_DOWNLOAD_URLS["win32-x64"];

  if (!downloadUrl) {
    throw new Error(`Automatic Python download not supported for architecture: ${platformKey}`);
  }

  const runtimeDir = getPortablePythonDir(appDataDir);
  const tempArchive = path.join(appDataDir, "python_standalone.tar.gz");

  if (onStatus) onStatus("Connecting to download portable Python runtime...", 5);

  await downloadFile(downloadUrl, tempArchive, (pct) => {
    if (onStatus) {
      onStatus(`Downloading standalone Python runtime... ${pct}%`, Math.min(85, Math.max(5, pct)));
    }
  });

  if (onStatus) onStatus("Extracting Python runtime environment...", 90);
  extractArchive(tempArchive, runtimeDir);

  try {
    fs.unlinkSync(tempArchive);
  } catch {
    // Ignore temp cleanup error
  }

  const pythonExe = getPortablePythonExe(appDataDir);
  if (!pythonExe || !testPythonExecutable(pythonExe)) {
    throw new Error("Portable Python extraction completed, but python executable could not be verified.");
  }

  if (onStatus) onStatus("Python engine successfully installed!", 100);
  return pythonExe;
}

/**
 * Checks if required packages (uvicorn, fastapi, selenium) are installed.
 */
function verifyBackendPackages(pythonCmd, backendDir) {
  try {
    execFileSync(pythonCmd, ["-c", "import uvicorn; import fastapi; import selenium"], {
      stdio: "ignore",
      cwd: backendDir,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs backend requirements via pip.
 */
function installBackendRequirements(pythonCmd, backendDir, onStatus) {
  const reqFile = path.join(backendDir, "requirements.txt");
  if (!fs.existsSync(reqFile)) {
    return;
  }

  if (onStatus) onStatus("Installing required backend dependencies (FastAPI, Selenium)...", 50);

  try {
    execFileSync(pythonCmd, ["-m", "pip", "install", "-r", reqFile, "--quiet", "--no-warn-script-location"], {
      cwd: backendDir,
      stdio: "ignore",
      timeout: 180000,
    });
  } catch (err) {
    console.warn("[DEPENDENCIES] Warning: pip install returned non-zero, continuing to attempt backend launch...", err);
  }
}

/**
 * Main entry: Ensures a functional Python runtime / backend binary is ready.
 */
async function ensureBackendEnvironment(options, onStatus) {
  const { backendDir, appDataDir } = options;

  // Ensure .env exists in backendDir from .env.example or local environment without baking secrets
  if (backendDir) {
    const envPath = path.join(backendDir, ".env");
    const examplePath = path.join(backendDir, ".env.example");
    if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
      try {
        fs.copyFileSync(examplePath, envPath);
        console.log(`[DEPENDENCIES] Initialized backend .env from template at ${envPath}`);
      } catch (e) {
        console.warn("[DEPENDENCIES] Could not copy .env template:", e);
      }
    }
  }

  // Step 1: Check for pre-compiled standalone binary
  const standaloneBinary = findStandaloneBackendBinary(backendDir);
  if (standaloneBinary) {
    console.log(`[DEPENDENCIES] Found bundled standalone backend binary: ${standaloneBinary}`);
    if (onStatus) onStatus("Standalone backend binary detected ✓", 100);
    return { type: "binary", command: standaloneBinary };
  }

  // Step 2: Check for existing Python (Venv, Portable, System)
  let pythonCmd = findSystemPython(backendDir, appDataDir);

  // Step 3: If no Python found, auto-download portable Python
  if (!pythonCmd) {
    console.log("[DEPENDENCIES] No Python installation found on system. Starting automatic download...");
    if (onStatus) onStatus("Python not detected. Setting up portable Python...", 0);
    pythonCmd = await downloadPortablePython(appDataDir, onStatus);
  }

  console.log(`[DEPENDENCIES] Using Python executable: ${pythonCmd}`);

  // Step 4: Verify packages, auto-install if missing
  const packagesReady = verifyBackendPackages(pythonCmd, backendDir);
  if (!packagesReady) {
    console.log("[DEPENDENCIES] Backend packages (FastAPI/Selenium) missing. Running pip install...");
    installBackendRequirements(pythonCmd, backendDir, onStatus);
  }

  return { type: "python", command: pythonCmd };
}

module.exports = {
  findStandaloneBackendBinary,
  getPortablePythonDir,
  getPortablePythonExe,
  testPythonExecutable,
  findSystemPython,
  downloadPortablePython,
  verifyBackendPackages,
  installBackendRequirements,
  ensureBackendEnvironment,
};
