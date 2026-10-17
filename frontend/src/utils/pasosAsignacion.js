/**
 * Los cuatro pasos de una asignación, en el orden en que se hacen, y la
 * etiqueta de estado que se le enseña a la gente.
 *
 * Los NOMBRES de los pasos son los de los botones y no se tocan: los decidió el
 * usuario el 2026-10-03 tras varias vueltas (§6.1 del mapa, «Vocabulario»).
 * Lo que añade esto es el orden y dónde se está, para que el técnico vea qué le
 * toca sin leerse la ficha entera. Los dos del evento son OPCIONALES (decisión
 * del usuario): se marcan como tales y una asignación cerrada sin ellos los
 * enseña como «no consta», no como pendientes.
 */
import { ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS } from './constants.js';
import { resumenJornadas, accionJornada } from './jornadas.js';

export const PASOS_ASIGNACION = [
  { clave: 'inicio',     titulo: 'Inicio de la asignación', donde: 'En base, con fotos', campo: 'inicio_real_at' },
  { clave: 'llegada',    titulo: 'Inicio evento/servicio',  donde: 'Al llegar al lugar', campo: 'llegada_servicio_at', opcional: true },
  { clave: 'fin_evento', titulo: 'Fin evento/servicio',     donde: 'Al irte del lugar',  campo: 'fin_servicio_at',     opcional: true },
  { clave: 'cierre',     titulo: 'Finalizar asignación',    donde: 'En base, con fotos', campo: 'finalizado_at' },
];

/**
 * Con horario por días (v39), los dos del evento se cambian por uno solo,
 * «Jornadas»: cada día se ficha «Inicio/Fin de jornada» y la barra dice
 * cuántas van de cuántas.
 */
const PASO_JORNADAS = { clave: 'jornadas', titulo: 'Jornadas', donde: 'Cada día, en el sitio' };

// ¿Están las fotos de inicio? La ficha trae `progreso` y la de un trabajo
// `progreso_fotos`; sin ninguno de los dos no se sabe y no se le pone pega.
function fotosInicioCompletas(asig) {
  const p = asig.progreso?.inicio || asig.progreso_fotos?.inicio;
  return p ? !!p.completo : true;
}

/**
 * Cada paso con su `situacion`: 'hecho' | 'actual' | 'pendiente' | 'no_consta',
 * la `hora` a la que se hizo y, si toca, un `aviso` («Faltan fotos»).
 * Una cancelada no tiene pasos (null).
 */
export function pasosAsignacion(asig, ahora = new Date()) {
  if (!asig || asig.estado === 'cancelada') return null;
  const cerrada = asig.estado === 'finalizada';
  const jornadas = resumenJornadas(asig);
  const lista = jornadas.total
    ? [PASOS_ASIGNACION[0], PASO_JORNADAS, PASOS_ASIGNACION[3]]
    : PASOS_ASIGNACION;

  const hechos = lista.map(p => {
    if (p.clave === 'cierre') return cerrada;
    if (p.clave === 'inicio') return cerrada || (!!asig.inicio_real_at && fotosInicioCompletas(asig));
    // Las jornadas, hechas cuando ya no queda ninguna por fichar y alguna se fichó
    if (p.clave === 'jornadas') {
      const quedan = Array.isArray(asig.jornadas)
        ? !!accionJornada(asig.jornadas, ahora).principal
        : jornadas.enCurso || jornadas.hechas < jornadas.total;
      return jornadas.hechas > 0 && (cerrada || !quedan);
    }
    return !!asig[p.campo];
  });
  const actual = cerrada ? -1 : hechos.indexOf(false);

  return lista.map((p, i) => {
    let situacion;
    if (hechos[i]) situacion = 'hecho';
    else if (cerrada) situacion = 'no_consta';
    else situacion = i === actual ? 'actual' : 'pendiente';

    const paso = { ...p, situacion, hora: hechos[i] ? asig[p.campo] || null : null };
    // Pulsó «Inicio de la asignación» pero le faltan fotos: sigue en este paso
    if (p.clave === 'inicio' && situacion === 'actual' && asig.inicio_real_at) {
      paso.aviso = 'Faltan fotos';
    }
    if (p.clave === 'jornadas' && situacion !== 'no_consta') {
      paso.donde = `${jornadas.hechas} de ${jornadas.total}`;
    }
    return paso;
  });
}

/**
 * La etiqueta de estado de una asignación. `activa` en BD solo quiere decir
 * que ya pasó la hora prevista (el cron la activa sola), así que una «Activa»
 * pegada a un «Sin iniciar» se contradecía. Activa se parte en «Sin iniciar»
 * (nadie pulsó «Inicio de la asignación») y «En curso»; el resto, como siempre.
 */
export function estadoVisible(a) {
  if (a?.estado === 'activa') {
    return a.inicio_real_at
      ? { texto: 'En curso',    clase: 'badge-blue' }
      : { texto: 'Sin iniciar', clase: 'badge-red' };
  }
  return {
    texto: ASIGNACION_ESTADO_LABELS[a?.estado] || a?.estado || '',
    clase: ASIGNACION_ESTADO_COLORS[a?.estado] || 'badge-gray',
  };
}
