/**
 * utils/jornadas.js
 * El horario por días de un trabajo de varios días (v39) y las jornadas que
 * ficha cada ambulancia. Reglas en §6.1 «Jornadas por día» del mapa.
 *
 * En el formulario el horario va por DÍAS, que es como lo piensa quien lo
 * rellena: `[{ dia: 'yyyy-MM-dd', tramos: [{ desde: 'HH:mm', hasta: 'HH:mm' }] }]`,
 * en hora española. Un tramo cuyo `hasta` no es posterior a `desde` acaba al
 * día siguiente (una noche de maniobras de 20:00 a 02:00). La API, en cambio,
 * habla en tramos con instantes UTC (`[{ inicio, fin }]`): `horarioDesdeApi` y
 * `horarioAPayload` son el puente.
 */

import { diaEnEspana, formatHora, formatDiaCalendario, sumarDias, toUtcIso, toInputDatetime } from './dateUtils.js';
import { INICIO_ANTICIPADO_MAX_MINUTOS, FIN_JORNADA_ANTICIPADO_MINUTOS } from './constants.js';

/** Horas que propone «Rellenar días» si no se dice otra cosa. */
export const DESDE_POR_DEFECTO = '09:00';
export const HASTA_POR_DEFECTO = '21:00';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Tope de tramos de un horario. Espejo de MAX_TRAMOS de backend jornadas.service. */
export const MAX_TRAMOS = 62;

/** ¿El tramo acaba al día siguiente? (hasta ≤ desde) */
export const pasaMedianoche = (t) => !!t.desde && !!t.hasta && t.hasta <= t.desde;

