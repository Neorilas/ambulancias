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

// SVG base: cruz médica sobre fondo rojo
const svgBase = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Fondo rojo redondeado -->
  <rect width="512" height="512" rx="90" ry="90" fill="#dc2626"/>
  <!-- Cruz médica blanca -->
  <rect x="176" y="96"  width="160" height="320" rx="20" ry="20" fill="white"/>
  <rect x="96"  y="176" width="320" height="160" rx="20" ry="20" fill="white"/>
</svg>
`;

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

console.log('Generando iconos PWA...');

for (const size of sizes) {
  const outPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
  await sharp(Buffer.from(svgBase))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`  ✓ icon-${size}x${size}.png`);
}

// Favicon
await sharp(Buffer.from(svgBase))
  .resize(32, 32)
  .png()
  .toFile(path.join(__dirname, '../public/favicon.ico'));

// Apple touch icon
await sharp(Buffer.from(svgBase))
  .resize(180, 180)
  .png()
  .toFile(path.join(__dirname, '../public/apple-touch-icon.png'));

console.log('\n✅ Iconos generados en public/icons/');
