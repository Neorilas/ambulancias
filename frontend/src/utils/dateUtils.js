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
 * Día del calendario español ('yyyy-MM-dd') en que cae un instante.
 * Para agrupar por días sin que la zona del dispositivo mueva la frontera.
 */
export function diaEnEspana(date) {
  const d = aInstante(date);
  if (!d) return '';
  return format(aHoraEspanola(d), 'yyyy-MM-dd');
}

/**
 * Formatea un valor que es una FECHA SOLA, sin hora: una caducidad de ITV, un
 * día de servicio. No lleva instante asociado, así que no se convierte de zona
 * — se lee tal cual. Pasarlo por `new Date(...).toLocaleDateString()` hacía que
 * un dispositivo al oeste de UTC mostrara el día anterior.
 */
export function formatFechaSola(valor) {
  const s = aDiaCalendario(valor);
  if (!s) return '—';
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/**
 * Normaliza a 'yyyy-MM-dd' lo que llegue: la propia cadena, un ISO completo o
 * un Date (del que se toma su día español). Devuelve null si no hay nada
 * aprovechable — así un valor inesperado no tumba la página entera, que es lo
 * que pasa si `parseISO` recibe algo que no es una cadena.
 */
function aDiaCalendario(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isValid(valor) ? diaEnEspana(valor) : null;
  if (typeof valor !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(valor);
  return m ? m[1] : null;
}

/**
 * Formatea un 'yyyy-MM-dd' (día del calendario, sin hora) con un patrón de
 * date-fns. No convierte de zona: parseISO deja ese mismo día en el reloj
 * local, así que el nombre del día siempre es el que toca.
 */
export function formatDiaCalendario(dia, fmt = 'dd/MM/yyyy') {
  const s = aDiaCalendario(dia);
  if (!s) return '—';
  const d = parseISO(s);
  if (!isValid(d)) return '—';
  return format(d, fmt, { locale: es });
}

/** Suma días a un 'yyyy-MM-dd' y devuelve otro 'yyyy-MM-dd'. */
export function sumarDias(dia, n) {
  const s = aDiaCalendario(dia);
  if (!s) return dia;
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return format(d, 'yyyy-MM-dd');
}

/** Suma meses a un 'yyyy-MM-dd' y devuelve otro 'yyyy-MM-dd'. */
export function sumarMeses(dia, n) {
  const s = aDiaCalendario(dia);
  if (!s) return dia;
  const d = parseISO(s);
  d.setMonth(d.getMonth() + n);
  return format(d, 'yyyy-MM-dd');
}

/**
 * Días de calendario que faltan hasta `dia` ('yyyy-MM-dd') contando desde hoy
 * en España. Negativo si ya pasó. Al ser aritmética de calendario, no la
 * descoloca ni la zona del dispositivo ni el cambio de hora.
 */
export function diasHasta(dia, desde = diaEnEspana(new Date())) {
  const sa = aDiaCalendario(desde);
  const sb = aDiaCalendario(dia);
  if (!sa || !sb) return null;
  const a = parseISO(sa);
  const b = parseISO(sb);
  if (!isValid(a) || !isValid(b)) return null;
  const MS_DIA = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
     Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / MS_DIA
  );
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
