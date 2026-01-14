# Extension Icon Placeholder

The extension icons should be PNG files in the following sizes:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

An SVG template (`icon.svg`) is provided. To create the PNG icons:

## Option 1: Using Online Tools
1. Open icon.svg in a browser or SVG editor
2. Export/screenshot at the required sizes
3. Save as icon16.png, icon48.png, and icon128.png

## Option 2: Using ImageMagick
```bash
convert -background none icon.svg -resize 16x16 icon16.png
convert -background none icon.svg -resize 48x48 icon48.png
convert -background none icon.svg -resize 128x128 icon128.png
```

## Option 3: Using Inkscape
```bash
inkscape icon.svg -w 16 -h 16 -o icon16.png
inkscape icon.svg -w 48 -h 48 -o icon48.png
inkscape icon.svg -w 128 -h 128 -o icon128.png
```

## Temporary Solution
For testing purposes, you can use any 16x16, 48x48, and 128x128 PNG images.
The extension will work with placeholder icons.
