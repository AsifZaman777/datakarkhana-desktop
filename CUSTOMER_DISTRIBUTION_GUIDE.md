# DataKarkhana Desktop App — Customer Distribution & Licensing Guide

This guide explains how to package and give the local desktop version of DataKarkhana / MarketingOstad to your customers with a signed **Production Key** and **Expiration Date**.

---

## 🎯 How The System Works

1. **Local Selenium Execution**:
   All web scrapers and browser automations run directly on the customer's PC or laptop (using their local Chrome browser). You pay **৳0** in hosted server or proxy fees for running Selenium.

2. **Tamper-Proof Production Key Licensing**:
   Each license is cryptographically signed (HMAC-SHA256). Customers **cannot modify** their expiration dates or forge keys. The app also includes anti-clock-tampering protection.

3. **Admin Payment & License Workflow**:
   When a customer pays via bKash or Pathao, you approve the payment in your Admin Panel, select their validity period (e.g., 30 days, 60 days, 1 year), click **Approve & Generate Key**, and copy the key to send them on WhatsApp.

---

## 📦 How to Give the App to Customers (No Suspicious .bat Files!)

Your customers will **never see a command prompt window or terminal screen**. Everything runs with the official **DataKarkhana Cyber 3D App Icon**!

### 🍏 For macOS Users (Mac / MacBook)

1. **Option 1: The Native `DataKarkhana.app` Bundle (Easiest)**
   - Distribute the `DataKarkhana.app` application directly.
   - The app has the official high-resolution `icon.icns` embedded.
   - Customer simply double-clicks **`DataKarkhana.app`**.
   - **Terminal NEVER opens!** Electron's dark splash screen appears immediately with the cyber logo and progress bar, initializes Python in the background, and opens the main interface.

2. **Option 2: Compiled Standalone App Bundle**
   - Located in `desktop/dist/mac-arm64/DataKarkhana Desktop.app`.
   - Customers can drag it straight to their `/Applications` folder just like Slack, Spotify, or VS Code!

---

### 🪟 For Windows Users (PC / Laptop)

1. **Option 1: 1-Click Desktop Icon (Instant Setup)**
   - Inside the folder, customer double-clicks **`Install_Desktop_Icon.bat`** once.
   - It instantly creates a **`DataKarkhana Desktop`** shortcut on their Windows Desktop, with the official **DataKarkhana App Icon (`icon.ico`)**!
   - From then on, the customer simply double-clicks their Desktop icon to launch!
   - **Zero black Command Prompt / CMD windows!** Everything executes silently in the background (`windowsHide: true`).

2. **Option 2: Compiled Standalone `.exe`**
   - Located in `desktop/dist/win-unpacked/DataKarkhana Desktop.exe`.
   - Features the embedded `icon.ico` resource directly inside the `.exe` file.
   - Can be pinned to Windows Taskbar or Start Menu.

---

## 🔑 How to Generate and Give Licenses to Customers

### Method 1: Directly from the Admin Dashboard (1-Click Workflow)

1. Open your Admin Panel and go to the **Payment Verification** tab.
2. Find the customer's pending payment request and click the green **"Approve & Key"** button.
3. A modal opens:
   - Select the validity duration: **30 Days**, **60 Days**, **90 Days**, **1 Year**, or enter custom days.
   - Click **"Approve & Generate Key"**.
4. The key is generated instantly. You can:
   - Click **"Copy Key"** to copy the Production Key (e.g. `DK-PROD-2026-XXXX-XXXX`).
   - Click **"Copy WhatsApp Message"** to copy a pre-formatted message ready to paste into WhatsApp!
5. Send the key to the customer via WhatsApp, SMS, or Email.

---

### Method 2: From the "Desktop Licenses" Admin Tab (Anytime on Demand)

If a customer pays outside the app or needs a custom extension:
1. Go to Admin Panel -> **Desktop Licenses** tab.
2. Click **"Generate Production Key"**.
3. Enter Customer Name, validity period (days), and click **Generate Key**.
4. Click the **Copy** icon next to their key and send it to them.
5. To extend an existing customer's key, click **"Extend"** on their row (+30, +60, +90 days).

---

### Method 3: From Terminal CLI (For Superadmin)

You can also generate keys directly from terminal:
```bash
cd datakarkhana-backend
python3 generate_license.py --customer "Customer Name" --days 30
```
This prints the formatted Production Key and Full Token.

---

## 🖥️ What Your Customer Sees in the App

1. When the customer opens the app:
   - A badge in the header shows **"Unlicensed"** or **"License Expired"**.
2. When they click the badge (or attempt to run a scraper):
   - A sleek **License Activation Modal** opens.
   - Customer pastes their **Production Key** and clicks **"Activate"**.
   - The app verifies the key and displays:
     `License Active • PRO • 30 days left (Valid until [Date])`
3. When the license expires:
   - Scraping and automations are locked with an expiration alert.
   - It displays your WhatsApp hotline (`+880 1824500704`) and support email to contact you for renewal.
