/**
 * utils/almacen.js
 * Lo que la pantalla del almacén (pages/almacen/Almacen.jsx) necesita saber de
 * un producto o un movimiento, sin React: así se prueba solo.
 */

/** Días antes de caducar a partir de los cuales un lote sale en ámbar. */
export const CADUCA_PRONTO_DIAS = 60;

export const TIPOS_PRODUCTO = [
  { key: 'producto',   label: 'Material' },
  { key: 'medicacion', label: 'Medicación' },
];

export const TIPO_MOVIMIENTO = {
  entrada:           { label: 'Entrada',         clase: 'badge-green' },
  salida_ambulancia: { label: 'A ambulancia',    clase: 'badge-blue' },
  salida_otros:      { label: 'A otro sitio',    clase: 'badge-gray' },
  descarte:          { label: 'Descarte',        clase: 'badge-red' },
  ajuste:            { label: 'Recuento',        clase: 'badge-yellow' },
};

// Las presentaciones que ya usaba el AppSheet, para sugerirlas al dar de alta.
export const PRESENTACIONES = ['Unidad', 'Caja', 'Bote', 'Ampolla', 'Pastillas', 'Bolsa', 'Kit', 'Frasco'];

/** Hoy en España, 'YYYY-MM-DD'. */
export function hoyEnEspana(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ahora);
}

/** Días de `hoy` a `fecha` (las dos 'YYYY-MM-DD'); negativo si ya pasó. null sin fecha. */
export function diasHasta(fecha, hoy) {
  if (!fecha) return null;
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000);
}

/**
 * Cómo está la caducidad de un lote: 'caducado' (ya ha pasado el día),
 * 'pronto' (dentro de CADUCA_PRONTO_DIAS), 'ok' o null si no caduca.
 */
export function estadoCaducidad(fecha, hoy) {
  const d = diasHasta(fecha, hoy);
  if (d === null) return null;
  if (d < 0) return 'caducado';
  if (d <= CADUCA_PRONTO_DIAS) return 'pronto';
  return 'ok';
}

/** Clase de color del texto de una caducidad. */
export function claseCaducidad(fecha, hoy) {
  const e = estadoCaducidad(fecha, hoy);
  if (e === 'caducado') return 'text-bad-600 font-semibold';
  if (e === 'pronto') return 'text-warn-700 font-semibold';
  return 'text-neutral-700';
}

/** «caducado hace 3 días», «caduca en 12 días», «caduca hoy». */
export function textoCaducidad(fecha, hoy) {
  const d = diasHasta(fecha, hoy);
  if (d === null) return 'No caduca';
  if (d < 0) return `caducado hace ${-d} ${-d === 1 ? 'día' : 'días'}`;
  if (d === 0) return 'caduca hoy';
  return `caduca en ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** Por debajo del mínimo (un mínimo 0 es «sin mínimo»). */
export const bajoMinimo = (p) => p.stock_minimo > 0 && p.stock < p.stock_minimo;

/** Los filtros de estado del listado. */
export const FILTROS_ESTADO = [
  { key: '',          label: 'Todos' },
  { key: 'minimo',    label: 'Bajo mínimo',     cumple: (p) => p.activo && bajoMinimo(p) },
  { key: 'caducidad', label: 'Caduca pronto',   cumple: (p, hoy) => p.activo && ['caducado', 'pronto'].includes(estadoCaducidad(p.proxima_caducidad, hoy)) },
  { key: 'agotado',   label: 'Sin existencias', cumple: (p) => p.activo && p.stock <= 0 },
  { key: 'descuadre', label: 'Descuadrados',    cumple: (p) => p.lotes_negativos > 0 },
];

/** Para buscar sin tildes ni mayúsculas («mascarilla» encuentra «Máscarilla»). */
export function normalizar(t) {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Los productos que se ven con estos filtros, en orden alfabético.
 * Los retirados solo salen con `retirados`.
 */
export function filtrarProductos(productos, { q = '', tipo = '', estado = '', retirados = false }, hoy) {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  const filtro = FILTROS_ESTADO.find(f => f.key === estado)?.cumple;
  return productos.filter((p) => {
    if (!retirados && !p.activo) return false;
    if (tipo && p.tipo !== tipo) return false;
    if (filtro && !filtro(p, hoy)) return false;
    const nombre = normalizar(p.nombre);
    return palabras.every(w => nombre.includes(w));
  });
}

/** Cuántos productos activos hay en cada aviso, para los contadores de los filtros. */
export function resumenAvisos(productos, hoy) {
  const r = {};
  for (const f of FILTROS_ESTADO) if (f.cumple) r[f.key] = productos.filter(p => f.cumple(p, hoy)).length;
  return r;
}

/** Destino de un movimiento tal y como se pinta. */
export function destinoMovimiento(m) {
  if (m.tipo === 'salida_ambulancia') {
    return m.vehiculo_alias || m.vehiculo_matricula || m.destino || 'Ambulancia';
  }
  if (m.tipo === 'salida_otros') return m.destino || '—';
  return m.destino || '';
}

/** Cantidad con su signo: «+10», «−3». */
export function cantidadConSigno(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${-n}`;
  return '0';
}
