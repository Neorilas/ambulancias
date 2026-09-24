#!/usr/bin/env node
/**
 * scripts/calibrar-calidad-foto.mjs
 *
 * Banco de pruebas de src/utils/calidadFoto.js: genera escenas sintéticas (un
 * lateral de ambulancia con damero y el cuadro de instrumentos de día y de
 * noche), las degrada a propósito (desenfoque, arrastre horizontal, vertical y
 * diagonal, oscuridad, ruido, sobreexposición), las pasa por JPEG como haría
 * el móvil y enseña las métricas y los avisos de cada una.
 *
 * Es de donde salen los umbrales de calidadFoto.js. Si se tocan, correr esto
 * antes y después: lo nítido tiene que seguir en OK y lo degradado avisando.
 *
 * Uso: node scripts/calibrar-calidad-foto.mjs
 *      DUMP=cuadro-noche/mov31h DUMPDIR=/tmp node scripts/calibrar-calidad-foto.mjs
 *        (guarda esa escena, ya reducida, en DUMPDIR/dump.png para verla)
 */
import sharp from 'sharp';
import { aGrises, medirImagen, evaluarCalidad, LADO_ANALISIS } from '../src/utils/calidadFoto.js';

const W = 1920, H = 1080;
const exterior = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3e6"/><stop offset="1" stop-color="#dfe9f1"/></linearGradient>
<pattern id="a" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#6b6b6b"/><rect width="2" height="2" x="3" y="1" fill="#7a7a7a"/><rect width="1" height="2" x="1" y="4" fill="#5c5c5c"/></pattern></defs>
<rect width="${W}" height="620" fill="url(#c)"/><rect y="620" width="${W}" height="460" fill="url(#a)"/>
<rect x="100" y="300" width="1300" height="200" fill="#8a8f96"/>
<rect x="240" y="260" width="1300" height="520" rx="30" fill="#f6f6f2" stroke="#333" stroke-width="3"/>
<rect x="1540" y="420" width="230" height="360" rx="40" fill="#f6f6f2" stroke="#333" stroke-width="3"/>
<rect x="1560" y="440" width="170" height="130" rx="10" fill="#22303c"/>
<rect x="240" y="560" width="1530" height="80" fill="#1d6a3a"/>${Array.from({length:26},(_,i)=>`<rect x="${240+i*60}" y="${560+(i%2)*40}" width="60" height="40" fill="#f2d21b"/>`).join("")}
<text x="500" y="520" font-family="Arial" font-weight="bold" font-size="110" fill="#1d6a3a">AMBULANCIA</text>
<text x="600" y="720" font-family="Arial" font-size="40" fill="#222">SOPORTE VITAL BASICO 112</text>
<rect x="300" y="300" width="200" height="140" fill="#2a3a48"/><rect x="1300" y="300" width="200" height="140" fill="#2a3a48"/>
<circle cx="450" cy="790" r="95" fill="#111"/><circle cx="450" cy="790" r="45" fill="#aaa"/>
<circle cx="1500" cy="790" r="95" fill="#111"/><circle cx="1500" cy="790" r="45" fill="#aaa"/>
<rect x="700" y="230" width="140" height="30" fill="#1b4fd6"/></svg>`;

const cuadro = (fondo) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${fondo}"/>
<circle cx="560" cy="540" r="330" fill="none" stroke="#e8e8e8" stroke-width="6" opacity="0.8"/>
<circle cx="1360" cy="540" r="330" fill="none" stroke="#e8e8e8" stroke-width="6" opacity="0.8"/>
${Array.from({ length: 13 }, (_, i) => {
  const a = (-220 + i * 20) * Math.PI / 180;
  return `<line x1="${560 + 280 * Math.cos(a)}" y1="${540 + 280 * Math.sin(a)}" x2="${560 + 320 * Math.cos(a)}" y2="${540 + 320 * Math.sin(a)}" stroke="#fff" stroke-width="6"/><text x="${560 + 230 * Math.cos(a) - 20}" y="${540 + 230 * Math.sin(a) + 15}" fill="#fff" font-size="40" font-family="Arial">${i * 20}</text>`;
}).join('')}
<line x1="560" y1="540" x2="780" y2="420" stroke="#ff3b1f" stroke-width="10"/>
<rect x="760" y="760" width="400" height="90" fill="#0b1a0b"/>
<text x="790" y="835" font-family="Courier New" font-weight="bold" font-size="80" fill="#ffb020">184 532</text>
<text x="1110" y="835" font-family="Arial" font-size="30" fill="#ffb020">km</text></svg>`;

