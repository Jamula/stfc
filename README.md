# 🚀 STFC Gift Redeemer

A mobile-friendly web app that automates the redemption of free gifts from the Star Trek Fleet Command web store.

## ✨ Features

- **Automated Gift Redemption**: One-click scanning and claiming of all available free gifts
- **Gift History Tracking**: Persistent record of all claimed rewards with timestamps
- **Manual Script Alternative**: Copy-paste JavaScript snippet for direct browser console use
- **Real-time Progress**: Visual feedback during the redemption process
- **Mobile-Friendly**: Responsive design optimized for all screen sizes

## 🔒 Important: Authentication & Browser Security

**Due to browser security restrictions (same-origin policy), embedded iframe login sessions cannot persist between page reloads.**

### What This Means:
- When using the embedded store view, you'll need to log in each time you reload the page
- Your login cookies cannot be saved across sessions when the store is embedded in an iframe
- This is a browser security feature, not a bug in the app

### Workarounds:
1. **Use the "Open Store in New Tab" button** - Your authentication WILL persist normally when using the store in a dedicated tab
2. **Use the Manual Script method** - Copy the script from the "Script" tab and run it directly in the store's console
3. **Keep the app open** - Authentication stays active as long as you don't refresh the page

## 🎮 How to Use

### Method 1: Embedded Store (Requires Re-login on Refresh)
1. Open the app
2. Log in to the STFC store in the embedded iframe
3. Click "Redeem All Gifts" to automatically claim all available rewards
4. View your gift history in the History tab

### Method 2: Manual Script (Recommended for Persistent Sessions)
1. Click the "Script" tab in the sidebar
2. Click "Copy" to copy the automation script
3. Click "Open Store" to open the STFC store in a new tab
4. Log in (your session will persist normally in this tab)
5. Press `F12` to open Developer Tools
6. Navigate to the "Console" tab
7. Paste the script and press Enter
8. Watch as it automatically claims all gifts

## 🛠️ Technical Details

Built with:
- React + TypeScript
- Tailwind CSS + Shadcn UI
- Spark KV (persistent storage)
- Phosphor Icons
- Framer Motion

## 📄 License

The Spark Template files and resources from GitHub are licensed under the terms of the MIT license, Copyright GitHub, Inc.
