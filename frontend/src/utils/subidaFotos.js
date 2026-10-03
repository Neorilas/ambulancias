/**
 * utils/subidaFotos.js
 * Subida de fotos de evidencia aguantando mala cobertura.
 *
 * Origen (2026-10-03, asignación 81): con 4G flojo la primera foto de fin no
 * llegó en los 30 s de la instancia de axios, la pantalla enseñó «timeout of
 * 30000ms exceeded» y el técnico no supo qué había pasado. Ninguna foto llegó
 * al servidor y la asignación siguió abierta.
 *
 * Tres medidas, todas aquí para que las cuatro pantallas que suben fotos
 * (inicio/fin de asignación y de trabajo) se comporten igual:
 *  1. Un timeout propio y largo para las fotos. El resto de la app sigue en
 *     30 s: una lista que no carga no debe hacer esperar dos minutos.
 *  2. Reintentos automáticos SOLO ante fallos de red (sin respuesta) o un
 *     502/503/504 (Caddy durante un deploy). Un 4xx es una respuesta real del
 *     servidor y repetirla daría lo mismo.
 *  3. Un mensaje en español que dice qué se ha subido y qué hacer.
 *
 * Reintentar es seguro para las fotos de inicio/fin: el backend las guarda
 * una por tipo+momento y una segunda subida reemplaza a la primera. Las de
 * incidencia (momento 'general') se acumulan, así que si el primer intento sí
 * llegó y solo se perdió la respuesta, queda una foto repetida. Se acepta: una
 * foto de más no hace daño; una incidencia sin fotos, sí.
 */

export const SUBIDA_FOTO_TIMEOUT_MS = 120000;

// Pausa antes de cada reintento: dos reintentos, tres intentos en total.
export const ESPERAS_REINTENTO_MS = [2000, 5000];

// El aviso de error normal dura 6 s; este es largo y hay que poder leerlo.
export const DURACION_AVISO_FALLO_SUBIDA_MS = 15000;

const esperarMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** true si el fallo es de red/cobertura y no una respuesta real del servidor. */
export function esFalloDeRed(err) {
  if (!err || typeof err !== 'object') return false;
  if (!err.response) {
    // axios: timeout (ECONNABORTED/ETIMEDOUT), sin red (ERR_NETWORK). Un error
    // sin `request` es de programación, no de red: ese no se reintenta.
    return Boolean(err.request) || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(err.code);
  }
  return [502, 503, 504].includes(err.response.status);
}

/**
 * Ejecuta `enviar()` y lo repite tras cada espera de `esperas` mientras falle
 * por la red. Cualquier otro error, o el último fallo de red, se propaga.
 */
export async function conReintentos(enviar, { esperas = ESPERAS_REINTENTO_MS, esperar = esperarMs } = {}) {
  for (let intento = 0; ; intento++) {
    try {
      return await enviar();
    } catch (err) {
      if (intento >= esperas.length || !esFalloDeRed(err)) throw err;
      await esperar(esperas[intento]);
    }
  }
}

/**
 * Mensaje para un fallo de red durante el envío. `subidas`/`total` cuentan las
 * fotos de esta pulsación; si están todas, lo que falló fue el paso posterior
 * (cerrar el servicio, por ejemplo), y así se dice.
 */
export function mensajeFalloSubida({ subidas, total, boton }) {
  const remate = `No se ha perdido nada: no cierres esta pantalla y vuelve a pulsar «${boton}» cuando tengas mejor señal.`;
  if (total > 0 && subidas >= total) {
    return `Las fotos ya están subidas, pero no se ha podido terminar por falta de cobertura. ${remate}`;
  }
  return `No se han podido subir las fotos por falta de cobertura (${subidas} de ${total} subidas). ${remate}`;
}
