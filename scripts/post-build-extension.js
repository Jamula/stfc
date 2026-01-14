import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionDir = path.join(__dirname, '../extension');
const distDir = path.join(extensionDir, 'dist');

console.log('Post-processing extension build...');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const filesToCopy = [
  { src: 'manifest.json', dest: 'manifest.json' },
  { src: 'background.js', dest: 'background.js' },
  { src: 'content.js', dest: 'content.js' }
];

filesToCopy.forEach(({ src, dest }) => {
  const srcPath = path.join(extensionDir, src);
  const destPath = path.join(distDir, dest);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`✓ Copied ${src} to dist/`);
  } else {
    console.warn(`⚠ Warning: ${src} not found`);
  }
});

const iconsDir = path.join(extensionDir, 'icons');
const distIconsDir = path.join(distDir, 'icons');

if (fs.existsSync(iconsDir)) {
  if (!fs.existsSync(distIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
  }
  
  const iconFiles = fs.readdirSync(iconsDir).filter(f => f.endsWith('.png') || f.endsWith('.svg'));
  iconFiles.forEach(file => {
    fs.copyFileSync(
      path.join(iconsDir, file),
      path.join(distIconsDir, file)
    );
    console.log(`✓ Copied ${file} to dist/icons/`);
  });
}

const popupHtmlPath = path.join(extensionDir, 'popup.html');
const distPopupHtmlPath = path.join(distDir, 'popup.html');

if (fs.existsSync(popupHtmlPath)) {
  let html = fs.readFileSync(popupHtmlPath, 'utf-8');
  
  html = html.replace('href="popup.css"', 'href="popup.css"');
  html = html.replace('src="popup.js"', 'src="popup.js"');
  
  fs.writeFileSync(distPopupHtmlPath, html);
  console.log('✓ Copied and processed popup.html');
}

console.log('\n✅ Extension build complete!');
console.log(`📁 Load the extension from: ${distDir}`);
console.log('\nNext steps:');
console.log('1. Open chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log('4. Select the extension/dist folder');
