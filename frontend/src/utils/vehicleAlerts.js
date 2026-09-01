/**
 * utils/vehicleAlerts.js
 *
 * Utilidades compartidas para el sistema de alertas de caducidad
 * de documentos de vehículos (ITV, ITS, Tarjeta de transporte).
 *
 * La lógica de "descartar" vive en localStorage con una clave
 * compuesta por vehicle_id + tipo + threshold. Al cruzar el
 * siguiente umbral (60 → 45 → 30 → 15 → vencida) la alerta
 * vuelve a aparecer aunque hubiera sido descartada antes.
 */

export const UMBRALES = [60, 45, 30, 15];

/**
 * Calcula la próxima fecha de ITV según normativa:
 * - Menos de 5 años desde matriculación: revisión anual
 * - 5 o más años: revisión semestral (cada 6 meses)
 */
export function calcProximaITV(fechaMatriculacion, fechaUltimaITV) {
  if (!fechaUltimaITV) return null;
  const matricula = fechaMatriculacion ? new Date(fechaMatriculacion) : null;
  const ultimaITV = new Date(fechaUltimaITV);
  const hoy = new Date();

  let mesesIntervalo = 12;
  if (matricula) {
    const edadAnios = (hoy - matricula) / (1000 * 60 * 60 * 24 * 365.25);
    if (edadAnios >= 5) mesesIntervalo = 6;
  }

  const proxima = new Date(ultimaITV);
  proxima.setMonth(proxima.getMonth() + mesesIntervalo);
  return proxima;
}

/** La ITS es anual desde la última realizada. */
export function calcProximaITS(fechaUltimaITS) {
  if (!fechaUltimaITS) return null;
  const proxima = new Date(fechaUltimaITS);
  proxima.setFullYear(proxima.getFullYear() + 1);
  return proxima;
}

/** Días que faltan (negativo = vencida) hasta una fecha. */
export function diasHasta(fecha) {
  if (!fecha) return null;
  return Math.ceil((new Date(fecha) - new Date()) / (1000 * 60 * 60 * 24));
}

export const TIPO_LABEL = {
  itv:                'ITV',
  its:                'ITS',
  tarjeta_transporte: 'Tarjeta de transporte',
};

export const TIPO_ICON = {
  itv:                '🔧',
  its:                '🩺',
  tarjeta_transporte: '🪪',
};

/**
 * Dado `dias_restantes`, devuelve el umbral "activo":
 *   vencida | 15 | 30 | 45 | 60 | null
 */
export function thresholdFor(dias) {
  if (dias < 0)   return 'vencida';
  if (dias <= 15) return 15;
  if (dias <= 30) return 30;
  if (dias <= 45) return 45;
  if (dias <= 60) return 60;
  return null;
}

/** Color hint por umbral (tailwind-ready) */
export function thresholdStyle(threshold) {
  switch (threshold) {
    case 'vencida': return { bg: 'bg-red-50 border-red-300',       text: 'text-red-700',    pill: 'bg-red-100 text-red-700 border-red-200' };
    case 15:        return { bg: 'bg-orange-50 border-orange-300', text: 'text-orange-700', pill: 'bg-orange-100 text-orange-700 border-orange-200' };
    case 30:        return { bg: 'bg-yellow-50 border-yellow-300', text: 'text-yellow-800', pill: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
    case 45:        return { bg: 'bg-blue-50 border-blue-300',     text: 'text-blue-800',   pill: 'bg-blue-100 text-blue-800 border-blue-200' };
    case 60:        return { bg: 'bg-blue-50 border-blue-200',     text: 'text-blue-700',   pill: 'bg-blue-50 text-blue-700 border-blue-100' };
    default:        return { bg: 'bg-neutral-50 border-neutral-200', text: 'text-neutral-700', pill: 'bg-neutral-100 text-neutral-700 border-neutral-200' };
  }
}

const KEY_PREFIX = 'alert_dismissed:';

export function dismissKey(a) {
  return `${KEY_PREFIX}${a.vehicle_id}:${a.tipo}:${a.threshold}`;
}

export function isDismissed(a) {
  try { return localStorage.getItem(dismissKey(a)) === '1'; }
  catch { return false; }
}

export function markDismissed(a) {
  try { localStorage.setItem(dismissKey(a), '1'); }
  catch { /* storage bloqueado → ignoramos */ }
}

export function unmarkDismissed(a) {
  try { localStorage.removeItem(dismissKey(a)); }
  catch { /* ignore */ }
}

/**
 * Limpia del localStorage descartes obsoletos que ya no se
 * corresponden con ninguna alerta "viva". Se ejecuta cuando
 * recibimos la lista del backend para mantener el storage limpio.
 */
export function pruneDismissals(alertasActivas) {
  try {
    const vivas = new Set(alertasActivas.map(dismissKey));
    const aBorrar = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX) && !vivas.has(k)) aBorrar.push(k);
    }
    for (const k of aBorrar) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

/** Devuelve todas las claves de descarte actuales */
export function listDismissals() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) out.push(k);
    }
  } catch { /* ignore */ }
  return out;
}

/** Borra TODOS los descartes */
export function clearAllDismissals() {
  try {
    for (const k of listDismissals()) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

/**
 * Toma el array devuelto por el backend y le añade `threshold`.
 * Filtra las entradas sin umbral activo (días_restantes > 60).
 */
export function withThresholds(alertas) {
  return (alertas || [])
    .map(a => ({ ...a, threshold: thresholdFor(a.dias_restantes) }))
    .filter(a => a.threshold !== null);
}
