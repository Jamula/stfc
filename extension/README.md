# STFC Gift Redeemer - Browser Extension

This directory contains the browser extension version of the STFC Gift Redeemer, which provides **persistent authentication** that survives page refreshes and browser restarts.

## Key Advantages of the Extension

### 🔐 Persistent Authentication
Unlike the web app version, the browser extension:
- Maintains your login session across page reloads
- Preserves cookies and authentication tokens
- No need to log in again after refreshing
- Works seamlessly with the STFC store's authentication

### 🚀 Enhanced Functionality
- Direct access to page content without CORS restrictions
- Better DOM manipulation capabilities
- Background service worker for monitoring
- Gift history stored locally in the browser

## Installation

### Development Mode

1. **Build the extension:**
   ```bash
   npm run build:extension
   ```

2. **Load in Chrome/Edge:**
   - Open `chrome://extensions/` (or `edge://extensions/`)
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `extension` folder

3. **Load in Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select any file in the `extension` folder

### Usage

1. Navigate to the STFC store: https://home.startrekfleetcommand.com/store
2. Log in to your account (this login will persist!)
3. Click the extension icon in your browser toolbar
4. Click "Redeem All Gifts" to automatically claim available gifts
5. View your gift history in the History tab

## Features

### Automatic Gift Redemption
- Scans the STFC store page for all available free gifts
- Automatically clicks each gift and confirms the claim
- Shows real-time progress with a visual progress bar
- Stores gift history locally

### Persistent Authentication
- Your login session is maintained by the browser
- No need to re-authenticate after closing the popup
- Works across browser sessions

### Gift History Tracking
- Records all claimed gifts with timestamps
- Shows gift name, description, and claim time
- Persistent storage using Chrome Storage API
- Clear history option available

## File Structure

```
extension/
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup HTML
├── popup.jsx             # React entry point for popup
├── popup.css             # Compiled styles
├── background.js         # Service worker for background tasks
├── content.js           # Content script injected into STFC pages
├── icons/               # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md            # This file
```

## Technical Details

### Permissions Required
- `storage` - Store gift history and settings locally
- `activeTab` - Access current tab to scan for gifts
- `scripting` - Execute gift redemption scripts
- `cookies` - Monitor authentication state
- `webNavigation` - Detect page loads

### Host Permissions
- `https://home.startrekfleetcommand.com/*` - Access STFC store

## Troubleshooting

### Extension not working
1. Make sure you're on the STFC store page
2. Check that you're logged in
3. Try refreshing the STFC store page
4. Click the extension icon to open the popup

### No gifts found
1. Ensure you're on the store page (not a different STFC page)
2. Verify you have unclaimed gifts available
3. Some gifts may have already been claimed

### Authentication issues
1. Click "Open STFC Store" from the popup
2. Log in manually on the store page
3. The extension will detect your authentication automatically
4. Your session will persist even after closing the browser

## Development

### Build Commands
```bash
# Build extension for production
npm run build:extension

# Watch mode for development
npm run dev:extension
```

### Testing
1. Make changes to source files
2. Run `npm run build:extension`
3. Go to `chrome://extensions/`
4. Click the refresh icon on the STFC Gift Redeemer card
5. Test the updated extension

## Privacy & Security

- No data is sent to external servers
- All gift history is stored locally in your browser
- Authentication cookies are only accessed for status checking
- The extension only runs on STFC pages

## Support

For issues or questions about the extension version, please ensure:
- You have the latest version installed
- Your browser is up to date
- You have a stable internet connection
- The STFC store is accessible and not under maintenance
