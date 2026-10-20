/**
 * controllers/flota.controller.js
 * Mapa de la flota: dónde está cada ambulancia según el GPS de Cartrack,
 * cruzado con lo que sabe nuestra app (alias, ficha, asignación activa).
 *
 * Solo lectura y sin tabla propia: aquí no se guarda ninguna posición. Si
 * algún día hace falta histórico será una decisión aparte, con su migración y
 * su política de retención — que un rastro de dónde ha estado cada trabajador
 * no es un dato cualquiera.
 *
 * Acceso: **superadmin siempre; administradores solo con el flag
 * `menu_flota` encendido** desde el panel de superadmin. El control está en
 * `routes/flota.routes.js`, no aquí.
 */

'use strict';

const { query }             = require('../config/database');
const { success, notFound } = require('../utils/response.utils');
const cartrack              = require('../services/cartrack.service');
const { cruzarFlota, construirRecorrido, MINUTOS_SIN_SENAL } = require('../utils/flota.utils');
const { ahora, instanteUtc } = require('../utils/fecha.utils');
const { normalizarMatricula } = require('../utils/matricula.utils');
const { ORDEN_POR_NOMBRE }  = require('./vehicles.controller');

/**
 * Nuestros vehículos con su asignación activa, si la tienen.
 *
 * El LEFT JOIN puede devolver dos filas del mismo vehículo si alguien dejó dos
 * asignaciones activas solapadas (la app lo evita, pero el histórico manda
 * menos que la realidad de la tabla). Se ordena por `fecha_inicio DESC` y se
 * queda la primera de cada vehículo: la más reciente es la que alguien está
 * usando ahora mismo.
 */
async function vehiculosConAsignacion() {
  const [rows] = await query(
    `SELECT v.id, v.matricula, v.alias, v.kilometros_actuales,
            al.id           AS asignacion_id,
            al.fecha_inicio AS asignacion_inicio,
            al.fecha_fin    AS asignacion_fin,
            al.inicio_real_at,
            al.trabajo_id, t.nombre AS trabajo_nombre,
            -- Todos los responsables (v23), con el principal de respaldo
            COALESCE((SELECT GROUP_CONCAT(CONCAT(mru.nombre,' ',mru.apellidos) ORDER BY mr.orden SEPARATOR ', ')
                 FROM asignacion_usuarios mr JOIN users mru ON mr.user_id = mru.id
                WHERE mr.asignacion_id = al.id AND mr.rol = 'responsable'),
                     CONCAT(u.nombre, ' ', u.apellidos)) AS responsable_nombre
       FROM vehicles v
       LEFT JOIN asignaciones_libres al
              ON al.vehicle_id = v.id
             AND al.estado     = 'activa'
             AND al.deleted_at IS NULL
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN trabajos t ON t.id = al.trabajo_id
      WHERE v.deleted_at IS NULL
      ORDER BY ${ORDEN_POR_NOMBRE}, al.fecha_inicio DESC`
  );

  const porId = new Map();
  for (const r of rows) {
    if (porId.has(r.id)) continue;
    porId.set(r.id, {
      id: r.id,
      matricula: r.matricula,
      alias: r.alias,
      kilometros_actuales: r.kilometros_actuales,
      asignacion: r.asignacion_id ? {
        id: r.asignacion_id,
        // Con trabajo (v33), el enlace del mapa lleva al trabajo
        trabajo_id: r.trabajo_id ?? null,
        trabajo_nombre: r.trabajo_nombre ?? null,
        responsable: r.responsable_nombre,
        fecha_inicio: r.asignacion_inicio,
        fecha_fin: r.asignacion_fin,
        // Activa por el cron pero sin que nadie haya pulsado «Inicio de
        // servicio»: en el mapa importa porque explica un vehículo asignado
        // que no se ha movido de la base.
        iniciada: Boolean(r.inicio_real_at),
      } : null,
    });
  }
  return [...porId.values()];
}

// ============================================================
// GET /flota/ubicaciones
// ============================================================
/**
 * Devuelve la flota ya cruzada, lista para pintar.
 *
 * Responde 200 aunque Cartrack esté caído o sin configurar, y lo cuenta en
 * `fuente`: la pantalla tiene que poder distinguir «este entorno no tiene GPS»
 * de «el GPS no contesta ahora mismo» de «ha fallado la petición». Un 503 aquí
 * dejaría al frontend sin la lista de vehículos, que sí tenemos, solo porque
 * falta la capa de encima.
 */
