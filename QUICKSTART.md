# 🚀 Quick Start Guide - STFC Gift Redeemer Browser Extension

This guide will get you up and running with the browser extension in under 5 minutes.

## Prerequisites

- Node.js 18 or higher
- Chrome, Edge, Brave, or Firefox browser
- Git (to clone/download the project)

## Step 1: Build the Extension (2 minutes)

```bash
# Navigate to the project directory
cd spark-template

# Install dependencies (if you haven't already)
npm install

# Build the extension
npm run build:extension
```

The extension will be built to the `extension/dist` folder.

## Step 2: Load the Extension (1 minute)

### Chrome / Edge / Brave

1. Open your browser and navigate to:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`

2. Toggle **"Developer mode"** ON (top-right corner)

3. Click **"Load unpacked"**

4. Select the `extension/dist` folder from your project

5. ✅ Done! The extension should now appear in your extensions list

### Firefox

1. Open Firefox and navigate to: `about:debugging#/runtime/this-firefox`

2. Click **"Load Temporary Add-on..."**

3. Navigate to the `extension/dist` folder

4. Select the `manifest.json` file

5. ✅ Done! (Note: Temporary add-ons are removed when Firefox closes)

## Step 3: Pin the Extension (Optional but Recommended)

1. Click the **puzzle icon** (🧩) in your browser toolbar

2. Find **"STFC Gift Redeemer"**

3. Click the **pin icon** to keep it visible

## Step 4: Use the Extension (1 minute)

1. **Navigate to the STFC store**: https://home.startrekfleetcommand.com/store

2. **Log in** with your STFC account (you only need to do this once!)

3. **Click the extension icon** in your browser toolbar

4. **Click "Redeem All Gifts"**

5. Watch as all available gifts are automatically claimed! 🎉

## That's It!

Your authentication will now persist across:
- ✅ Browser restarts
- ✅ Page refreshes  
- ✅ Extension popup closes
- ✅ System reboots

No need to log in again unless you explicitly log out of the STFC store.

---

## Troubleshooting

### "Disconnected" status in extension
- Make sure you're on a `startrekfleetcommand.com` page
- Click "Open STFC Store" from the extension popup

### "Not Logged In" status
- Navigate to the STFC store page
- Log in manually
- The extension will automatically detect your login

### Extension not appearing after loading
- Check that it's enabled in your extensions page
- Try restarting your browser
- Rebuild: `npm run build:extension` and reload

### Build errors
- Make sure you have Node.js 18+ installed
- Delete `node_modules` and run `npm install` again
- Check that all dependencies installed successfully

---

## Next Steps

- **View Gift History**: Open the extension and check the History tab
- **Clear History**: Use the "Clear History" button in the History tab
- **Update Extension**: Run `npm run build:extension` again and click the refresh icon in your extensions page

---

## Need More Help?

- **Full Installation Guide**: See [INSTALLATION.md](./INSTALLATION.md)
- **Technical Details**: See [extension/README.md](./extension/README.md)
- **Web App Version**: See [README.md](./README.md)

**Enjoy hassle-free gift redemption! 🚀**
