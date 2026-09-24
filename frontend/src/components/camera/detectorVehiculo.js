/**
 * Detector de vehículos (COCO-SSD sobre TensorFlow.js) para el aviso de
 * encuadre de las fotos exteriores. La decisión de si avisar está en
 * utils/encuadreVehiculo.js; aquí solo se carga el modelo y se pasa la imagen.
 *
 * - TensorFlow va en import() dinámico: son ~1,5 MB de JS que solo necesita
 *   quien abre la cámara, no el resto de la app.
 * - El modelo se sirve desde NUESTRO hosting (public/modelos/, generado con
 *   scripts/cuantizar-modelo.js), no desde Google: no depende de un tercero y
 *   el service worker lo guarda para siempre tras la primera descarga (7 MB).
 * - Cualquier fallo (sin WebGL, sin red la primera vez) se traga: el aviso de
 *   encuadre es un extra y no puede impedir hacer la foto.
 */

const RUTA_MODELO = `${import.meta.env.BASE_URL}modelos/coco-ssd-v1/model.json`;

let promesa = null;

function cargar() {
  if (!promesa) {
    promesa = (async () => {
      const tf = await import('@tensorflow/tfjs-core');
      // webgl es el rápido; cpu hace falta igualmente porque coco-ssd cambia a
      // él un momento para la supresión de no-máximos
      await import('@tensorflow/tfjs-backend-webgl');
      await import('@tensorflow/tfjs-backend-cpu');
      await tf.ready();
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: RUTA_MODELO });
    })().catch((err) => {
      promesa = null;            // que el siguiente intento vuelva a probar
      throw err;
    });
  }
  return promesa;
}

/** Empieza a bajar/cargar el modelo sin esperar a que haga falta. */
export function precargarDetector() {
  cargar().catch(() => {});
}

/**
 * Detecciones sobre un canvas o imagen: [{ class, score, bbox:[x,y,w,h] }]
 * en píxeles de esa fuente.
 */
export async function detectarObjetos(fuente) {
  const modelo = await cargar();
  return modelo.detect(fuente, 10, 0.3);
}
