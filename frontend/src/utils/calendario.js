import { diaEnEspana } from './dateUtils.js';

/**
 * El calendario de «Mis trabajos» (pestaña Calendario). Todo en días del
 * calendario ESPAÑOL ('yyyy-MM-dd') y meses 'yyyy-MM', nunca en Date del
 * dispositivo: un móvil en otra zona tiene que ver el servicio en el mismo
 * día que la oficina. Las entradas las da `GET /trabajos/mi-calendario`.
 */

const MES_RE = /^(\d{4})-(\d{2})$/;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es un 'yyyy-MM-dd' bien formado? Para lo que llega por la URL. */
export function esDiaValido(dia) {
  if (typeof dia !== 'string' || !DIA_RE.test(dia)) return false;
  const [a, m, d] = dia.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
}

/** 'yyyy-MM' ± n meses. */
export function sumarMes(mes, n) {
  const [, a, m] = MES_RE.exec(mes);
  const total = Number(a) * 12 + (Number(m) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Las celdas del mes, de lunes a domingo: `null` para los huecos antes del
 * día 1 y 'yyyy-MM-dd' para cada día.
 */
export function cuadriculaMes(mes) {
  const [, a, m] = MES_RE.exec(mes);
  const diasEnMes = new Date(Date.UTC(Number(a), Number(m), 0)).getUTCDate();
  const huecos    = (new Date(Date.UTC(Number(a), Number(m) - 1, 1)).getUTCDay() + 6) % 7; // 0 = lunes
  return [
    ...Array(huecos).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`),
  ];
}

/**
 * Primer y último día que ocupa una entrada. Lo que acaba justo a medianoche
 * no ocupa el día siguiente: un servicio de 20:00 a 00:00 es de un solo día
 * (por eso se mira el fin menos un milisegundo).
 */
export function diasDeEntrada(e) {
  const primero = diaEnEspana(e.fecha_inicio);
  const fin     = new Date(e.fecha_fin).getTime();
  const ultimo  = fin > new Date(e.fecha_inicio).getTime() ? diaEnEspana(new Date(fin - 1)) : primero;
  return [primero, ultimo < primero ? primero : ultimo];
}

/** Las entradas que pisan `dia`, en el orden en que llegan (por inicio). */
export function entradasDelDia(entradas, dia) {
  return entradas.filter(e => {
    const [primero, ultimo] = diasDeEntrada(e);
    return primero <= dia && dia <= ultimo;
  });
}

/**
 * En qué punto está, para el color: lo que cuenta es SU ambulancia si va en
 * una (su parte puede haber terminado con el trabajo aún abierto), y si no, el
 * trabajo.
 */
export function situacionEntrada(e) {
  const estado = e.asignacion_estado || e.trabajo_estado;
  if (estado === 'programada' || estado === 'programado') return 'programado';
  if (['finalizada', 'finalizado', 'finalizado_anticipado'].includes(estado)) return 'terminado';
  return 'en_curso';
}

export const SITUACIONES = {
  programado: { texto: 'Programado', punto: 'bg-warn-500' },
  en_curso:   { texto: 'En curso',   punto: 'bg-primary-600' },
  terminado:  { texto: 'Terminado',  punto: 'bg-ok-500' },
};

/** Qué pinta él en esa entrada, en una frase. */
export function textoPapel(e) {
  switch (e.mi_papel) {
    case 'responsable':    return `Llevas ${e.vehiculo}`;
    case 'equipo':         return `Vas en el equipo de ${e.vehiculo}`;
    case 'coordinador':    return 'Coordinas este trabajo';
    case 'equipo_trabajo': return 'Estás en el equipo del trabajo';
    default:               return 'Vas en este trabajo';
  }
}

/** El día a abrir: el de la URL si vale; si no, hoy en España. */
export function diaInicial(diaUrl, hoy = diaEnEspana(new Date())) {
  return esDiaValido(diaUrl) ? diaUrl : hoy;
}

/**
 * Al cambiar de mes: hoy si es el mes en curso, y si no el día 1. Así al
 * volver al mes actual se ve otra vez lo de hoy.
 */
export function diaAlCambiarDeMes(mes, hoy = diaEnEspana(new Date())) {
  return hoy.startsWith(mes) ? hoy : `${mes}-01`;
}

