#!/bin/bash

echo "Building STFC Gift Redeemer Browser Extension..."

# Build the React app for the extension popup
npm run build -- --config vite.config.extension.ts

# Copy necessary files to extension directory
cp extension/manifest.json extension/dist/manifest.json
cp extension/background.js extension/dist/background.js
cp extension/content.js extension/dist/content.js
cp -r extension/icons extension/dist/icons 2>/dev/null || echo "Icons directory not found, skipping..."

echo "Extension built successfully!"
echo "Load the 'extension/dist' folder in your browser to test."
