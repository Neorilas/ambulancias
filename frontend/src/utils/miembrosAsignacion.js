/**
 * utils/miembrosAsignacion.js
 * Quién va en una asignación: 1..N responsables y 0..N personal (v23).
 *
 * Los responsables activan, evidencian y cierran; el personal solo VE la
 * asignación. Ese reparto lo impone el backend (`rolEnAsignacion`); aquí solo
 * está lo que necesita la pantalla para no ofrecer lo que luego se rechazaría.
 *
 * PROVISIONAL el `personal`: se retira cuando exista Trabajos
 * (trabajo → vehículos → personal). Ver docs/MAPA_CODIGO.md §7.
 */

/** Ids de los miembros elegidos, sin huecos (filas del formulario sin rellenar). */
export function idsElegidos(lista) {
  return (lista || [])
    .map(v => parseInt(v, 10))
    .filter(n => Number.isInteger(n) && n > 0);
}

/**
 * Usuarios que se pueden ofrecer en una fila: los activos que no estén ya en
 * NINGUNA de las dos listas, salvo el que ocupa esa misma fila (si no, el
 * combobox no podría mostrar su propio valor).
 */
export function usuariosDisponibles(users, ocupados, propio) {
  const fuera   = new Set(idsElegidos(ocupados));
  const propioN = parseInt(propio, 10);
  return (users || []).filter(u =>
    u.id === propioN || (u.activo !== false && u.activo !== 0 && !fuera.has(u.id)));
}

/** Estado inicial del formulario a partir de una asignación completa (o ninguna). */
export function miembrosIniciales(asignacion) {
  if (!asignacion) return { responsables: [''], personal: [] };
  const responsables = (asignacion.responsables || []).map(r => r.id);
  return {
    // Una asignación anterior a v23 sin miembros cargados: su user_id.
    responsables: responsables.length ? responsables : [asignacion.user_id || ''],
    personal:     (asignacion.personal || []).map(p => p.id),
  };
}

/** ¿Se puede añadir otra fila? Solo cuando todas las que hay están rellenas. */
export function puedeAnadir(lista) {
  return (lista || []).every(v => idsElegidos([v]).length === 1);
}

/**
 * Texto de los solapes que devuelve el backend al guardar. Es un aviso: la
 * asignación ya se ha guardado.
 */
export function textoSolapes(solapes) {
  if (!Array.isArray(solapes) || !solapes.length) return null;
  const nombres = [...new Set(solapes.map(s => s.nombre).filter(Boolean))];
  const quien = nombres.length === 1 ? nombres[0] : nombres.join(', ');
  return `Aviso: ${quien} ${nombres.length === 1 ? 'ya tiene' : 'ya tienen'} otra asignación en esas fechas`;
}

/** «Ana Ruiz» o «Ana Ruiz +2» para listas compactas. */
export function resumenNombres(nombresCsv) {
  const nombres = (nombresCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!nombres.length) return null;
  return nombres.length === 1 ? nombres[0] : `${nombres[0]} +${nombres.length - 1}`;
}

/**
 * Papel del usuario en la asignación completa: 'responsable', 'personal' o
 * null. Espejo de `rolEnAsignacion` del backend, que es quien manda.
 */
export function rolEnAsignacion(asig, userId) {
  if (!asig || userId == null) return null;
  const responsables = asig.responsables || [];
  if (responsables.some(r => r.id === userId))       return 'responsable';
  if ((asig.personal || []).some(p => p.id === userId)) return 'personal';
  if (!responsables.length && asig.user_id === userId) return 'responsable';
  return null;
}

/** Nombre completo de un miembro. */
export function nombreMiembro(m) {
  return [m?.nombre, m?.apellidos].filter(Boolean).join(' ') || m?.username || '';
}
