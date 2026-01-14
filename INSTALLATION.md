# STFC Gift Redeemer - Installation Guide

This guide will help you set up both versions of the STFC Gift Redeemer.

## 📱 Two Versions Available

### 1. Web App Version (Current)
- Access via web browser at the deployed URL
- Works with embedded iframe
- ⚠️ **Authentication limitation**: Due to browser security (same-origin policy), you need to log in each time you reload the page

### 2. Browser Extension Version (Recommended for Regular Use)
- Installs in your browser (Chrome, Edge, Firefox, etc.)
- ✅ **Persistent authentication**: Your login session is maintained across page reloads and browser restarts
- Better performance and reliability
- No CORS restrictions

---

## 🔧 Installing the Browser Extension

### Prerequisites
- Node.js 18+ installed
- A Chromium-based browser (Chrome, Edge, Brave, etc.) or Firefox

### Step 1: Build the Extension

```bash
# From the project root directory
npm run build:extension
```

This will create a `extension/dist` folder with all the necessary files.

### Step 2: Install in Chrome/Edge/Brave

1. Open your browser and navigate to:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`

2. Enable **"Developer mode"** (toggle in the top-right corner)

3. Click **"Load unpacked"**

4. Navigate to and select the `extension/dist` folder in this project

5. The extension should now appear in your extensions list! 🎉

### Step 3: Install in Firefox

1. Open Firefox and navigate to: `about:debugging#/runtime/this-firefox`

2. Click **"Load Temporary Add-on..."**

3. Navigate to the `extension/dist` folder

4. Select the `manifest.json` file

5. The extension is now loaded! (Note: Firefox temporary add-ons are removed when you close the browser)

### Step 4: Using the Extension

1. **Navigate to the STFC store**: https://home.startrekfleetcommand.com/store

2. **Log in to your account** (you only need to do this once!)

3. **Click the extension icon** in your browser toolbar (you may need to pin it first)

4. **Click "Redeem All Gifts"** to automatically claim all available gifts

5. **View your history** in the History tab

---

## 🌐 Using the Web App Version

If you prefer not to install the extension, you can use the web app version:

1. Navigate to the web app URL

2. The STFC store will load in an iframe

3. Log in to the store (you'll need to do this each time you refresh the page)

4. Click "Redeem All Gifts" to start the automatic redemption process

5. View your gift history and copy the manual script if needed

---

## 🆚 Comparison

| Feature | Web App | Browser Extension |
|---------|---------|-------------------|
| Installation Required | ❌ No | ✅ Yes |
| Persistent Auth | ❌ No | ✅ Yes |
| Page Refresh Survives | ❌ No | ✅ Yes |
| CORS Limitations | ⚠️ Some | ❌ None |
| Access Speed | 🐢 Slower | ⚡ Faster |
| Recommended For | Quick testing | Regular use |

---

## 🎯 Which Should I Use?

### Choose the **Browser Extension** if:
- ✅ You use STFC regularly and want to redeem gifts frequently
- ✅ You're tired of logging in every time
- ✅ You want the best performance
- ✅ You're comfortable installing browser extensions

### Choose the **Web App** if:
- ✅ You only need to use it occasionally
- ✅ You don't want to install anything
- ✅ You're trying it out for the first time

---

## 🔐 Authentication Persistence Explained

### Why doesn't the web app persist authentication?

The web app loads the STFC store in an `<iframe>`. Due to browser security policies (same-origin policy), cookies and session data from the iframe are isolated and don't persist when you refresh the page. This is a security feature to prevent malicious websites from accessing your login information.

### How does the extension solve this?

The browser extension:
1. Runs as a trusted component of your browser
2. Has permission to access and modify pages from `startrekfleetcommand.com`
3. Uses the browser's native cookie storage
4. Maintains authentication just like if you opened the STFC store in a regular tab

Your login session is stored by the browser itself, not by the extension, so it persists across:
- ✅ Extension popup closes
- ✅ Browser restarts
- ✅ System reboots

---

## 🛠️ Troubleshooting

### Extension shows "Disconnected"
- Make sure you're on a `startrekfleetcommand.com` page
- Click "Open STFC Store" from the extension popup

### Extension shows "Not Logged In"
- Navigate to the STFC store
- Log in manually
- The extension will detect your login automatically

### Gifts not being claimed
- Verify you're on the store page (not another STFC page)
- Check that you have unclaimed gifts available
- Try refreshing the STFC store page

### Extension not appearing after installation
- Check that it's enabled in your extensions page
- Try restarting your browser
- Rebuild with `npm run build:extension` and reload

---

## 🔒 Privacy & Security

Both versions:
- ✅ Do not send your data to external servers
- ✅ Do not store your login credentials
- ✅ Only interact with official STFC domains
- ✅ Store gift history locally (your device only)

---

## 📚 Additional Resources

- **Extension README**: See `extension/README.md` for more technical details
- **Web App Documentation**: See the main README.md for web app features
- **Icon Customization**: See `extension/icons/README.md` for icon creation

---

## 🤝 Support

If you encounter issues with either version:

1. Check the troubleshooting section above
2. Verify you're using the latest version
3. Try clearing your browser cache
4. Rebuild the extension with `npm run build:extension`

---

**Enjoy automated gift redemption with persistent authentication! 🚀**
