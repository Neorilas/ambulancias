#!/usr/bin/env node
/**
 * scripts/generate-icons.js
 * Genera iconos PNG para la PWA a partir de un SVG base
 * Requiere: sharp  (incluido en devDependencies)
 *
 * Uso: node scripts/generate-icons.js
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR  = path.join(__dirname, '../public/icons');

if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

// Leer SVG base desde archivo
const SVG_PATH = path.join(__dirname, '../public/icon-base.svg');
const svgBuffer = fs.readFileSync(SVG_PATH);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

console.log('Generando iconos PWA desde icon-base.svg...');

for (const size of sizes) {
  const outPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`  ✓ icon-${size}x${size}.png`);
}

// Favicon (32x32 PNG guardado como .ico — los browsers modernos aceptan PNG)
await sharp(svgBuffer)
  .resize(32, 32)
  .png()
  .toFile(path.join(__dirname, '../public/favicon.ico'));
console.log('  ✓ favicon.ico 32x32');

// Apple touch icon (180x180)
await sharp(svgBuffer)
  .resize(180, 180)
  .png()
  .toFile(path.join(__dirname, '../public/apple-touch-icon.png'));
console.log('  ✓ apple-touch-icon.png 180x180');

console.log('\n✅ Iconos generados en public/icons/');
