# DataKarkhana Desktop — Cross-Platform Build & Auto-Release Guide
**Windows (`.exe`) & macOS (`.dmg`) Automated Publishing with `electron-updater`**

---

## 🎯 Architecture Summary: When to Build & When NOT to Build

Before building installers, remember how DataKarkhana is structured:

| Update Type | What was changed | Do you need to build `.exe` / `.dmg`? | How it updates |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | React, Next.js, CSS, HTML, dashboard tabs, copy text, pricing | ❌ **NO** | Just `git push` in `datakarkhana-frontend`. Vercel automatically updates the cloud UI. All desktop users get the update immediately on next app launch. |
| **Local Backend / Shell** | Scraper logic, Python requirements, Selenium scripts, Electron `main.js` | ✅ **YES** | Follow the build steps below to release a new version. `electron-updater` will silently download and apply it for customers. |

---

## 🔑 Prerequisites (One-Time Setup)

### 1. GitHub Personal Access Token (`GH_TOKEN`)
`electron-builder` needs permission to create releases and upload files to your repository (`AsifZaman777/datakarkhana-desktop`).

1. Open [GitHub Settings ➔ Developer Settings ➔ Personal access tokens (classic)](https://github.com/settings/tokens).
2. Click **Generate new token (classic)**.
3. Name it: `DataKarkhana Desktop Release Token`.
4. Check the **`repo`** scope (Full control of private and public repositories).
5. Click **Generate token** and copy the token (starts with `ghp_...`).
6. Save it somewhere safe.

---

## 🚀 Release Workflow: Step-by-Step

Whenever you make backend or desktop shell updates that require a new installer:

### Step 0: Bump the Version Number
In `datakarkhana-desktop/package.json`:
```json
{
  "name": "datakarkhana",
  "version": "2.0.3",  // <-- Increase version (e.g. 2.0.2 -> 2.0.3)
  ...
}
```
> [!IMPORTANT]
> Always increase the version number before building. If the version number is not incremented, existing client apps will ignore the update.

Commit and push this version bump to GitHub:
```bash
git add package.json main.js
git commit -m "chore: bump version to 2.0.3"
git push origin master
```

---

## 🪟 Windows Build & Auto-Publish

Run this on your **Windows PC**:

1. Open **PowerShell** and navigate to the desktop directory:
   ```powershell
   cd d:\Personal-projects\datakarkhana\datakarkhana-desktop
   ```

2. Set your GitHub token in the terminal session:
   ```powershell
   $env:GH_TOKEN = "ghp_yourPersonalAccessTokenHere"
   ```

3. Build and automatically publish:
   ```powershell
   npm run build:win -- --publish always
   ```

### What this produces and uploads to GitHub:
- `DataKarkhana Desktop Setup 2.0.x.exe` (NSIS Installer)
- `DataKarkhana Desktop Setup 2.0.x.exe.blockmap` (Differential download index)
- `DataKarkhana Desktop 2.0.x.exe` (Standalone Portable app)
- `latest.yml` (Windows auto-updater manifest)

---

## 🍏 macOS Build & Auto-Publish

Apple requires macOS binaries (`.dmg`, `.app`) to be built on an **Apple Mac (macOS)**.

Run this on your **MacBook**:

1. Open **Terminal** and navigate to your project:
   ```bash
   cd /path/to/datakarkhana/datakarkhana-desktop
   ```

2. Pull the latest code (with the bumped `package.json`):
   ```bash
   git pull origin master
   ```

3. Install dependencies (if first time):
   ```bash
   npm install
   ```

4. Set your GitHub token:
   ```bash
   export GH_TOKEN="ghp_yourPersonalAccessTokenHere"
   ```

5. Build and automatically publish:
   ```bash
   npm run build:mac -- --publish always
   ```

### What this produces and uploads to GitHub:
- `DataKarkhana Desktop-2.0.x.dmg` (The drag-to-Applications installer)
- `DataKarkhana Desktop-2.0.x-mac.zip` (Required by Mac auto-updater)
- `latest-mac.yml` (macOS auto-updater manifest)

---

## 📦 How GitHub Releases Combines Both Platforms

Because both builds use the same `version` (e.g., `2.0.3`), `electron-builder` will attach all files into the **exact same single GitHub Release tag (`v2.0.3`)**:

```
GitHub Release: v2.0.3
├── DataKarkhana Desktop Setup 2.0.3.exe       <-- Windows Installer
├── DataKarkhana Desktop Setup 2.0.3.exe.blockmap
├── DataKarkhana Desktop 2.0.3.exe             <-- Windows Portable
├── latest.yml                                 <-- Windows Auto-Update Config
├── DataKarkhana Desktop-2.0.3.dmg             <-- macOS Installer
├── DataKarkhana Desktop-2.0.3-mac.zip         <-- macOS Auto-Update Archive
└── latest-mac.yml                             <-- macOS Auto-Update Config
```

---

## 🔄 How Customer Auto-Updates Work

Once customers have installed version `2.0.2` or later:

1. **Background Check**: Every time the customer launches the Desktop app, `main.js` calls `autoUpdater.checkForUpdatesAndNotify()`.
2. **Platform-Specific Detection**:
   - **Windows apps** read `latest.yml` from GitHub.
   - **macOS apps** read `latest-mac.yml` from GitHub.
3. **Differential Download**: The app downloads **only the changed code chunks** in the background (typically a few megabytes instead of downloading the whole 80MB app).
4. **Silent Installation**: When the customer quits or restarts the app, the update is applied automatically.

---

## 🛠️ Troubleshooting & Helpful Tips

### 1. macOS Gatekeeper ("Unidentified Developer" warning)
If you don't have an Apple Developer Account ($99/year) to sign macOS binaries, macOS Gatekeeper may show a warning when opening the `.app` or `.dmg`.

**How customers bypass this:**
- **Easy Method**: Right-click (or Control-click) `DataKarkhana Desktop.app` in `/Applications` and click **Open**, then click **Open** again in the confirmation dialog.
- **Terminal 1-Liner**:
  ```bash
  xattr -cr "/Applications/DataKarkhana Desktop.app"
  ```

### 2. Windows: "A required privilege is not held by the client" (winCodeSign symlink error)
If Windows fails extracting `winCodeSign.7z` due to symlink permissions:
- Ensure Windows **Developer Mode** is turned **ON** in:
  *Windows Settings ➔ System ➔ For developers ➔ Developer Mode*.
- Alternatively, the cached `winCodeSign-2.6.0` folder in `C:\Users\<user>\AppData\Local\electron-builder\Cache\winCodeSign` is now cached and won't re-download.

### 3. Port 8000 Conflict During Local Development
If you need to test the backend locally using `uvicorn main:app --reload`:
- Make sure the packaged **DataKarkhana Desktop** app is closed.
- If port 8000 is still held, kill the orphan process in PowerShell:
  ```powershell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 8000).OwningProcess | Stop-Process -Force
  ```
