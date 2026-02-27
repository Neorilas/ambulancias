import { format, parseISO, isValid, differenceInMinutes, isPast } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Formatea fecha/datetime para mostrar en UI
 */
export function formatDate(date, fmt = 'dd/MM/yyyy') {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (!isValid(d)) return '—';
  return format(d, fmt, { locale: es });
}

export function formatDateTime(date) {
  return formatDate(date, 'dd/MM/yyyy HH:mm');
}

export function formatDateTimeShort(date) {
  return formatDate(date, 'dd/MM HH:mm');
}

/**
 * Devuelve fecha en formato ISO para inputs type="datetime-local"
 */
export function toInputDatetime(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (!isValid(d)) return '';
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function toInputDate(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (!isValid(d)) return '';
  return format(d, 'yyyy-MM-dd');
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
