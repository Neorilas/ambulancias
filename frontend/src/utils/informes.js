/**
 * utils/informes.js
 * Cuentas de la pantalla de informes. El backend manda recuentos, no
 * porcentajes: así un mes archivado y uno en vivo se comparan igual, y el
 * denominador de cada tasa se decide en un solo sitio (aquí).
 */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'YYYY-MM' → 'septiembre de 2026'. */
export function nombreMes(mes) {
  if (!mes) return '';
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/** Tanto por ciento (número, 1 decimal) o null si no hay denominador. */
export function pct(n, total) {
  if (n == null || !total) return null;
  return Math.round((n / total) * 1000) / 10;
}

/** Incidencias por cada 100 servicios. */
export function por100(n, servicios) {
  return pct(n, servicios);
}

/**
 * Las métricas del resumen: cómo se sacan de un resumen y si subir es bueno.
 * `tipo`: 'pct' se compara en puntos; 'num' y 'min' en diferencia absoluta.
 * `mejorSiBaja`: el color de la variación (menos retrasos = bien).
 */
export const METRICAS = {
  inicios_tardios:   { valor: r => pct(r.inicios_tardios, r.iniciados),        tipo: 'pct', mejorSiBaja: true },
  retraso_mediana:   { valor: r => r.retraso_mediana_min,                      tipo: 'min', mejorSiBaja: true },
  sin_iniciar:       { valor: r => r.sin_iniciar,                              tipo: 'num', mejorSiBaja: true },
  desplazamiento:    { valor: r => r.desplazamiento_mediana_min,               tipo: 'min', mejorSiBaja: true },
  cierres_tardios:   { valor: r => pct(r.cierres_tardios, r.finalizados),      tipo: 'pct', mejorSiBaja: true },
  cierres_anticipados: { valor: r => pct(r.cierres_anticipados, r.finalizados), tipo: 'pct', mejorSiBaja: true },
  inc_nuevas:        { valor: r => r.incidencias?.nuevas,                      tipo: 'num', mejorSiBaja: true },
  inc_por100:        { valor: r => por100(r.incidencias?.nuevas, r.servicios), tipo: 'num', mejorSiBaja: true },
  inc_graves:        { valor: r => r.incidencias?.graves,                      tipo: 'num', mejorSiBaja: true },
  inc_abiertas:      { valor: r => r.incidencias?.abiertas_fin,                tipo: 'num', mejorSiBaja: true },
  inc_resolucion:    { valor: r => r.incidencias?.resolucion_mediana_horas,    tipo: 'num', mejorSiBaja: true },
  con_llegada:       { valor: r => pct(r.con_llegada, r.iniciados),            tipo: 'pct', mejorSiBaja: false },
  fotos_tarde:       { valor: r => pct(r.con_fotos_inicio_tarde, r.iniciados), tipo: 'pct', mejorSiBaja: true },
};

/** Valor de una métrica en un resumen, o null si no se puede calcular. */
export function valorMetrica(clave, resumen) {
  if (!resumen) return null;
  const v = METRICAS[clave].valor(resumen);
  return v == null || Number.isNaN(v) ? null : v;
}

/**
 * Variación de una métrica frente a otro resumen.
 * Devuelve null si falta alguno de los dos valores, o
 * `{ diff, texto, sentido }` con sentido 'mejor' | 'peor' | 'igual'.
 */
export function variacion(clave, actual, previo) {
  // Un mes sin un solo servicio no es «cero incidencias», es «no hay con qué
  // comparar» (antes de usar la app, o un mes vacío): «+2» engañaría.
  if (!previo?.servicios) return null;
  const a = valorMetrica(clave, actual);
  const b = valorMetrica(clave, previo);
  if (a == null || b == null) return null;
  const { tipo, mejorSiBaja } = METRICAS[clave];
  const diff = Math.round((a - b) * 10) / 10;
  if (diff === 0) return { diff, texto: '=', sentido: 'igual' };
  const signo = diff > 0 ? '+' : '−';
  const abs = Math.abs(diff).toLocaleString('es-ES');
  const unidad = tipo === 'pct' ? ' pt' : tipo === 'min' ? ' min' : '';
  const sube = diff > 0;
  return { diff, texto: `${signo}${abs}${unidad}`, sentido: sube === mejorSiBaja ? 'peor' : 'mejor' };
}

/** Número para pintar: «—» si no hay dato. */
export function fmt(v, sufijo = '') {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Number(v).toLocaleString('es-ES')}${sufijo}`;
}

/** Minutos → «1 h 35 min» / «20 min». */
export function fmtMin(min) {
  if (min == null) return '—';
  if (Math.abs(min) < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
