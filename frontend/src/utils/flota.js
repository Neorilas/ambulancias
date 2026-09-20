/**
 * utils/flota.js
 * Lo que el mapa de flota decide sin pedirle nada a nadie: cómo se llama y de
 * qué color va cada estado, qué entra en cada filtro y cómo se cuenta la
 * antigüedad de un dato.
 *
 * Está fuera de la página a propósito: los `pages/` no entran en el cómputo de
 * cobertura (se mide la lógica, no el render), y estas decisiones —sobre todo
 * la de qué se le enseña a quien busca una ambulancia— sí merecen tests.
 *
 * **Espejo de** `backend/src/utils/flota.utils.js`: los estados los calcula el
 * backend y aquí solo se pintan. Si allí se añade uno, aquí hay que darle
 * nombre y color o saldrá con la etiqueta en crudo.
 */

// ── Estados (los decide el backend; ver flota.utils.js) ───────────────────
export const ESTADOS = {
  MOVIMIENTO:      'movimiento',
  PARADO_CONTACTO: 'parado_contacto',
  APAGADO:         'apagado',
  SIN_SENAL:       'sin_senal',
  SIN_GPS:         'sin_gps',
};

/**
 * Nombre, badge y color de cada estado.
 *
 * El `color` es un hex literal y no una clase de Tailwind porque lo consume el
 * SVG del marcador de Leaflet, que se construye fuera de React: Tailwind
 * **purga** lo que no encuentra escrito en `src`, así que una clase compuesta
 * al vuelo (`bg-${x}-500`) no llegaría al CSS. Los valores son los de la
 * paleta de `tailwind.config.js`, no otros verdes parecidos.
 */
export const ESTADO_META = {
  [ESTADOS.MOVIMIENTO]:      { label: 'En movimiento', badge: 'badge-green',  color: '#3d9b5f' },
  [ESTADOS.PARADO_CONTACTO]: { label: 'Parado, en marcha', badge: 'badge-yellow', color: '#e0a53a' },
  [ESTADOS.APAGADO]:         { label: 'Apagado',       badge: 'badge-gray',   color: '#98a2b3' },
  [ESTADOS.SIN_SENAL]:       { label: 'Sin señal',     badge: 'badge-red',    color: '#d24545' },
  [ESTADOS.SIN_GPS]:         { label: 'Sin GPS',       badge: 'badge-gray',   color: '#cfd6e2' },
};

const META_POR_DEFECTO = { label: 'Desconocido', badge: 'badge-gray', color: '#cfd6e2' };

/** Cómo se pinta este estado. Un estado que no conocemos no rompe la pantalla. */
export function estadoMeta(estado) {
  return ESTADO_META[estado] || META_POR_DEFECTO;
}

// ── Filtros ───────────────────────────────────────────────────────────────

/**
 * Los filtros de la barra superior, en el orden en que se enseñan.
 *
 * «Sin vincular» junta los dos casos de fallo del cruce —nuestro vehículo sin
 * GPS y GPS sin vehículo nuestro— porque para quien mira el mapa son el mismo
 * problema: algo que no cuadra entre las dos listas y hay que arreglar. Los
 * ambiguos entran ahí también: una matrícula repetida es exactamente eso.
 */
export const FILTROS = [
  { key: 'todos',       label: 'Todos',         test: () => true },
  { key: 'movimiento',  label: 'En movimiento', test: (f) => f.estado === ESTADOS.MOVIMIENTO },
  { key: 'parados',     label: 'Parados',       test: (f) => f.estado === ESTADOS.PARADO_CONTACTO },
  { key: 'apagados',    label: 'Apagados',      test: (f) => f.estado === ESTADOS.APAGADO },
  { key: 'sin_senal',   label: 'Sin señal',     test: (f) => f.estado === ESTADOS.SIN_SENAL },
  { key: 'sin_vincular',label: 'Sin vincular',  test: (f) => f.vinculo !== 'vinculado' || f.ambigua },
];

/** Texto normalizado para buscar: sin acentos, sin separadores y en minúsculas. */
function normalizarBusqueda(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s.\-_]/g, '');
}

/**
 * Aplica filtro y buscador.
 *
 * El buscador mira alias, matrícula y responsable, y normaliza los dos lados:
 * quien busca una ambulancia escribe «1234 bcd» o «1234-BCD» según le pille el
 * día, y en la ficha está guardada como `1234BCD`.
 */
export function filtrarFlota(flota = [], { filtro = 'todos', busqueda = '' } = {}) {
  const test = (FILTROS.find(f => f.key === filtro) || FILTROS[0]).test;
  const q = normalizarBusqueda(busqueda);

  return flota.filter((f) => {
    if (!test(f)) return false;
    if (!q) return true;
    return [f.alias, f.matricula, f.asignacion?.responsable]
      .some(campo => campo && normalizarBusqueda(campo).includes(q));
  });
}

/** Cuenta cuántos hay de cada filtro, para poder enseñar el número en el botón. */
export function contarPorFiltro(flota = []) {
  return FILTROS.reduce((acc, f) => ({ ...acc, [f.key]: flota.filter(f.test).length }), {});
}

// ── Textos ────────────────────────────────────────────────────────────────

/**
 * Antigüedad del dato en palabras.
 *
 * Va SIEMPRE al lado de la posición, y no es un adorno: un mapa que pinta un
 * punto sin decir de cuándo es invita a creer que la ambulancia está ahí ahora
 * mismo, y puede llevar dos horas sin dar señal desde un sótano.
 */
export function textoUltimoDato(minutos) {
  if (minutos === null || minutos === undefined) return 'sin fecha';
  if (minutos < 1) return 'ahora mismo';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) return resto ? `hace ${horas} h ${resto} min` : `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}

/** Velocidad en km/h, o un guion si no la sabemos. */
export function textoVelocidad(velocidad) {
  if (velocidad === null || velocidad === undefined) return '—';
  return `${Math.round(velocidad)} km/h`;
}

/** Kilómetros con separador de miles, o un guion. */
export function textoKilometros(km) {
  if (km === null || km === undefined) return '—';
  return `${Number(km).toLocaleString('es-ES')} km`;
}

/** Los que se pueden pintar en el mapa: sin coordenadas no hay marcador. */
export function conPosicion(flota = []) {
  return flota.filter(f => f.gps && f.gps.lat !== null && f.gps.lng !== null);
}

/**
 * De dónde sale el dato, en una frase para la cabecera.
 * `fuente` es lo que manda `GET /flota/ubicaciones`.
 */
export function textoFuente(fuente) {
  if (!fuente) return '';
  if (!fuente.configurado) return 'Sin GPS configurado en este entorno';
  if (fuente.origen === 'cache-vieja') return `Cartrack no responde — última posición conocida`;
  if (fuente.origen === 'ninguno') return 'Cartrack no responde';
  return 'Datos en vivo';
}
