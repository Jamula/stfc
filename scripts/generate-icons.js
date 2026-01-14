import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, '../extension/icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

function createSimpleIconSVG(size) {
  const scale = size / 128;
  return `<svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="24" fill="#1a1f3a"/>
  <g transform="translate(64, 64)">
    <path d="M 0,-35 L 8,-25 L 8,15 L 12,20 L -12,20 L -8,15 L -8,-25 Z" 
          fill="#64b5f6" 
          stroke="#ffffff" 
          stroke-width="2"/>
    <ellipse cx="0" cy="-38" rx="6" ry="8" fill="#ff6b6b"/>
    <path d="M -15,-15 L -20,-5 L -18,0 L -15,-10 Z" fill="#ff6b6b" opacity="0.8"/>
    <path d="M 15,-15 L 20,-5 L 18,0 L 15,-10 Z" fill="#ff6b6b" opacity="0.8"/>
    <circle cx="0" cy="5" r="3" fill="#ffffff"/>
    <path d="M -3,22 L -6,32 L 6,32 L 3,22 Z" fill="#ff6b6b"/>
  </g>
  <circle cx="100" cy="28" r="14" fill="#7de8a8"/>
  <path d="M 93,28 L 97,23 L 107,28 L 97,33 Z" fill="#1a1f3a"/>
</svg>`;
}

sizes.forEach(size => {
  const svg = createSimpleIconSVG(size);
  const svgPath = path.join(iconsDir, `icon${size}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`✓ Created icon${size}.svg`);
});

console.log('\n📝 Note: SVG icons created. For best results, convert to PNG:');
console.log('   - Use an online converter (e.g., convertio.co, cloudconvert.com)');
console.log('   - Or use ImageMagick: convert icon.svg -resize 16x16 icon16.png');
console.log('   - Or use Inkscape: inkscape icon.svg -w 16 -h 16 -o icon16.png');
