#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconsDir = path.join(__dirname, '../extension/icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const iconSizes = [
  { size: 16, file: 'icon16.png' },
  { size: 48, file: 'icon48.png' },
  { size: 128, file: 'icon128.png' }
];

console.log('Creating simple placeholder PNG icons...\n');

const createCanvas = (size) => {
  const canvas = Buffer.alloc(size * size * 4);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      
      const centerX = size / 2;
      const centerY = size / 2;
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      const maxDistance = size / 2;
      
      if (distance < maxDistance * 0.8) {
        canvas[idx] = 100;
        canvas[idx + 1] = 181;
        canvas[idx + 2] = 246;
        canvas[idx + 3] = 255;
      } else if (distance < maxDistance) {
        canvas[idx] = 26;
        canvas[idx + 1] = 31;
        canvas[idx + 2] = 58;
        canvas[idx + 3] = 255;
      } else {
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      }
    }
  }
  
  return canvas;
};

const createMinimalPNG = (size) => {
  const header = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  ]);
  
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(size, 8);
  ihdr.writeUInt32BE(size, 12);
  ihdr.writeUInt8(8, 16);
  ihdr.writeUInt8(6, 17);
  ihdr.writeUInt8(0, 18);
  ihdr.writeUInt8(0, 19);
  ihdr.writeUInt8(0, 20);
  
  const color = Buffer.from([0x64, 0xb5, 0xf6, 0xff]);
  const idat = Buffer.alloc(size * size * 4 + size + 8);
  idat.writeUInt32BE(size * size * 4 + size + 2, 0);
  idat.write('IDAT', 4);
  
  for (let y = 0; y < size; y++) {
    idat.writeUInt8(0, 8 + y * (size * 4 + 1));
    for (let x = 0; x < size; x++) {
      const offset = 8 + y * (size * 4 + 1) + 1 + x * 4;
      color.copy(idat, offset);
    }
  }
  
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4E, 0x44,
    0xAE, 0x42, 0x60, 0x82
  ]);
  
  return Buffer.concat([header, ihdr, idat, iend]);
};

iconSizes.forEach(({ size, file }) => {
  const png = createMinimalPNG(size);
  const filepath = path.join(iconsDir, file);
  fs.writeFileSync(filepath, png);
  console.log(`✓ Created ${file} (${size}x${size})`);
});

console.log('\n✅ All icon files created successfully!');
console.log('📝 These are simple placeholder icons.');
console.log('   For production, replace with properly designed icons.\n');
