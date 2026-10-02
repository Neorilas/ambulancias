/**
 * Fotos de prueba para saltarse la cámara en local (`npm run dev`).
 *
 * Solo se usa detrás de `import.meta.env.DEV`: en un `vite build` esa
 * constante es `false` y el botón y este módulo desaparecen del bundle, así
 * que en PRE y producción no hay forma de llegar aquí.
 *
 * No se salta nada en el backend: genera un JPEG de verdad por tipo y lo
 * entrega por el mismo `onComplete` que la cámara, de modo que la subida,
 * Sharp, `getProgreso` y el cierre se prueban igual que con fotos reales.
 */
import { blobToFile } from '../../utils/imageCompress.js';

function jpegDePrueba(texto, landscape) {
  const [w, h] = landscape ? [1280, 720] : [720, 1280];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FOTO DE PRUEBA', w / 2, h / 2 - 40);
  ctx.fillStyle = '#ffffff';
  ctx.font = '40px sans-serif';
  ctx.fillText(texto, w / 2, h / 2 + 30);
  ctx.font = '28px monospace';
  ctx.fillText(new Date().toLocaleString('es-ES'), w / 2, h / 2 + 90);
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.8);
  });
}

/** Una entrada `{ tipo, label, preview, file }` por cada tipo, como la cámara. */
export async function generarFotosDePrueba(tipos) {
  return Promise.all(tipos.map(async (t) => {
    const blob = await jpegDePrueba(t.label, t.landscape);
    return {
      tipo: t.key,
      label: t.label,
      preview: URL.createObjectURL(blob),
      file: blobToFile(blob, `${t.key}.jpg`),
    };
  }));
}