/** Los días de calendario ('yyyy-MM-dd') que toca un intervalo del formulario ('yyyy-MM-ddTHH:mm'). */
export function diasEntre(inicioLocal, finLocal) {
  if (!inicioLocal || !finLocal || finLocal <= inicioLocal) return [];
  const primero = inicioLocal.slice(0, 10);
  // Lo que acaba justo a medianoche no ocupa el día siguiente
  const ultimo = finLocal.slice(11, 16) === '00:00' ? sumarDias(finLocal.slice(0, 10), -1) : finLocal.slice(0, 10);
  const dias = [];
  for (let d = primero; d <= ultimo && dias.length < 62; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

/** ¿El intervalo ocupa más de un día? Es cuando el formulario ofrece el horario. */
export const cruzaDias = (inicioLocal, finLocal) => diasEntre(inicioLocal, finLocal).length > 1;

/** Un tramo del formulario → sus dos extremos en hora local ('yyyy-MM-ddTHH:mm'). */
function extremos(dia, t) {
  return {
    inicio: `${dia}T${t.desde}`,
    fin:    `${pasaMedianoche(t) ? sumarDias(dia, 1) : dia}T${t.hasta}`,
  };
}

/**
 * «Rellenar días»: un tramo `desde`–`hasta` por cada día del intervalo. Los
 * días que ya estaban rellenos se conservan como estaban.
 */
export function rellenarDias(horario, inicioLocal, finLocal, desde = DESDE_POR_DEFECTO, hasta = HASTA_POR_DEFECTO) {
  const previos = new Map((horario || []).map(d => [d.dia, d]));
  const dias = diasEntre(inicioLocal, finLocal);
  return dias.map((dia) => {
    if (previos.has(dia)) return previos.get(dia);
    // El primer y el último día, recortados a la hora de inicio y de fin: si
    // no, el tramo propuesto ya se saldría de las fechas (lo vio la prueba
    // local del 2026-10-18). Un tramo que pasa de medianoche no se recorta.
    let d = desde;
    let h = hasta;
    if (dia === inicioLocal.slice(0, 10) && `${dia}T${d}` < inicioLocal) d = inicioLocal.slice(11, 16);
    if (dia === finLocal.slice(0, 10) && h > d && `${dia}T${h}` > finLocal) h = finLocal.slice(11, 16);
    // Recortado, un tramo normal que se queda sin hueco (el trabajo empieza
    // después de la hora de fin del día) no se propone
    if (hasta > desde && h <= d) return null;
    return { dia, tramos: [{ desde: d, hasta: h }] };
  }).filter(Boolean);
}

/**
 * De la API (`[{inicio, fin, ...}]` en UTC, el horario del trabajo o las
 * jornadas de una ambulancia) al formulario. Lo que ya se fichó viaja con
 * `fichada` para que el editor no deje tocarlo.
 */
export function horarioDesdeApi(lista) {
  const porDia = new Map();
  for (const j of lista || []) {
    const dia = diaEnEspana(j.inicio);
    if (!porDia.has(dia)) porDia.set(dia, { dia, tramos: [] });
    porDia.get(dia).tramos.push({
      desde: formatHora(j.inicio),
      hasta: formatHora(j.fin),
      ...(j.inicio_real_at ? { fichada: true } : {}),
    });
  }
  return [...porDia.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1));
}

/** Del formulario a lo que manda la API: tramos con instantes UTC. */
export function horarioAPayload(horario) {
  return (horario || []).flatMap(d => d.tramos.map(t => {
    const { inicio, fin } = extremos(d.dia, t);
    return { inicio: toUtcIso(inicio), fin: toUtcIso(fin) };
  }));
}

/**
 * Por qué no se puede guardar el horario (o null). Lo mismo que mira el
 * backend (`leerHorario`), para no enterarse con un 400: horas completas,
 * sin solapes, dentro de las fechas de quien lo lleva.
 */
export function errorHorario(horario, inicioLocal, finLocal) {
  const total = (horario || []).reduce((n, d) => n + d.tramos.length, 0);
  if (total > MAX_TRAMOS) return `El horario admite como mucho ${MAX_TRAMOS} tramos (lleva ${total})`;
  const tramos = [];
  for (const d of horario || []) {
    if (!d.tramos.length) return `El ${formatDiaCalendario(d.dia, 'dd/MM')} no tiene ningún tramo: quítalo o añade uno`;
    for (const t of d.tramos) {
      if (!HORA.test(t.desde || '') || !HORA.test(t.hasta || '')) {
        return `Completa las horas del ${formatDiaCalendario(d.dia, 'dd/MM')}`;
      }
      if (t.desde === t.hasta) return `Un tramo del ${formatDiaCalendario(d.dia, 'dd/MM')} empieza y acaba a la misma hora`;
      tramos.push({ dia: d.dia, ...extremos(d.dia, t) });
    }
  }
  tramos.sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  for (let i = 1; i < tramos.length; i++) {
    if (tramos[i].inicio < tramos[i - 1].fin) {
      return `Dos tramos del ${formatDiaCalendario(tramos[i - 1].dia, 'dd/MM')} se solapan`;
    }
  }
  const fuera = tramos.find(t => (inicioLocal && t.inicio < inicioLocal) || (finLocal && t.fin > finLocal));
  if (fuera) {
    return `El tramo del ${formatDiaCalendario(fuera.dia, 'dd/MM')} se sale de las fechas de inicio y fin`;
  }
  return null;
}

/**
 * Los días del horario del trabajo que tocan las fechas de una ambulancia: lo
 * que heredará si va «igual que el trabajo» (mismo criterio que
 * `tramosDentro` del backend).
 */
export function horarioDentro(horario, inicioLocal, finLocal) {
  if (!inicioLocal || !finLocal) return [];
  return (horario || [])
    .map(d => ({ ...d, tramos: d.tramos.filter(t => {
      const { inicio, fin } = extremos(d.dia, t);
      return inicio < finLocal && fin > inicioLocal;
    }) }))
    .filter(d => d.tramos.length);
}

/** El horario del trabajo de la API, en hora local de formulario, recortado a unas fechas. */
export function horarioDelTrabajoPara(trabajoHorario, fechaInicio, fechaFin) {
  return horarioDentro(horarioDesdeApi(trabajoHorario), toInputDatetime(fechaInicio), toInputDatetime(fechaFin));
}

/** «Lun 20/10» */
export const etiquetaDia = (dia) => {
  const t = formatDiaCalendario(dia, 'EEE dd/MM');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** «10:00–14:00 y 15:00–23:00» */
export const textoTramos = (tramos) =>
  (tramos || []).map(t => `${t.desde}–${t.hasta}${pasaMedianoche(t) ? ' (+1 día)' : ''}`).join(' y ');

// ── Las jornadas de una ambulancia (fichaje) ─────────────────────────────────

/** Situación de una jornada fichable, en palabras de campo. */
export function situacionJornada(j, ahora = new Date()) {
  if (j.fin_real_at) return j.cierre_auto ? 'cerrada_sola' : 'hecha';
  if (j.inicio_real_at) return 'en_curso';
  return new Date(j.fin) <= ahora ? 'no_consta' : 'pendiente';
}

/**
 * La jornada sobre la que hay que actuar ahora: la que está en curso o, si
 * no, la primera pendiente que aún no ha terminado. null si no queda ninguna.
 */
export function jornadaDelMomento(jornadas, ahora = new Date()) {
  const lista = jornadas || [];
  return lista.find(j => j.inicio_real_at && !j.fin_real_at)
    || lista.find(j => !j.inicio_real_at && new Date(j.fin) > ahora)
    || null;
}

/** Cuántas jornadas están cerradas (a mano o solas) de cuántas hay. */
export function cuentaJornadas(jornadas) {
  const lista = jornadas || [];
  return { hechas: lista.filter(j => j.fin_real_at).length, total: lista.length };
}

/** «Lun 20/10, 10:00–14:00»: una jornada fichable, para botones y avisos. */
export function textoJornada(j) {
  const t = { desde: formatHora(j.inicio), hasta: formatHora(j.fin) };
  return `${etiquetaDia(diaEnEspana(j.inicio))}, ${textoTramos([t])}`;
}

/**
 * Resumen de las jornadas de una ambulancia, venga de la ficha (`jornadas`) o
 * de la tarjeta de «Mis trabajos» (`num_jornadas`, `jornadas_hechas`,
 * `en_jornada`). `total` 0 = ficha por «evento/servicio», como siempre.
 */
export function resumenJornadas(a) {
  if (Array.isArray(a?.jornadas)) {
    return { total: a.jornadas.length, hechas: a.jornadas.filter(j => j.fin_real_at).length,
             enCurso: a.jornadas.some(j => j.inicio_real_at && !j.fin_real_at) };
  }
  return { total: Number(a?.num_jornadas || 0), hechas: Number(a?.jornadas_hechas || 0), enCurso: !!a?.en_jornada };
}

/** Desde cuándo se puede pulsar «Inicio de jornada» (media hora antes, como el de la asignación). */
export const inicioJornadaDesde = (j) =>
  new Date(new Date(j.inicio).getTime() - INICIO_ANTICIPADO_MAX_MINUTOS * 60000);

/** ¿«Fin de jornada» ahora pediría motivo? (más de 30 min antes de lo previsto) */
export const finJornadaAnticipado = (j, ahora = new Date()) =>
  ahora < new Date(new Date(j.fin).getTime() - FIN_JORNADA_ANTICIPADO_MINUTOS * 60000);

/**
 * Qué botón de jornada toca ahora, con la misma regla que el backend:
 *  - `abierta`: la iniciada sin cerrar; `siguiente`: la primera sin iniciar
 *    que aún no ha terminado.
 *  - `principal`: 'fin' si hay una abierta dentro de su horario; si no,
 *    'inicio' si la siguiente ya se puede iniciar (aunque haya una abierta
 *    que ya pasó su hora: al iniciar se cierra sola, decisión del usuario),
 *    'fin' si queda una abierta, 'esperar' si solo queda una que todavía no
 *    se puede iniciar, o null si no queda nada.
 */
export function accionJornada(jornadas, ahora = new Date()) {
  const lista = jornadas || [];
  const abierta = lista.find(j => j.inicio_real_at && !j.fin_real_at) || null;
  const siguiente = lista.find(j => !j.inicio_real_at && new Date(j.fin) > ahora
    && (!abierta || new Date(j.inicio) > new Date(abierta.inicio))) || null;
  const siguienteYa = !!siguiente && ahora >= inicioJornadaDesde(siguiente);
  // Una abierta que aún está en su horario se está trabajando: primero su fin
  // (el backend no la cierra sola; solo a la que ya pasó su hora, el olvido)
  const abiertaEnCurso = !!abierta && new Date(abierta.fin) > ahora;
  let principal = null;
  if (abiertaEnCurso) principal = 'fin';
  else if (siguienteYa) principal = 'inicio';
  else if (abierta) principal = 'fin';
  else if (siguiente) principal = 'esperar';
  return { abierta, siguiente, principal };
}

