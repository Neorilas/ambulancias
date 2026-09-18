import { format, parseISO, isValid, differenceInMinutes, isPast } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * CONTRATO DE FECHAS
 *   La API habla siempre en UTC (ISO con Z). Aquí se pinta y se lee SIEMPRE en
 *   hora española, no en la del dispositivo: un técnico con el móvil en otra
 *   zona (o mal configurado) tiene que ver la misma hora que la oficina.
 *   El backend hace lo propio en utils/fecha.utils.js.
 */
const ZONA_ESPANA = 'Europe/Madrid';

const _formateador = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_ESPANA,
  hour12:   false,
  year: 'numeric', month: '2-digit', day:    '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Desfase de España respecto a UTC en minutos (+60 invierno, +120 verano). */
function offsetEspanaMinutos(instante) {
  const p = {};
  for (const { type, value } of _formateador.formatToParts(instante)) {
    if (type !== 'literal') p[type] = value;
  }
  const comoSiFueraUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second)
  );
  const instanteSinMs = Math.floor(instante.getTime() / 1000) * 1000;
  return Math.round((comoSiFueraUtc - instanteSinMs) / 60000);
}

/**
 * Traslada un instante para que los getters locales de date-fns lean la hora
 * española. Si el navegador ya va en hora española el desplazamiento es 0.
 */
function aHoraEspanola(instante) {
  const desfase = offsetEspanaMinutos(instante) + instante.getTimezoneOffset();
  return new Date(instante.getTime() + desfase * 60000);
}

/** Inverso de `aHoraEspanola`: de hora de pared española al instante real. */
function desdeHoraEspanola(pared) {
  const desfase = offsetEspanaMinutos(pared) + pared.getTimezoneOffset();
  const aprox   = new Date(pared.getTime() - desfase * 60000);
  const ajuste  = offsetEspanaMinutos(aprox) + pared.getTimezoneOffset();
  return new Date(pared.getTime() - ajuste * 60000);
}

function aInstante(date) {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isValid(d) ? d : null;
}

/**
 * Formatea fecha/datetime para mostrar en UI, siempre en hora española.
 */
export function formatDate(date, fmt = 'dd/MM/yyyy') {
  if (!date) return '—';
  const d = aInstante(date);
  if (!d) return '—';
  return format(aHoraEspanola(d), fmt, { locale: es });
}

export function formatDateTime(date) {
  return formatDate(date, 'dd/MM/yyyy HH:mm');
}

export function formatDateTimeShort(date) {
  return formatDate(date, 'dd/MM HH:mm');
}

/**
 * Convierte el "yyyy-MM-ddTHH:mm" de un input datetime-local a UTC ISO sin
 * segundos, que es como lo guarda la API. Lo que el usuario teclea se
 * interpreta como hora ESPAÑOLA, no como la del dispositivo.
 */
export function toUtcIso(localStr) {
  if (!localStr) return localStr;
  const pared = parseISO(localStr);
  if (!isValid(pared)) return localStr;
  return desdeHoraEspanola(pared).toISOString().slice(0, 16);
}

/**
 * Devuelve fecha en formato ISO para inputs type="datetime-local",
 * en hora española (contrapartida exacta de toUtcIso).
 */
export function toInputDatetime(date) {
  if (!date) return '';
  const d = aInstante(date);
  if (!d) return '';
  return format(aHoraEspanola(d), "yyyy-MM-dd'T'HH:mm");
}

export function toInputDate(date) {
  if (!date) return '';
  const d = aInstante(date);
  if (!d) return '';
  return format(aHoraEspanola(d), 'yyyy-MM-dd');
}

/**
 * ¿El trabajo está en fecha (debería haber empezado)?
 */
export function isWorkActive(trabajo) {
  const now    = new Date();
  const inicio = parseISO(trabajo.fecha_inicio);
  const fin    = parseISO(trabajo.fecha_fin);
  return now >= inicio && now <= fin;
}

/**
 * ¿La fecha_fin ya pasó?
 */
export function isOverdue(trabajo) {
  return isPast(parseISO(trabajo.fecha_fin));
}

/**
 * Duración en texto legible
 */
export function duration(inicio, fin) {
  const d = typeof inicio === 'string' ? parseISO(inicio) : inicio;
  const f = typeof fin    === 'string' ? parseISO(fin)    : fin;
  const mins = differenceInMinutes(f, d);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}min`;
}
