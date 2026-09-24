import { LADO_ANALISIS, aGrises, medirImagen, evaluarCalidad } from '../../utils/calidadFoto.js';
import { TIPOS_CON_ENCUADRE, evaluarEncuadre } from '../../utils/encuadreVehiculo.js';
import { detectarObjetos } from './detectorVehiculo.js';

/**
 * Revisa una foto recién hecha y devuelve los avisos para el técnico.
 * Lo que decide vive en utils/ (calidadFoto, encuadreVehiculo), que se prueba
 * sin navegador; esto solo pasa del Blob a píxeles.
 *
 * Va en dos tiempos porque la calidad tarda milisegundos y el encuadre puede
 * tardar segundos la primera vez (bajar el modelo): `onCalidad` se llama en
 * cuanto hay algo que enseñar y la promesa resuelve con TODOS los avisos.
 */
export async function analizarFoto(blob, tipoKey, { onCalidad } = {}) {
  const bitmap = await createImageBitmap(blob);
  const escala = LADO_ANALISIS / Math.max(bitmap.width, bitmap.height);
  const ancho  = Math.round(bitmap.width * escala);
  const alto   = Math.round(bitmap.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width  = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close?.();

  const metricas = medirImagen(aGrises(ctx.getImageData(0, 0, ancho, alto)), ancho, alto);
  const calidad  = evaluarCalidad(metricas, tipoKey);
  onCalidad?.(calidad);

  if (!TIPOS_CON_ENCUADRE.includes(tipoKey)) return calidad;
  try {
    const detecciones = await detectarObjetos(canvas);
    return [...calidad, ...evaluarEncuadre(detecciones, ancho, alto, tipoKey)];
  } catch {
    return calidad;              // sin detector no hay aviso de encuadre, y ya
  }
}
