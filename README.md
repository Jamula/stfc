# 🚀 STFC Gift Redeemer

A dual-platform solution for automating gift redemption from the Star Trek Fleet Command web store, available as both a web app and browser extension.

## 📦 Two Versions Available

### 🌐 Web App (This Page)
- Instant access via web browser
- No installation required
- ⚠️ **Limitation**: Authentication resets on page refresh (browser security)
- Best for: Quick, occasional use

### 🔌 Browser Extension (Recommended)
- Install once, use anytime
- ✅ **Persistent authentication** - login survives page reloads and browser restarts
- Faster performance, no CORS restrictions
- Best for: Regular users who claim gifts frequently

👉 **[Installation Guide](./INSTALLATION.md)** - Learn how to install the browser extension

---

## ✨ Features

### Both Versions
- **Automated Gift Redemption**: One-click scanning and claiming of all available free gifts
- **Gift History Tracking**: Persistent record of all claimed rewards with timestamps
- **Real-time Progress**: Visual feedback during the redemption process
- **Authentication Monitoring**: Live status badges showing connection and login state

### Web App Exclusive
- **Manual Script Alternative**: Copy-paste JavaScript snippet for direct browser console use
- **Embedded Store View**: See the STFC store directly in the app
- **Mobile-Friendly**: Responsive design optimized for all screen sizes

### Extension Exclusive
- **Persistent Authentication**: Login once, stay logged in across sessions
- **Native Browser Integration**: Works seamlessly with STFC store pages
- **Background Monitoring**: Detects authentication changes automatically
- **Compact Popup**: Quick access from your browser toolbar

---

## 🔒 Understanding Authentication

### Why Doesn't the Web App Persist Login?

The web app loads the STFC store in an `<iframe>`. Due to browser security policies (same-origin policy), cookies and session data from the iframe are isolated and don't persist when you refresh the page. **This is a browser security feature, not a bug.**

### How the Extension Solves This

The browser extension:
- Runs as a trusted browser component
- Has permission to access `startrekfleetcommand.com`
- Uses the browser's native cookie storage
- Maintains authentication just like opening the store in a regular tab

**Your login persists across:**
- ✅ Extension popup closes
- ✅ Page refreshes
- ✅ Browser restarts
- ✅ System reboots

---

## 🎮 How to Use

### Web App - Method 1: Embedded Store
1. Open the app (this page)
2. Log in to the STFC store in the embedded iframe
3. Click "Redeem All Gifts" to automatically claim rewards
4. ⚠️ Note: You'll need to log in again after refreshing

### Web App - Method 2: Manual Script (Recommended)
1. Click the "Script" tab in the sidebar
2. Click "Copy" to copy the automation script
3. Click "Open Store" to open the STFC store in a new tab
4. Log in (your session persists normally in a dedicated tab)
5. Press `F12` to open Developer Tools
6. Navigate to the "Console" tab
7. Paste the script and press Enter
8. Watch as it automatically claims all gifts

### Browser Extension (Best Experience)
1. [Install the extension](./INSTALLATION.md) (one-time setup)
2. Navigate to https://home.startrekfleetcommand.com/store
3. Log in (only need to do this once!)
4. Click the extension icon in your toolbar
5. Click "Redeem All Gifts"
6. View your history in the History tab

---

## 🚀 Quick Start - Browser Extension

```bash
# Build the extension
npm run build:extension

# Load in Chrome/Edge
1. Go to chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extension/dist folder

# That's it! Your authentication will now persist.
```

For detailed installation instructions, see **[INSTALLATION.md](./INSTALLATION.md)**

---

## 📊 Comparison

| Feature | Web App | Browser Extension |
|---------|---------|-------------------|
| Installation | ❌ None needed | ✅ One-time setup |
| Persistent Auth | ❌ No | ✅ Yes |
| Works After Refresh | ❌ Need re-login | ✅ Yes |
| CORS Limitations | ⚠️ Some | ❌ None |
| Speed | 🐢 Slower | ⚡ Instant |
| Mobile Support | ✅ Yes | ❌ Desktop only |
| Best For | Quick testing | Regular use |

---

## 🛠️ Technical Details

Built with:
- **Frontend**: React 19 + TypeScript
- **Styling**: Tailwind CSS + Shadcn UI v4
- **Storage**: Spark KV (web) / Chrome Storage API (extension)
- **Icons**: Phosphor Icons
- **Animations**: Framer Motion
- **Build**: Vite 7

---

## 📁 Project Structure

```
.
├── src/                      # Web app source
│   ├── App.tsx              # Main web app component
│   ├── components/
│   │   ├── ExtensionPopup.tsx  # Extension popup component
│   │   ├── GiftHistory.tsx
│   │   └── ScriptGenerator.tsx
│   └── ...
├── extension/               # Browser extension
│   ├── manifest.json       # Extension config
│   ├── popup.html          # Extension popup
│   ├── popup.jsx           # Popup entry point
│   ├── background.js       # Service worker
│   ├── content.js          # Content script
│   └── icons/              # Extension icons
├── scripts/                 # Build scripts
│   ├── post-build-extension.js
│   └── create-icons.js
├── INSTALLATION.md          # Extension installation guide
└── README.md               # This file
```

---

## 🤝 Contributing

This project is open source. Contributions are welcome!

---

## 📄 License

The Spark Template files and resources from GitHub are licensed under the terms of the MIT license, Copyright GitHub, Inc.

---

## 🆘 Need Help?

- **For extension installation**: See [INSTALLATION.md](./INSTALLATION.md)
- **For troubleshooting**: Check the troubleshooting sections in the installation guide
- **For technical details**: See [extension/README.md](./extension/README.md)