const base = (svg) => sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
function ruido(buf, s) {
  const o = Buffer.from(buf);
  for (let i = 0; i < o.length; i++) {
    const g = Math.random() + Math.random() + Math.random() - 1.5;
    o[i] = Math.max(0, Math.min(255, o[i] + g * s * 2));
  }
  return o;
}
function escala(buf, f) { const o = Buffer.from(buf); for (let i = 0; i < o.length; i++) o[i] = Math.min(255, o[i] * f); return o; }
const kern = (n, horiz) => {
  const k = Array(n * 3).fill(0);
  for (let i = 0; i < n; i++) k[horiz ? n + i : i * 3 + 1] = 1 / n;
  return { width: horiz ? n : 3, height: horiz ? 3 : n, kernel: k };
};

async function medir(raw, info, fx) {
  const jpg = await fx(sharp(raw, { raw: info })).jpeg({ quality: 85 }).toBuffer();
  if (process.env.DUMP && medir.etiqueta === process.env.DUMP) await sharp(jpg).resize({ width: LADO_ANALISIS }).toFile(`${process.env.DUMPDIR}/dump.png`);
  const { data, info: i2 } = await sharp(jpg).resize({ width: LADO_ANALISIS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return medirImagen(aGrises({ data, width: i2.width, height: i2.height }), i2.width, i2.height);
}

const escenas = [['exterior', exterior, 'frontal'], ['cuadro-noche', cuadro('#000'), 'cuentakilometros'], ['cuadro-dia', cuadro('#2b2e33'), 'cuentakilometros']];
for (const [nom, svg, tk] of escenas) {
  const { data, info } = await base(svg);
  const casos = [
    ['nitida', data, x => x],
    ['blur1', data, x => x.blur(1)],
    ['blur2', data, x => x.blur(2)],
    ['blur4', data, x => x.blur(4)],
    ['blur8', data, x => x.blur(8)],
    ['mov9h', data, x => x.convolve(kern(9, true))],
    ['mov15h', data, x => x.convolve(kern(15, true))],
    ['mov31h', data, x => x.convolve(kern(31, true))],
    ['mov31v', data, x => x.convolve(kern(31, false))],
    ['mov21diag', data, x => x.convolve({ width: 21, height: 21, kernel: Array.from({ length: 441 }, (_, i) => (i % 22 === 0 ? 1 / 21 : 0)) })],
    ['mov9diag', data, x => x.convolve({ width: 9, height: 9, kernel: Array.from({ length: 81 }, (_, i) => (i % 10 === 0 ? 1 / 9 : 0)) })],
    ['oscura', ruido(escala(data, 0.25), 6), x => x],
    ['oscura+ruido15', ruido(escala(data, 0.3), 15), x => x],
    ['oscura+mov25', ruido(escala(data, 0.3), 6), x => x.convolve(kern(25, true))],
    ['oscura+blur4', ruido(escala(data, 0.3), 6), x => x.blur(4)],
    ['quemada', escala(data, 2.2), x => x],
    ['ruido-nitida', ruido(data, 12), x => x],
  ];
  for (const [c, d, fx] of casos) {
    medir.etiqueta = `${nom}/${c}`;
    const m = await medir(d, info, fx);
    const av = evaluarCalidad(m, tk).map(a => a.codigo).join(',');
    console.log(nom.padEnd(13), c.padEnd(15),
      `br=${m.brillo.toFixed(0).padStart(3)} p98=${String(m.p98).padStart(3)} p995=${m.p995} q=${m.quemados.toFixed(2)} n=${m.nitidez?.toFixed(3)} nx=${m.nitidezX?.toFixed(3)} ny=${m.nitidezY?.toFixed(3)} e=${m.estela.valor.toFixed(2)} ec=${m.estela.contraste.toFixed(2)} [${Object.values(m.estela.por).map(v=>v.toFixed(2)).join(" ")}]`,
      '→', av || 'OK');
  }
}
