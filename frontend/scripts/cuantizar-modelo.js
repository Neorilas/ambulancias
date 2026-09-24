#!/usr/bin/env node
/**
 * scripts/cuantizar-modelo.js
 *
 * Descarga el detector de objetos COCO-SSD (ssdlite_mobilenet_v2) que publica
 * TensorFlow.js y lo deja en public/modelos/ con los pesos reducidos. Lo usa
 * components/camera/detectorVehiculo.js para avisar de una ambulancia cortada
 * o lejos en las fotos exteriores.
 *
 * Por qué reducirlo: el original son 17 MB de float32 y lo descarga el móvil
 * del técnico, muchas veces con datos. Queda en 7 MB así:
 *  - Las capas de clasificación (`…Predictor/weights`) a uint8, afín por
 *    tensor (lo mismo que `tensorflowjs_converter --quantize_uint8`).
 *  - Todo lo demás a float16.
 * La trampa: pasarlo TODO a uint8 (4,3 MB) parece funcionar y no: las
 * convoluciones de MobileNet llevan fundida la normalización por lotes
 * (`merged_input`), cada canal tiene una escala distinta y un solo rango por
 * tensor se los come. Comparando salidas con el original sobre las mismas
 * imágenes, todo-uint8 daba correlación 0,58; float16, 0,9999; esta mezcla,
 * 0,9994. tfjs deshace las dos cuantizaciones solo al cargar, porque van
 * declaradas en el manifiesto.
 *
 * Solo hace falta volver a correrlo si se cambia de modelo. Si cambia el
 * resultado, sube la versión de la carpeta (DESTINO) y la ruta en
 * detectorVehiculo.js: el service worker cachea /modelos/ para siempre y no se
 * enteraría de un fichero nuevo con el mismo nombre.
 *
 * Uso: node scripts/cuantizar-modelo.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN    = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2';
const DESTINO   = path.join(__dirname, '../public/modelos/coco-ssd-v1');

// float32 → bits de float16 (IEEE 754 half), redondeando al más cercano.
function aFloat16(v) {
  const x = new Uint32Array(new Float32Array([v]).buffer)[0];
  const signo = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return signo;
    const m = (mant | 0x800000) >> (1 - exp);
    return signo | ((m + 0x1000) >> 13);
  }
  if (exp >= 31) return signo | 0x7c00;
  return signo + (exp << 10) + ((mant + 0x1000) >> 13);
}

function aUint8(f) {
  let min = Infinity, max = -Infinity;
  for (const v of f) { if (v < min) min = v; if (v > max) max = v; }
  const escala = max > min ? (max - min) / 255 : 1;
  const q = Buffer.alloc(f.length);
  for (let i = 0; i < f.length; i++) q[i] = Math.round((f[i] - min) / escala);
  return { datos: q, quantization: { dtype: 'uint8', min, scale: escala, original_dtype: 'float32' } };
}

function aHalf(f) {
  const h = Buffer.alloc(f.length * 2);
  for (let i = 0; i < f.length; i++) h.writeUInt16LE(aFloat16(f[i]), i * 2);
  return { datos: h, quantization: { dtype: 'float16', original_dtype: 'float32' } };
}

async function bajar(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const modelo = JSON.parse((await bajar(`${ORIGEN}/model.json`)).toString('utf8'));
if (modelo.weightsManifest.length !== 1) throw new Error('Se esperaba un único grupo de pesos');

const grupo  = modelo.weightsManifest[0];
const shards = [];
for (const p of grupo.paths) shards.push(await bajar(`${ORIGEN}/${p}`));
const todo = Buffer.concat(shards);

const salida = [];
const pesos  = [];
let   offset = 0;

for (const w of grupo.weights) {
  const n     = w.shape.reduce((a, b) => a * b, 1);
  const bytes = n * 4;                     // float32 e int32 ocupan lo mismo
  const trozo = todo.subarray(offset, offset + bytes);
  offset += bytes;

  if (w.dtype !== 'float32') {             // los int32 (formas, índices) no se tocan
    salida.push(Buffer.from(trozo));
    pesos.push(w);
    continue;
  }

  const f = new Float32Array(trozo.buffer.slice(trozo.byteOffset, trozo.byteOffset + bytes));
  const { datos, quantization } = /Predictor\/weights$/.test(w.name) ? aUint8(f) : aHalf(f);
  salida.push(datos);
  pesos.push({ ...w, quantization });
}

if (offset !== todo.length) throw new Error(`Sobran/faltan bytes: ${offset} de ${todo.length}`);

fs.mkdirSync(DESTINO, { recursive: true });
const bin = Buffer.concat(salida);
fs.writeFileSync(path.join(DESTINO, 'pesos.bin'), bin);
fs.writeFileSync(path.join(DESTINO, 'model.json'), JSON.stringify({
  ...modelo,
  weightsManifest: [{ paths: ['pesos.bin'], weights: pesos }],
}));

const mb = (b) => (b / 1024 / 1024).toFixed(1);
console.log(`Pesos: ${mb(todo.length)} MB → ${mb(bin.length)} MB en ${path.relative(process.cwd(), DESTINO)}`);
