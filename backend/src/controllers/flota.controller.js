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
const { success }           = require('../utils/response.utils');
const cartrack              = require('../services/cartrack.service');
const { cruzarFlota, MINUTOS_SIN_SENAL } = require('../utils/flota.utils');
const { ahora }             = require('../utils/fecha.utils');
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
            CONCAT(u.nombre, ' ', u.apellidos) AS responsable_nombre
       FROM vehicles v
       LEFT JOIN asignaciones_libres al
              ON al.vehicle_id = v.id
             AND al.estado     = 'activa'
             AND al.deleted_at IS NULL
       LEFT JOIN users u ON u.id = al.user_id
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

module.exports = { getUbicaciones, vehiculosConAsignacion };
