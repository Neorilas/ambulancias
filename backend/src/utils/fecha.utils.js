/**
 * utils/fecha.utils.js
 * Único sitio donde se calcula "la hora" en el backend.
 *
 * CONTRATO DE FECHAS DEL PROYECTO
 *   1. En MySQL todo instante se guarda en UTC. Las sesiones del pool fijan
 *      time_zone = '+00:00' (ver config/database.js), así que CURRENT_TIMESTAMP
 *      y las columnas TIMESTAMP también hablan UTC.
 *   2. El código NUNCA usa NOW() ni CURDATE(): calcula el instante aquí y lo
 *      manda como parámetro. Así hay un solo reloj (el del proceso Node) y una
 *      sola conversión (la que hace mysql2 con timezone '+00:00').
 *   3. La API devuelve ISO-8601 con Z. El frontend lo pinta en hora española.
 *
 * El motivo de la regla 2: mezclar NOW() (hora del servidor MySQL, que corría
 * en Europe/Madrid) con valores enviados ya en UTC dejaba las horas de inicio y
 * fin de asignación desplazadas +1h/+2h según la época del año.
 */

'use strict';

const ZONA_ESPANA = 'Europe/Madrid';

const _formateador = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_ESPANA,
  hour12:   false,
  year: 'numeric', month: '2-digit', day:    '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Partes de la fecha/hora tal y como se ven en España para un instante dado. */
function _partesEnEspana(instante) {
  const p = {};
  for (const { type, value } of _formateador.formatToParts(instante)) {
    if (type !== 'literal') p[type] = value;
  }
  return {
    anio:   Number(p.year),
    mes:    Number(p.month),
    dia:    Number(p.day),
    hora:   Number(p.hour) % 24,   // algunas ICU devuelven "24" para medianoche
    minuto: Number(p.minute),
    seg:    Number(p.second),
  };
}

/**
 * Desfase de España respecto a UTC, en minutos, para un instante dado.
 * +60 en invierno (CET), +120 en verano (CEST). Se calcula con la base de
 * datos de zonas horarias de ICU, así que los cambios de hora salen solos.
 */
function offsetEspanaMinutos(instante = new Date()) {
  const { anio, mes, dia, hora, minuto, seg } = _partesEnEspana(instante);
  const comoSiFueraUtc = Date.UTC(anio, mes - 1, dia, hora, minuto, seg);
  const instanteSinMs  = Math.floor(instante.getTime() / 1000) * 1000;
  return Math.round((comoSiFueraUtc - instanteSinMs) / 60000);
}

/**
 * El instante actual. Es LA forma de obtener "ahora" en todo el backend:
 * se pasa como parámetro a la query y mysql2 lo serializa a UTC.
 */
function ahora() {
  return new Date();
}

/**
 * Fecha del calendario español ('YYYY-MM-DD') para columnas DATE.
 * A las 00:30 de España el día ya ha cambiado aunque en UTC sean las 22:30.
 */
function fechaEnEspana(instante = new Date()) {
  const { anio, mes, dia } = _partesEnEspana(instante);
  const dd = (n) => String(n).padStart(2, '0');
  return `${anio}-${dd(mes)}-${dd(dia)}`;
}

/**
 * Instante real correspondiente a una hora de pared española.
 * `instanteEnEspana(2026, 9, 1)` = el momento en que dieron las 00:00 del 1 de
 * septiembre en España. Se calcula en dos pasadas para que salga bien también
 * en los fines de semana del cambio de hora.
 */
function instanteEnEspana(anio, mes, dia, hora = 0, minuto = 0, seg = 0) {
  const ingenuo = Date.UTC(anio, mes - 1, dia, hora, minuto, seg);
  const off1 = offsetEspanaMinutos(new Date(ingenuo));
  const off2 = offsetEspanaMinutos(new Date(ingenuo - off1 * 60000));
  return new Date(ingenuo - off2 * 60000);
}

/** Instante (UTC) en que empezó el día español que contiene `instante`. */
function inicioDelDiaEnEspana(instante = new Date()) {
  const { anio, mes, dia } = _partesEnEspana(instante);
  return instanteEnEspana(anio, mes, dia);
}

/** Año y mes del calendario español en curso. */
function anioMesEnEspana(instante = new Date()) {
  const { anio, mes } = _partesEnEspana(instante);
  return { anio, mes };
}

/**
 * El día español en curso como fecha "sin hora": medianoche UTC del día del
 * calendario. Es la forma de comparar contra columnas DATE, que mysql2
 * devuelve también como medianoche UTC de su día. Restar dos de estas da
 * siempre días enteros, viva el proceso en la zona que viva.
 */
function diaCalendarioEnEspana(instante = new Date()) {
  return new Date(`${fechaEnEspana(instante)}T00:00:00.000Z`);
}

/** Instante de hace `horas` horas. Para ventanas tipo "últimas 24h". */
function haceHoras(horas, instante = new Date()) {
  return new Date(instante.getTime() - horas * 60 * 60 * 1000);
}

/** 'dd/MM HH:mm' en hora española. Para mensajes de error que citan una hora. */
function diaYHoraEnEspana(instante) {
  const { mes, dia, hora, minuto } = _partesEnEspana(instante);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(dia)}/${dos(mes)} ${dos(hora)}:${dos(minuto)}`;
}

/**
 * Fecha que llega por la API → la forma que MySQL acepta en una DATETIME.
 * El frontend manda ya UTC sin zona ('YYYY-MM-DDTHH:mm', `toUtcIso`) y eso
 * se deja tal cual. Pero `isISO8601` da por buena también una ISO completa
 * con zona ('...:21.279Z', '+02:00'), y MySQL la rechaza con un 500
 * («Incorrect datetime value»). Si trae zona, se pasa a UTC y se le quita.
 * Se usa como `customSanitizer` detrás del `isISO8601` de las rutas.
 */
const CON_ZONA = /(Z|[+-]\d{2}:?\d{2})$/i;
function fechaApiAMysql(valor) {
  if (typeof valor !== 'string' || !CON_ZONA.test(valor.trim())) return valor;
  const d = new Date(valor.trim());
  if (Number.isNaN(d.getTime())) return valor;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Instante (Date) de una fecha que viene de la API o de la BD, para COMPARAR
 * o pasar como parámetro. Por contrato, una fecha sin zona es UTC — pero
 * `new Date('2026-09-25T08:00')` la toma como hora LOCAL del proceso, y el
 * backend de producción corre con TZ=Europe/Madrid (docker-compose.yml): se
 * desplazaba 1-2 h. Aquí se le añade la Z. Un Date (lo que devuelve mysql2)
 * o una fecha con zona se respetan tal cual.
 */
function instanteUtc(valor) {
  if (valor == null || valor instanceof Date) return valor;
  const txt = String(valor).trim();
  if (CON_ZONA.test(txt)) return new Date(txt);
  return new Date(`${txt.replace(' ', 'T')}Z`);
}

module.exports = {
  ZONA_ESPANA,
  fechaApiAMysql,
  instanteUtc,
  diaYHoraEnEspana,
  ahora,
  fechaEnEspana,
  instanteEnEspana,
  inicioDelDiaEnEspana,
  anioMesEnEspana,
  diaCalendarioEnEspana,
  haceHoras,
  offsetEspanaMinutos,
};