async function getUbicaciones(_req, res, next) {
  try {
    const [vehiculos, estado] = await Promise.all([
      vehiculosConAsignacion(),
      cartrack.obtenerEstados(),
    ]);

    const { flota, resumen } = cruzarFlota({
      vehiculos,
      gps: estado.vehiculos,
      ahora: ahora(),
      minutosSinSenal: MINUTOS_SIN_SENAL,
    });

    return success(res, {
      flota,
      resumen,
      fuente: {
        configurado: estado.configurado,
        origen:      estado.origen,
        actualizado: estado.actualizado,
        error:       estado.error,
      },
      minutosSinSenal: MINUTOS_SIN_SENAL,
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /flota/recorrido/:asignacionId
// ============================================================

/**
 * Lo más largo que se pinta de una vez. Una asignación de un trabajo de una
 * semana son ~15.000 puntos y 7 tandas de llamadas a Cartrack; más que eso no
 * se lee en un mapa del tamaño de un panel. Si el servicio es más largo se
 * enseñan sus ÚLTIMOS 7 días y se avisa (`recortado`).
 */
const RECORRIDO_MAX_DIAS = 7;

/**
 * La ventana del servicio: desde que se pulsó «Inicio de servicio»
 * (`inicio_real_at`) hasta que se finalizó, o hasta ahora si sigue en curso.
 *
 * Sin `inicio_real_at` se usa la hora prevista de inicio, solo en una activa o
 * finalizada: el cron las activa a su hora aunque nadie pulse nada, y el
 * vehículo pudo moverse igual. Una programada no tiene recorrido que enseñar.
 */
function ventanaDelServicio(asig, ahoraDate) {
  if (!['activa', 'finalizada'].includes(asig.estado)) return null;
  const desde = instanteUtc(asig.inicio_real_at || asig.fecha_inicio);
  if (!desde) return null;
  const enCurso = asig.estado === 'activa';
  let hasta = enCurso ? ahoraDate : instanteUtc(asig.finalizado_at || asig.fecha_fin);
  if (!hasta || hasta > ahoraDate) hasta = ahoraDate;
  if (hasta <= desde) return null;

  const maxMs = RECORRIDO_MAX_DIAS * 24 * 60 * 60 * 1000;
  const recortado = hasta - desde > maxMs;
  return {
    desde: recortado ? new Date(hasta.getTime() - maxMs) : desde,
    hasta,
    enCurso,
    recortado,
  };
}

/**
 * La ruta que hizo la ambulancia de un servicio, pedida a Cartrack.
 *
 * Mismo acceso que el mapa de flota (lo pone `flota.routes`): enseña por dónde
 * ha ido el vehículo y, con él, su equipo. No se guarda ni un punto: Cartrack
 * los tiene ~5 años y aquí se piden al abrir (MAPA_CODIGO §2.6).
 *
 * Igual que `getUbicaciones`, responde 200 aunque Cartrack falle: `estado`
 * dice por qué no hay ruta (`sin_empezar`, `sin_gps`) y `fuente.error` si el
 * GPS no contestó, para que la pantalla no confunda «no se movió» con «no se
 * sabe».
 */
async function getRecorrido(req, res, next) {
  try {
    const [rows] = await query(
      `SELECT al.id, al.estado, al.fecha_inicio, al.fecha_fin,
              al.inicio_real_at, al.finalizado_at,
              v.id AS vehicle_id, v.matricula
         FROM asignaciones_libres al
         JOIN vehicles v ON v.id = al.vehicle_id
        WHERE al.id = ? AND al.deleted_at IS NULL`,
      [req.params.asignacionId]
    );
    const asig = rows[0];
    if (!asig) return notFound(res, 'Asignación');

    const ventana = ventanaDelServicio(asig, ahora());
    const base = {
      ventana: ventana ? {
        desde: ventana.desde.toISOString(),
        hasta: ventana.hasta.toISOString(),
        enCurso: ventana.enCurso,
        recortado: ventana.recortado,
        maxDias: RECORRIDO_MAX_DIAS,
      } : null,
      recorrido: construirRecorrido([]),
      fuente: { configurado: cartrack.estaConfigurado(), error: null },
    };
    if (!ventana) return success(res, { ...base, estado: 'sin_empezar' });

    // El id de Cartrack sale del cruce por matrícula del mapa, que ya va
    // cacheado. Si la matrícula sale dos veces no se elige ninguna, por lo
    // mismo que en el mapa: la ruta de otra ambulancia parecería buena.
    const estado = await cartrack.obtenerEstados();
    const nuestra = normalizarMatricula(asig.matricula);
    const candidatos = (estado.vehiculos || []).filter(g => nuestra && normalizarMatricula(g.matricula) === nuestra);
    if (candidatos.length !== 1 || !candidatos[0].matriculaOriginal) {
      return success(res, {
        ...base,
        estado: 'sin_gps',
        fuente: { configurado: estado.configurado, error: estado.error },
      });
    }

    const { puntos, error } = await cartrack.obtenerRecorrido({
      cartrackId: candidatos[0].cartrackId,
      registration: candidatos[0].matriculaOriginal,
      desde: ventana.desde,
      hasta: ventana.hasta,
    });

    return success(res, {
      ...base,
      estado: 'ok',
      recorrido: construirRecorrido(puntos),
      fuente: { configurado: true, error },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getUbicaciones, getRecorrido, vehiculosConAsignacion, ventanaDelServicio };
