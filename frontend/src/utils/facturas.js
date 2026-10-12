/**
 * utils/facturas.js
 * Lo que comparten la pantalla de Facturas, el popup de subida y las facturas
 * de mantenimiento de la ficha del vehículo (MAPA_CODIGO.md §2.8).
 */

/** Tipos de `vehicle_revisiones`, como se pintan. */
export const TIPO_REVISION_LABELS = {
  itv:                 'ITV',
  its:                 'ITS',
  mantenimiento:       'Mantenimiento',
  revision_preventiva: 'Revisión preventiva',
  reparacion:          'Reparación',
  otro:                'Otro',
};

const euros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const fmtEuros = (n) => (n === null || n === undefined ? '—' : euros.format(n));

export function fmtTamano(bytes) {
  if (!bytes && bytes !== 0) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** El mismo nombre que pone el backend (`nombreDescarga`), para que la descarga se llame igual. */
export function nombreDescarga(f) {
  const limpio = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `Factura_${limpio(f.proveedor) || 'proveedor'}_${limpio(f.numero) || f.id}.pdf`;
}
