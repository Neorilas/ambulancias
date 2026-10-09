/**
 * controllers/asignaciones.controller.js
 * CRUD de asignaciones libres de vehículo + flujo de finalización con evidencias
 */

'use strict';

const { query, transaction }    = require('../config/database');
const { success, created, error, notFound, forbidden, paginated } =
  require('../utils/response.utils');
const { PAGINATION, IMAGEN_TIPOS, IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN, IMAGEN_TIPOS_GENERAL, PERMISSIONS,
  INICIO_ANTICIPADO_MAX_MINUTOS, FOTOS_INICIO_TARDE_MINUTOS } =
  require('../config/constants');
const { hasPermission, isAdmin } = require('../middleware/roles.middleware');
const logger                     = require('../utils/logger.utils');
const { deleteFile }             = require('../middleware/upload.middleware');
const { logAudit }               = require('./admin.controller');
const { ahora, fechaEnEspana, diaYHoraEnEspana, instanteUtc } = require('../utils/fecha.utils');
const { errorMotivo }            = require('../utils/motivo.utils');
const avisos                     = require('../services/avisosAsignacion.service');
const vigilancia                 = require('../services/vigilancia.service');
const estadoTrabajo              = require('../services/estadoTrabajo.service');

// ============================================================
// Helper: progreso de evidencias (inicio y fin) de una asignación
// ============================================================
async function getProgreso(asignacionId) {
  const [rows] = await query(
    `SELECT tipo_imagen, momento FROM vehicle_images WHERE asignacion_id = ?`,
    [asignacionId]
  );
  const inicioSubidos = rows.filter(r => r.momento === 'inicio').map(r => r.tipo_imagen);
  const finSubidos    = rows.filter(r => r.momento === 'fin').map(r => r.tipo_imagen);

  const inicio = {
    completado: inicioSubidos.length,
    total:      IMAGEN_TIPOS_INICIO.length,
    faltantes:  IMAGEN_TIPOS_INICIO.filter(t => !inicioSubidos.includes(t)),
    completo:   IMAGEN_TIPOS_INICIO.every(t => inicioSubidos.includes(t)),
  };
  const fin = {
    completado: finSubidos.length,
    total:      IMAGEN_TIPOS_FIN.length,
    faltantes:  IMAGEN_TIPOS_FIN.filter(t => !finSubidos.includes(t)),
    completo:   IMAGEN_TIPOS_FIN.every(t => finSubidos.includes(t)),
  };
  return { inicio, fin };
}

/**
 * Fotos de inicio subidas tarde: más de FOTOS_INICIO_TARDE_MINUTOS después de
 * «Inicio de la asignación». Marca cada evidencia de inicio con `retraso_min` (null
 * si no hay con qué comparar) y `tardia`, y devuelve el resumen para la
 * asignación, o null si ninguna llega tarde.
 *
 * Se calcula al leer, no se guarda: las dos horas ya están en BD y no cambian
 * salvo al rehacer la foto, que vuelve a sellar `created_at` — y entonces la
 * imagen que se conserva ES tardía, así que la marca es la correcta. Sin
 * `inicio_real_at` (nadie pulsó el botón; la API a pelo deja subir igual) no
 * hay referencia y no se marca.
 */
function marcarFotosInicioTarde(asig, evidencias) {
  const inicioReal = asig.inicio_real_at ? instanteUtc(asig.inicio_real_at).getTime() : null;
  let maxRetraso = null;
  let tardias = 0;
  for (const ev of evidencias) {
    if (ev.momento !== 'inicio') continue;
    ev.retraso_min = null;
    ev.tardia = false;
    if (inicioReal == null || !ev.uploaded_at) continue;
    // El corte es «más de N minutos» en milisegundos, igual que el
    // `> inicio_real_at + INTERVAL N MINUTE` del listado: si no, la ficha y
    // la lista discrepan con una foto subida a los 30 min y 20 s.
    const diffMs  = instanteUtc(ev.uploaded_at).getTime() - inicioReal;
    const retraso = Math.floor(diffMs / 60000);
    ev.retraso_min = retraso;
    if (diffMs > FOTOS_INICIO_TARDE_MINUTOS * 60000) {
      ev.tardia = true;
      tardias += 1;
      if (maxRetraso == null || retraso > maxRetraso) maxRetraso = retraso;
    }
  }
  return tardias
    ? { fotos: tardias, max_retraso_min: maxRetraso, umbral_min: FOTOS_INICIO_TARDE_MINUTOS }
    : null;
}

/**
 * Saca las columnas `trabajo_*` de la fila a un objeto `trabajo` (o null si la
 * asignación es del modelo antiguo). Lo que ve todo el que va en la ambulancia
 * (decisión 1 del plan del trabajo padre): título, descripción, ubicación,
 * fechas y quién lo coordina. `trabajo_id` se queda en la fila.
 */
function trabajoAparte(fila) {
  const {
    trabajo_identificador, trabajo_nombre, trabajo_descripcion, trabajo_ubicacion,
    trabajo_estado, trabajo_fecha_inicio, trabajo_fecha_fin, trabajo_coordinador_id,
    trabajo_coordinador_nombre, trabajo_coordinador_apellidos, ...asig
  } = fila;
  asig.trabajo = asig.trabajo_id ? {
    id:            asig.trabajo_id,
    identificador: trabajo_identificador,
    nombre:        trabajo_nombre,
    descripcion:   trabajo_descripcion,
    ubicacion:     trabajo_ubicacion,
    estado:        trabajo_estado,
    fecha_inicio:  trabajo_fecha_inicio,
    fecha_fin:     trabajo_fecha_fin,
    coordinador:   trabajo_coordinador_id
      ? { id: trabajo_coordinador_id, nombre: trabajo_coordinador_nombre, apellidos: trabajo_coordinador_apellidos }
      : null,
  } : null;
  return asig;
}

// Helper: obtener asignación completa con relaciones
async function getAsignacionCompleta(id) {
  const [rows] = await query(
    `SELECT al.*,
            v.matricula, v.alias AS vehiculo_alias,
            v.kilometros_actuales AS vehiculo_km_actual,
            CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
            u.username AS responsable_username,
            CONCAT(c.nombre,' ',c.apellidos) AS creado_por_nombre,
            t.identificador AS trabajo_identificador, t.nombre AS trabajo_nombre,
            t.descripcion AS trabajo_descripcion, t.ubicacion AS trabajo_ubicacion,
            t.estado AS trabajo_estado,
            t.fecha_inicio AS trabajo_fecha_inicio, t.fecha_fin AS trabajo_fecha_fin,
            t.coordinador_user_id AS trabajo_coordinador_id,
            co.nombre AS trabajo_coordinador_nombre, co.apellidos AS trabajo_coordinador_apellidos
     FROM asignaciones_libres al
     JOIN vehicles v ON al.vehicle_id = v.id
     JOIN users u    ON al.user_id    = u.id
     JOIN users c    ON al.created_by = c.id
     LEFT JOIN trabajos t ON t.id = al.trabajo_id
     LEFT JOIN users co   ON co.id = t.coordinador_user_id
     WHERE al.id = ? AND al.deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) return null;

  const asig = trabajoAparte(rows[0]);

  // Quién va en la asignación: responsables (activan, evidencian y cierran) y
  // personal (solo la ven). Ver v23 en migrations.js.
  const [miembros] = await query(
    `SELECT au.user_id, au.rol, au.orden,
            u.nombre, u.apellidos, u.username
     FROM asignacion_usuarios au
     JOIN users u ON au.user_id = u.id
     WHERE au.asignacion_id = ?
     ORDER BY au.orden ASC, au.created_at ASC`,
    [id]
  );
  const persona = m => ({ id: m.user_id, nombre: m.nombre, apellidos: m.apellidos, username: m.username });
  asig.responsables = (miembros || []).filter(m => m.rol === 'responsable').map(persona);
  asig.personal     = (miembros || []).filter(m => m.rol === 'personal').map(persona);

  // Evidencias subidas
  const [evidencias] = await query(
    `SELECT id, tipo_imagen, momento, image_url, created_at AS uploaded_at
     FROM vehicle_images
     WHERE asignacion_id = ?
     ORDER BY FIELD(momento,'inicio','fin','general'), created_at ASC`,
    [id]
  );

  // Incidencias registradas en esta asignación (para que admin/gestor puedan
  // leer lo que reportó el técnico, no solo crear nuevas).
  const [incidencias] = await query(
    `SELECT vi.id, vi.tipo, vi.gravedad, vi.descripcion, vi.estado,
            vi.created_at, vi.resuelto_at,
            vi.responsable_user_id,
            rep.id        AS reporter_id,
            rep.nombre    AS reporter_nombre,
            rep.apellidos AS reporter_apellidos,
            rsp.nombre    AS responsable_nombre,
            rsp.apellidos AS responsable_apellidos,
            res.id        AS resolutor_id,
            res.nombre    AS resolutor_nombre,
            res.apellidos AS resolutor_apellidos
     FROM vehicle_incidencias vi
     LEFT JOIN users rep ON vi.reported_by         = rep.id
     LEFT JOIN users rsp ON vi.responsable_user_id = rsp.id
     LEFT JOIN users res ON vi.resuelto_by         = res.id
     WHERE vi.asignacion_id = ?
     ORDER BY vi.created_at DESC`,
    [id]
  );

  // Comentarios aportados sobre esas incidencias (admin/gestor y responsable).
  const comentariosPorInc = new Map();
  if (incidencias.length) {
    const ids = incidencias.map(i => i.id);
    const [comRows] = await query(
      `SELECT c.id, c.incidencia_id, c.comentario, c.created_at,
              u.id AS autor_id, u.nombre AS autor_nombre, u.apellidos AS autor_apellidos
       FROM incidencia_comentarios c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.incidencia_id IN (${ids.map(() => '?').join(',')})
       ORDER BY c.created_at ASC, c.id ASC`,
      ids
    );
    for (const r of comRows) {
      if (!comentariosPorInc.has(r.incidencia_id)) comentariosPorInc.set(r.incidencia_id, []);
      comentariosPorInc.get(r.incidencia_id).push({
        id:         r.id,
        comentario: r.comentario,
        created_at: r.created_at,
        autor: r.autor_id
          ? { id: r.autor_id, nombre: r.autor_nombre, apellidos: r.autor_apellidos }
          : null,
      });
    }
  }

  asig.evidencias  = evidencias;
  asig.fotos_inicio_tarde = marcarFotosInicioTarde(asig, evidencias);
  asig.incidencias = incidencias.map(r => ({
    id:          r.id,
    tipo:        r.tipo,
    gravedad:    r.gravedad,
    descripcion: r.descripcion,
    estado:      r.estado,
    created_at:  r.created_at,
    resuelto_at: r.resuelto_at,
    responsable: r.responsable_user_id
      ? { id: r.responsable_user_id, nombre: r.responsable_nombre, apellidos: r.responsable_apellidos }
      : null,
    reportado_por: r.reporter_id
      ? { id: r.reporter_id, nombre: r.reporter_nombre, apellidos: r.reporter_apellidos }
      : null,
    resuelto_por: r.resolutor_id
      ? { id: r.resolutor_id, nombre: r.resolutor_nombre, apellidos: r.resolutor_apellidos }
      : null,
    comentarios: comentariosPorInc.get(r.id) || [],
  }));
  asig.progreso = await getProgreso(id);

  return asig;
}

// ============================================================
// Helpers: quién va en la asignación
// ============================================================

/**
 * Papel de un usuario en una asignación ya cargada con getAsignacionCompleta:
 * 'responsable', 'personal' o null. Es la ÚNICA regla de acceso para quien no
 * gestiona: ver pide ser miembro; activar, evidenciar y cerrar piden ser
 * responsable.
 */
function rolEnAsignacion(asig, userId) {
  const responsables = asig.responsables || [];
  const personal     = asig.personal     || [];
  if (responsables.some(r => r.id === userId)) return 'responsable';
  if (personal.some(p => p.id === userId))     return 'personal';
  // Red de seguridad: una fila sin miembros (no debería existir tras v23)
  // sigue funcionando con el responsable principal.
  if (!responsables.length && asig.user_id === userId) return 'responsable';
  return null;
}

/**
 * ¿Es el coordinador del trabajo de esta asignación? Ve la asignación entera
 * (D2), pero serlo no le deja operarla: activar, fotos y cierre siguen
 * pidiendo ser responsable o gestionar trabajos.
 */
function esCoordinador(asig, userId) {
  return !!asig?.trabajo?.coordinador && asig.trabajo.coordinador.id === userId;
}

// ============================================================
// Helpers: la asignación dentro de su trabajo (v33)
// ============================================================

/**
 * El trabajo al que se quiere colgar una ambulancia. `abierto` es falso si ya
 * lo cerró el coordinador: entonces no admite ambulancias nuevas.
 */
async function cargarTrabajo(trabajoId) {
  const [rows] = await query(
    `SELECT id, nombre, estado, fecha_inicio, fecha_fin
     FROM trabajos WHERE id = ? AND deleted_at IS NULL`,
    [trabajoId]
  );
  if (!rows.length) return null;
  return { ...rows[0], abierto: !estadoTrabajo.CERRADOS.includes(rows[0].estado) };
}

/**
 * D5: la misma ambulancia no va dos veces en un trabajo. Cuentan las
 * asignaciones vivas: una cancelada o borrada deja volver a ponerla. Se mira
 * en el controlador y no con un UNIQUE porque el borrado es lógico y la
 * cancelada debe poder convivir con la nueva.
 */
async function vehiculoYaEnTrabajo(trabajoId, vehicleId, excluirId = 0) {
  const [rows] = await query(
    `SELECT id FROM asignaciones_libres
     WHERE trabajo_id = ? AND vehicle_id = ? AND id <> ?
       AND deleted_at IS NULL AND estado <> 'cancelada'
     LIMIT 1`,
    [trabajoId, vehicleId, excluirId]
  );
  return rows.length > 0;
}

/**
 * D4: las fechas de una ambulancia pueden salirse de las del trabajo (llega
 * antes a montar, se queda a recoger). Es un AVISO para quien asigna, como
 * los solapes de personas; no bloquea.
 */
function fueraDelTrabajo(trabajo, fechaInicio, fechaFin) {
  if (!trabajo) return false;
  return instanteUtc(fechaInicio) < instanteUtc(trabajo.fecha_inicio)
      || instanteUtc(fechaFin)    > instanteUtc(trabajo.fecha_fin);
}

/**
 * D6: un trabajo tiene siempre al menos una ambulancia. ¿Es esta la última
 * viva (ni cancelada ni borrada)?
 */
async function esUltimaDelTrabajo(trabajoId, asignacionId) {
  const [rows] = await query(
    `SELECT COUNT(*) AS otras FROM asignaciones_libres
     WHERE trabajo_id = ? AND id <> ? AND deleted_at IS NULL AND estado <> 'cancelada'`,
    [trabajoId, asignacionId]
  );
  return Number(rows[0]?.otras || 0) === 0;
}

/**
 * Inserta una asignación con sus miembros. La usan `createAsignacion` y el alta
 * de un trabajo con su primera ambulancia (`trabajos.controller`), que la
 * necesita dentro de su propia transacción (D6). No sincroniza el estado del
 * trabajo: lo hace quien llama, una vez, al final.
 */
async function insertarAsignacion(conn, datos, creadoPor) {
  const { trabajo_id = null, vehicle_id, responsables, personal = [],
          fecha_inicio, fecha_fin, km_inicio, notas } = datos;
  const [result] = await conn.execute(
    `INSERT INTO asignaciones_libres
       (vehicle_id, user_id, created_by, fecha_inicio, fecha_fin, km_inicio, notas, trabajo_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [vehicle_id, responsables[0], creadoPor, fecha_inicio, fecha_fin,
     km_inicio || null, notas || null, trabajo_id]
  );
  await guardarMiembros(conn, result.insertId, responsables, personal);
  return result.insertId;
}

/** Lista de ids enteros de un campo del body, o undefined si no viene. */
function idsDe(valor) {
  if (valor === undefined || valor === null) return undefined;
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista.map(v => Number(v));
}

/**
 * Normaliza los miembros del body. Acepta el formato nuevo
 * (`responsables: [ids]`, `personal: [ids]`) y el viejo (`user_id` suelto),
 * que sigue mandando el frontend anterior hasta que se sube el nuevo: el
 * frontend va en otro hosting y se sube a mano.
 *
 * @returns {{responsables?: number[], personal?: number[], error?: string}}
 */
function leerMiembros(body) {
  const responsables = idsDe(body.responsables) ?? idsDe(body.user_id);
  const personal     = idsDe(body.personal);

  const todos = [...(responsables || []), ...(personal || [])];
  if (todos.some(id => !Number.isInteger(id) || id < 1)) {
    return { error: 'Los usuarios de la asignación deben ser ids válidos' };
  }
  if (responsables !== undefined && responsables.length === 0) {
    return { error: 'La asignación necesita al menos un responsable' };
  }
  if (new Set(todos).size !== todos.length) {
    return { error: 'La misma persona no puede figurar dos veces en la asignación' };
  }
  return { responsables, personal };
}

/**
 * Comprueba que los ids existen y están activos. Devuelve los que no.
 * `yaMiembros` se salta: quien ya iba en la asignación no bloquea una edición
 * aunque desde entonces lo hayan dado de baja.
 */
async function usuariosNoValidos(ids, yaMiembros = []) {
  const nuevos = ids.filter(id => !yaMiembros.includes(id));
  if (!nuevos.length) return [];
  const [rows] = await query(
    `SELECT id FROM users
     WHERE id IN (${nuevos.map(() => '?').join(',')})
       AND deleted_at IS NULL AND activo = 1`,
    nuevos
  );
  const ok = new Set(rows.map(r => r.id));
  return nuevos.filter(id => !ok.has(id));
}

/** Reescribe los miembros de una asignación y sincroniza el responsable principal. */
async function guardarMiembros(conn, asignacionId, responsables, personal) {
  await conn.execute('DELETE FROM asignacion_usuarios WHERE asignacion_id = ?', [asignacionId]);
  const filas = [
    ...responsables.map((id, i) => [asignacionId, id, 'responsable', i]),
    ...personal.map((id, i)     => [asignacionId, id, 'personal', i]),
  ];
  await conn.execute(
    `INSERT INTO asignacion_usuarios (asignacion_id, user_id, rol, orden)
     VALUES ${filas.map(() => '(?, ?, ?, ?)').join(', ')}`,
    filas.flat()
  );
  // El principal (el primero) sigue en asignaciones_libres.user_id: lo leen
  // flota, los avisos y el frontend anterior.
  await conn.execute('UPDATE asignaciones_libres SET user_id = ? WHERE id = ?',
    [responsables[0], asignacionId]);
}

/**
 * Otras asignaciones abiertas de estas personas que se pisan en fechas con
 * [inicio, fin). Es un AVISO: no bloquea el guardado, solo se devuelve para
 * que quien asigna lo sepa.
 */
async function buscarSolapes(userIds, fechaInicio, fechaFin, excluirId = 0) {
  if (!userIds.length) return [];
  const [rows] = await query(
    `SELECT au.user_id, CONCAT(u.nombre,' ',u.apellidos) AS nombre,
            al.id AS asignacion_id, al.fecha_inicio, al.fecha_fin,
            v.matricula, v.alias AS vehiculo_alias
     FROM asignacion_usuarios au
     JOIN asignaciones_libres al ON au.asignacion_id = al.id
     JOIN users u                ON au.user_id = u.id
     JOIN vehicles v             ON al.vehicle_id = v.id
     WHERE au.user_id IN (${userIds.map(() => '?').join(',')})
       AND al.id <> ?
       AND al.deleted_at IS NULL
       AND al.estado IN ('programada','activa')
       AND al.fecha_inicio < ? AND al.fecha_fin > ?
     ORDER BY al.fecha_inicio ASC`,
    // instanteUtc y no new Date: desde createAsignacion llegan los textos
    // del body, UTC sin zona, y new Date los leería en hora española.
    [...userIds, excluirId, instanteUtc(fechaFin), instanteUtc(fechaInicio)]
  );
  return rows || [];
}

/**
 * Lo mismo que buscarSolapes, pero para la ambulancia: otras asignaciones
 * abiertas y vehículos de trabajos sin cerrar que la usan en [inicio, fin).
 * También es solo un AVISO: a veces se encadenan servicios y la hora de fin
 * prevista no es la real.
 */
async function buscarVehiculoOcupado(vehicleId, fechaInicio, fechaFin, excluirId = 0) {
  if (!vehicleId) return [];
  const fin = instanteUtc(fechaFin), inicio = instanteUtc(fechaInicio);
  const [rows] = await query(
    `SELECT 'asignacion' AS origen, al.id, NULL AS nombre, al.fecha_inicio, al.fecha_fin
     FROM asignaciones_libres al
     WHERE al.vehicle_id = ? AND al.id <> ?
       AND al.deleted_at IS NULL
       AND al.estado IN ('programada','activa')
       AND al.fecha_inicio < ? AND al.fecha_fin > ?
     UNION ALL
     SELECT 'trabajo' AS origen, t.id, t.nombre, t.fecha_inicio, t.fecha_fin
     FROM trabajo_vehiculos tv
     JOIN trabajos t ON t.id = tv.trabajo_id
     WHERE tv.vehicle_id = ?
       AND t.deleted_at IS NULL
       AND tv.estado IN ('programado','activo')
       AND t.fecha_inicio < ? AND t.fecha_fin > ?
     ORDER BY fecha_inicio ASC`,
    [vehicleId, excluirId, fin, inicio, vehicleId, fin, inicio]
  );
  return rows || [];
}

// ============================================================
// GET /asignaciones
// ============================================================

/**
 * Orden del listado: arriba lo que toca ahora, abajo lo que ya no.
 *
 * 1. Las cerradas (finalizada/cancelada) van al final, siempre: ya no hay
 *    nada que hacer con ellas.
 * 2. Las `activa` encabezan las abiertas: son las que están pasando.
 * 3. El resto por `fecha_inicio` ASC — la más próxima a activarse arriba del
 *    todo y la que más queda, abajo.
 * 4. Entre las cerradas, la que se cerró más tarde primero: ahí lo último que
 *    pasó es lo que se viene a mirar. `finalizado_at` solo lo sella
 *    `finalizarAsignacion`, así que una **cancelada** no lo tiene y cae en el
 *    `fecha_fin` del COALESCE.
 *
 * El criterio 2 parece redundante —el cron activa cada asignación en cuanto
 * llega su `fecha_inicio`, así que lo normal es que una `activa` ya tenga
 * fecha pasada y suba sola— pero NO lo es: `activarAsignacion` no comprueba el
 * reloj. Un responsable que pulsa «Inicio de la asignación» antes de la hora deja
 * una `activa` con `fecha_inicio` futura, y sin este criterio el servicio que
 * está EN CURSO se hundía por debajo de las que aún no han empezado.
 *
 * El `CASE` del criterio 3 deja las cerradas a NULL para que empaten entre
 * ellas y las desempate el 4. `al.id` cierra el orden: sin un criterio único,
 * dos filas con la misma fecha pueden cambiar de sitio entre páginas y
 * repetirse o perderse en la paginación.
 */
const ORDEN_LISTADO = `
  CASE WHEN al.estado IN ('finalizada','cancelada') THEN 1 ELSE 0 END ASC,
  CASE WHEN al.estado = 'activa' THEN 0 ELSE 1 END ASC,
  CASE WHEN al.estado IN ('finalizada','cancelada') THEN NULL ELSE al.fecha_inicio END ASC,
  COALESCE(al.finalizado_at, al.fecha_fin) DESC,
  al.id DESC`;

async function listAsignaciones(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const page   = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.max(1, Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT));
    const offset = (page - 1) * limit;
    const estado = req.query.estado || null;

    const whereParts = ['al.deleted_at IS NULL'];
    const params     = [];

    // Operacionales solo ven aquellas en las que van, como responsable o
    // como personal. `al.user_id` (el responsable principal) va de respaldo,
    // igual que en rolEnAsignacion: una fila insertada sin miembros —el seed
    // local lo hacía— no puede desaparecerle a su propio responsable.
    if (!canManage) {
      whereParts.push(`(al.user_id = ? OR EXISTS (SELECT 1 FROM asignacion_usuarios au
                               WHERE au.asignacion_id = al.id AND au.user_id = ?))`);
      params.push(req.user.id, req.user.id);
    }

    if (estado) {
      whereParts.push('al.estado = ?');
      params.push(estado);
    }

    // Filtro por trabajo (D9): `?trabajo_id=N`, o `sin` para las del modelo
    // antiguo, que no tienen.
    const trabajoFiltro = req.query.trabajo_id;
    if (trabajoFiltro === 'sin') {
      whereParts.push('al.trabajo_id IS NULL');
    } else if (parseInt(trabajoFiltro) > 0) {
      whereParts.push('al.trabajo_id = ?');
      params.push(parseInt(trabajoFiltro));
    }

    const where = 'WHERE ' + whereParts.join(' AND ');

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM asignaciones_libres al ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT al.id, al.vehicle_id, al.user_id, al.fecha_inicio, al.fecha_fin,
              al.estado, al.inicio_real_at, al.llegada_servicio_at, al.fin_servicio_at, al.km_inicio, al.km_fin, al.notas, al.created_at,
              al.trabajo_id, t.identificador AS trabajo_identificador, t.nombre AS trabajo_nombre,
              t.estado AS trabajo_estado,
              v.matricula, v.alias AS vehiculo_alias,
              v.kilometros_actuales AS vehiculo_km_actual,
              CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
              u.username AS responsable_username,
              (SELECT GROUP_CONCAT(CONCAT(ru.nombre,' ',ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
                 FROM asignacion_usuarios ra JOIN users ru ON ra.user_id = ru.id
                WHERE ra.asignacion_id = al.id AND ra.rol = 'responsable') AS responsables_nombres,
              (SELECT GROUP_CONCAT(CONCAT(pu.nombre,' ',pu.apellidos) ORDER BY pa.orden SEPARATOR ', ')
                 FROM asignacion_usuarios pa JOIN users pu ON pa.user_id = pu.id
                WHERE pa.asignacion_id = al.id AND pa.rol = 'personal') AS personal_nombres,
              (SELECT ma.rol FROM asignacion_usuarios ma
                WHERE ma.asignacion_id = al.id AND ma.user_id = ?) AS mi_rol,
              -- Fotos de inicio subidas tarde: mismo corte que
              -- marcarFotosInicioTarde en la ficha (ver ahí el porqué).
              (SELECT COUNT(*) FROM vehicle_images ti
                WHERE ti.asignacion_id = al.id AND ti.momento = 'inicio'
                  AND al.inicio_real_at IS NOT NULL
                  AND ti.created_at > al.inicio_real_at + INTERVAL ? MINUTE) AS fotos_inicio_tarde
       FROM asignaciones_libres al
       JOIN vehicles v ON al.vehicle_id = v.id
       JOIN users u    ON al.user_id    = u.id
       LEFT JOIN trabajos t ON t.id = al.trabajo_id
       ${where}
       ORDER BY ${ORDEN_LISTADO}
       LIMIT ? OFFSET ?`,
      [req.user.id, FOTOS_INICIO_TARDE_MINUTOS, ...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /asignaciones/alarmas
// ============================================================
/**
 * Asignaciones con la alarma de «sin iniciar» sonando (ver
 * `vigilancia.listarAlarmasSinIniciar`). Solo gestión: la ruta exige
 * MANAGE_TRABAJOS, los mismos que reciben el push.
 */
async function listAlarmas(req, res, next) {
  try {
    const filas = await vigilancia.listarAlarmasSinIniciar({ excluirUserId: req.user.id });
    return success(res, filas);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /asignaciones/:id
// ============================================================
async function getAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);

    if (!asig) return notFound(res, 'Asignación');

    // Operacionales solo ven aquellas en las que van (responsable o personal),
    // y el coordinador de su trabajo las ve todas (D2).
    if (!canManage && !rolEnAsignacion(asig, req.user.id) && !esCoordinador(asig, req.user.id)) {
      return forbidden(res, 'No tienes acceso a esta asignación');
    }

    return success(res, asig);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones
// ============================================================
async function createAsignacion(req, res, next) {
  try {
    const { vehicle_id, fecha_inicio, fecha_fin, km_inicio, notas } = req.body;

    const miembros = leerMiembros(req.body);
    if (miembros.error) return error(res, miembros.error, 400);
    if (!miembros.responsables) return error(res, 'La asignación necesita al menos un responsable', 400);
    const responsables = miembros.responsables;
    const personal     = miembros.personal || [];

    // Validar que vehículo existe
    const [veh] = await query('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicle_id]);
    if (!veh.length) return notFound(res, 'Vehículo');

    // Validar que los usuarios existen y están activos
    if ((await usuariosNoValidos([...responsables, ...personal])).length) {
      return notFound(res, 'Usuario');
    }

    // Validar fechas
    if (instanteUtc(fecha_fin) <= instanteUtc(fecha_inicio)) {
      return error(res, 'fecha_fin debe ser posterior a fecha_inicio', 400);
    }

    // La ambulancia dentro de su trabajo (v33). Opcional hasta la fase 6: el
    // frontend anterior sigue creando asignaciones sueltas.
    const trabajoId = req.body.trabajo_id ? Number(req.body.trabajo_id) : null;
    let trabajo = null;
    if (trabajoId) {
      trabajo = await cargarTrabajo(trabajoId);
      if (!trabajo) return notFound(res, 'Trabajo');
      if (!trabajo.abierto) return error(res, 'El trabajo ya está cerrado: no admite más ambulancias', 400);
      if (await vehiculoYaEnTrabajo(trabajoId, vehicle_id)) {
        return error(res, 'Esa ambulancia ya va en este trabajo', 400);
      }
    }

    const asignacionId = await transaction(async (conn) => {
      const id = await insertarAsignacion(conn, {
        trabajo_id: trabajoId, vehicle_id, responsables, personal,
        fecha_inicio, fecha_fin, km_inicio, notas,
      }, req.user.id);
      // Una ambulancia nueva puede devolver a «activo» un trabajo pendiente
      // de cierre, o dejarlo programado si es la primera.
      if (trabajoId) await estadoTrabajo.sincronizarEstadoTrabajo(conn, trabajoId);
      return id;
    });

    const asig    = await getAsignacionCompleta(asignacionId);
    const solapes = await buscarSolapes([...responsables, ...personal], fecha_inicio, fecha_fin, asignacionId);
    const vehiculo_ocupado = await buscarVehiculoOcupado(vehicle_id, fecha_inicio, fecha_fin, asignacionId);

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'create_asignacion',
      entityType: 'asignacion', entityId: asig.id,
      details:  {
        vehiculo:     asig.matricula,
        responsable:  asig.responsable_username,
        responsables: asig.responsables.map(r => r.username),
        personal:     asig.personal.map(p => p.username),
      },
      ip: req.ip,
    });
    // Sin await: el aviso no retrasa la respuesta ni puede tumbarla.
    avisos.avisarAsignacionNueva(asig, [...responsables, ...personal], { asignadoPor: req.user.id });
    return created(res, {
      ...asig, solapes, vehiculo_ocupado,
      fuera_del_trabajo: fueraDelTrabajo(trabajo, fecha_inicio, fecha_fin),
    }, 'Asignación creada correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /asignaciones/:id
// ============================================================
// Qué ha cambiado entre dos lecturas de getAsignacionCompleta, para la
// auditoría: { campo: { antes, despues } }. Fechas como ISO para comparar el
// instante y no el objeto; miembros como lista de usernames.
function cambiosAsignacion(antes, despues) {
  const iso = v => (v == null ? null : new Date(v).toISOString());
  const nombres = lista => (lista || []).map(m => m.username);
  const campos = {
    vehiculo:     [a => a.matricula],
    trabajo:      [a => a.trabajo_id ?? null],
    fecha_inicio: [a => iso(a.fecha_inicio)],
    fecha_fin:    [a => iso(a.fecha_fin)],
    km_inicio:    [a => a.km_inicio ?? null],
    notas:        [a => a.notas || null],
    estado:       [a => a.estado],
    responsables: [a => nombres(a.responsables)],
    personal:     [a => nombres(a.personal)],
  };
  const cambios = {};
  for (const [campo, [leer]] of Object.entries(campos)) {
    const a = leer(antes);
    const d = leer(despues);
    if (JSON.stringify(a) !== JSON.stringify(d)) cambios[campo] = { antes: a, despues: d };
  }
  return cambios;
}

// El UPDATE no tocó la fila porque, entre leerla y escribir, apareció la
// primera foto o incidencia. Se lanza dentro de la transacción para deshacer
// también los miembros de esa misma edición.
class VehiculoConEvidencia extends Error {}

async function updateAsignacion(req, res, next) {
  try {
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    if (asig.estado === 'finalizada' || asig.estado === 'cancelada') {
      return error(res, `No se puede editar una asignación en estado "${asig.estado}"`, 400);
    }

    const { vehicle_id, fecha_inicio, fecha_fin, km_inicio, notas, estado } = req.body;

    const miembros = leerMiembros(req.body);
    if (miembros.error) return error(res, miembros.error, 400);
    const cambiaMiembros = miembros.responsables !== undefined || miembros.personal !== undefined;

    // Lo que no venga se conserva. El frontend anterior manda `user_id` en
    // TODO PUT, lo haya tocado o no: tomarlo como la lista completa recortaría
    // a un solo responsable una asignación que tenga varios. Con el formato
    // viejo solo se cambia el PRINCIPAL y el resto de responsables se queda.
    const actualesResp = asig.responsables.map(r => r.id);
    const actualesPers = asig.personal.map(p => p.id);
    const formatoViejo = req.body.responsables === undefined && req.body.user_id !== undefined;
    const responsables = formatoViejo
      ? [miembros.responsables[0], ...actualesResp.slice(1).filter(id => id !== miembros.responsables[0])]
      : (miembros.responsables ?? actualesResp);
    const personal     = (miembros.personal ?? actualesPers).filter(id => !responsables.includes(id));
    if (cambiaMiembros && !responsables.length) {
      return error(res, 'La asignación necesita al menos un responsable', 400);
    }

    // Validar solo si se cambian
    const cambiaVehiculo = !!vehicle_id && Number(vehicle_id) !== asig.vehicle_id;
    if (vehicle_id) {
      const [veh] = await query('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicle_id]);
      if (!veh.length) return notFound(res, 'Vehículo');

      // Reasignar el vehículo una vez hay evidencia (fotos o incidencias) es
      // peligroso: tanto getProgreso como crearIncidenciaDesdeAsignacion
      // graban/cuentan por asignación, no por vehículo, así que lo que ya se
      // subió del vehículo anterior seguiría contando —o quedaría mal
      // atribuido— para el nuevo. Lo que se mira es eso, no el estado: una
      // `activa` sin fotos (el técnico llama porque la ambulancia no le vale)
      // sí se puede cambiar. El UPDATE de abajo repite la condición para la
      // carrera con la primera foto.
      if (cambiaVehiculo && (asig.evidencias.length || asig.incidencias.length)) {
        return error(res, 'No se puede cambiar el vehículo: ya hay evidencia o incidencias registradas en esta asignación', 400);
      }
    }
    if (cambiaMiembros &&
        (await usuariosNoValidos([...responsables, ...personal], [...actualesResp, ...actualesPers])).length) {
      return notFound(res, 'Usuario');
    }

    // Solo pueden cambiar a programada/activa/cancelada mediante update
    const estadosPermitidos = ['programada', 'activa', 'cancelada'];
    if (estado && !estadosPermitidos.includes(estado)) {
      return error(res, `estado inválido. Usa el endpoint /activar o /finalizar`, 400);
    }

    // ── El trabajo (v33) ─────────────────────────────────────
    // Mover la ambulancia a otro trabajo, o meter en uno una asignación del
    // modelo antiguo: solo mientras no ha empezado y sin evidencia, el mismo
    // candado que el del vehículo y por lo mismo (las fotos cuelgan de la
    // asignación). Sacarla de su trabajo no se puede: siempre va en uno.
    const trabajoPedido = req.body.trabajo_id;
    if (trabajoPedido === null && asig.trabajo_id) {
      return error(res, 'Una ambulancia de un trabajo no se puede dejar sin trabajo', 400);
    }
    const cambiaTrabajo = trabajoPedido != null && Number(trabajoPedido) !== asig.trabajo_id;
    let trabajoDestino = asig.trabajo;
    if (cambiaTrabajo) {
      if (asig.estado !== 'programada') {
        return error(res, 'Solo se puede pasar a otro trabajo una ambulancia que aún no ha empezado', 400);
      }
      if (asig.evidencias.length || asig.incidencias.length) {
        return error(res, 'No se puede pasar a otro trabajo: ya hay evidencia o incidencias registradas en esta asignación', 400);
      }
      trabajoDestino = await cargarTrabajo(Number(trabajoPedido));
      if (!trabajoDestino) return notFound(res, 'Trabajo');
      if (!trabajoDestino.abierto) return error(res, 'El trabajo ya está cerrado: no admite más ambulancias', 400);
      if (asig.trabajo_id && await esUltimaDelTrabajo(asig.trabajo_id, asig.id)) {
        return error(res, 'Es la única ambulancia de su trabajo: no se puede sacar de él', 400);
      }
    }
    // D5, en el trabajo en el que queda: con otra ambulancia o en otro trabajo
    if ((cambiaVehiculo || cambiaTrabajo) && trabajoDestino &&
        await vehiculoYaEnTrabajo(trabajoDestino.id, Number(vehicle_id || asig.vehicle_id), asig.id)) {
      return error(res, 'Esa ambulancia ya va en este trabajo', 400);
    }
    // D6: la última ambulancia viva de un trabajo no se cancela
    if (estado === 'cancelada' && asig.trabajo_id && await esUltimaDelTrabajo(asig.trabajo_id, asig.id)) {
      return error(res, 'Es la única ambulancia del trabajo: no se puede cancelar. Si no va ninguna, elimina el trabajo', 400);
    }
    const tocaPadre = asig.trabajo_id || cambiaTrabajo;
    const sincronizados = [];

    const kmNuevo = km_inicio !== undefined ? km_inicio : null;
    try {
      await transaction(async (conn) => {
        const [resUpd] = await conn.execute(
          // La marca del aviso «sin iniciar» se limpia si cambia la hora
          // prevista: una asignación aplazada tiene que poder volver a avisar
          // a su nueva hora. Va la PRIMERA porque MySQL aplica el SET de
          // izquierda a derecha: detrás de `fecha_inicio = …` ya compararía
          // contra el valor nuevo y nunca vería el cambio.
          //
          // km_inicio: con otro vehículo, el de antes es de la ambulancia
          // anterior y no vale ni como referencia del cierre; se queda el que
          // venga en esta edición o NULL. Sin cambio de vehículo, COALESCE.
          //
          // El WHERE repite el candado del vehículo: entre leer la asignación
          // y este UPDATE el técnico puede haber subido la primera foto.
          `UPDATE asignaciones_libres SET
             aviso_sin_iniciar_at = IF(? <> fecha_inicio, NULL, aviso_sin_iniciar_at),
             vehicle_id   = COALESCE(?, vehicle_id),
             fecha_inicio = COALESCE(?, fecha_inicio),
             fecha_fin    = COALESCE(?, fecha_fin),
             km_inicio    = IF(?, ?, COALESCE(?, km_inicio)),
             notas        = IF(?, ?, notas),
             estado       = COALESCE(?, estado),
             trabajo_id   = COALESCE(?, trabajo_id)
           WHERE id = ?
             AND (? = 0 OR (
                   estado IN ('programada', 'activa')
               AND NOT EXISTS (SELECT 1 FROM vehicle_images     WHERE asignacion_id = asignaciones_libres.id)
               AND NOT EXISTS (SELECT 1 FROM vehicle_incidencias WHERE asignacion_id = asignaciones_libres.id)))`,
          [
            fecha_inicio || null,
            vehicle_id   || null,
            fecha_inicio || null,
            fecha_fin    || null,
            cambiaVehiculo ? 1 : 0, kmNuevo, kmNuevo,
            // Las notas no van por COALESCE: vaciarlas (`null` o '') tiene que
            // borrarlas, y con COALESCE un null conservaba las de antes.
            notas !== undefined ? 1 : 0,
            notas !== undefined ? (String(notas ?? '').trim() || null) : null,
            estado       || null,
            cambiaTrabajo ? Number(trabajoPedido) : null,
            asig.id,
            (cambiaVehiculo || cambiaTrabajo) ? 1 : 0,
          ]
        );
        // Lanzar deshace también el cambio de miembros de esta misma edición.
        if ((cambiaVehiculo || cambiaTrabajo) && resUpd && resUpd.affectedRows === 0) {
          throw new VehiculoConEvidencia();
        }
        if (cambiaMiembros) await guardarMiembros(conn, asig.id, responsables, personal);

        // Cancelarla o moverla cambia el estado del trabajo (o de los dos)
        if (tocaPadre && (estado || cambiaTrabajo)) {
          for (const tid of new Set([asig.trabajo_id, trabajoDestino?.id].filter(Boolean))) {
            sincronizados.push([tid, await estadoTrabajo.sincronizarEstadoTrabajo(conn, tid)]);
          }
        }
      });
    } catch (err) {
      if (err instanceof VehiculoConEvidencia) {
        return error(res, cambiaVehiculo
          ? 'No se puede cambiar el vehículo: se acaba de subir evidencia en esta asignación'
          : 'No se puede pasar a otro trabajo: se acaba de subir evidencia en esta asignación', 409);
      }
      throw err;
    }
    // Cancelar la última que faltaba deja el trabajo listo para cerrar
    for (const [tid, r] of sincronizados) estadoTrabajo.avisarSiPendienteCierre(tid, r);

    const updated = await getAsignacionCompleta(asig.id);
    const solapes = await buscarSolapes(
      [...responsables, ...personal], updated.fecha_inicio, updated.fecha_fin, asig.id);
    // La ambulancia solo se vuelve a mirar si cambia ella o las fechas: una
    // edición de notas no tiene por qué repetir un aviso que ya se dio.
    const instante = v => (v == null ? null : new Date(v).getTime());
    const cambianFechas = instante(updated.fecha_inicio) !== instante(asig.fecha_inicio)
                       || instante(updated.fecha_fin)    !== instante(asig.fecha_fin);
    const vehiculo_ocupado = (cambiaVehiculo || cambianFechas)
      ? await buscarVehiculoOcupado(updated.vehicle_id, updated.fecha_inicio, updated.fecha_fin, asig.id)
      : [];
    // D4, con el mismo criterio: solo si algo de lo que lo decide ha cambiado
    const fuera_del_trabajo = (cambianFechas || cambiaTrabajo)
      && fueraDelTrabajo(updated.trabajo, updated.fecha_inicio, updated.fecha_fin);

    // Se audita TODA edición que cambie algo, con el antes y el después de
    // cada campo tocado. Antes solo se registraba si cambiaban los miembros y
    // sin las notas: dos ediciones distintas dejaban entradas idénticas.
    const cambios = cambiosAsignacion(asig, updated);
    if (Object.keys(cambios).length) {
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'update_asignacion',
        entityType: 'asignacion', entityId: asig.id,
        details:  { vehiculo: updated.matricula, cambios },
        ip: req.ip,
      });
    }

    // Aviso de «nuevo servicio» solo a quien ENTRA en la asignación: quien ya
    // iba no tiene nada nuevo que saber. Pasar de personal a responsable no
    // cuenta como entrar. Una edición que la cancela no avisa a nadie.
    const antes = new Set([...actualesResp, ...actualesPers]);
    if (cambiaMiembros && updated.estado !== 'cancelada') {
      const entran = [...updated.responsables, ...updated.personal]
        .map(m => m.id).filter(id => !antes.has(id));
      if (entran.length) avisos.avisarAsignacionNueva(updated, entran, { asignadoPor: req.user.id });
    }

    // Cambio de vehículo: a quien YA iba (quien entra ahora recibe el «nuevo
    // servicio», que ya nombra la ambulancia nueva). Es la confirmación de la
    // llamada del técnico: hasta que le suena no sabe que puede ir a por la otra.
    if (cambiaVehiculo && updated.estado !== 'cancelada') {
      const seguian = [...updated.responsables, ...updated.personal]
        .map(m => m.id).filter(id => antes.has(id));
      if (seguian.length) {
        avisos.avisarCambioVehiculo(updated, seguian, { anterior: asig, cambiadoPor: req.user.id });
      }
    }
    return success(res, { ...updated, solapes, vehiculo_ocupado, fuera_del_trabajo }, 'Asignación actualizada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /asignaciones/:id
// ============================================================
async function deleteAsignacion(req, res, next) {
  try {
    const [rows] = await query(
      'SELECT id, estado, trabajo_id FROM asignaciones_libres WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return notFound(res, 'Asignación');
    const { trabajo_id: trabajoId } = rows[0];

    // D6: un trabajo no se queda sin ambulancias. Una cancelada ya no contaba.
    if (trabajoId && rows[0].estado !== 'cancelada' && await esUltimaDelTrabajo(trabajoId, rows[0].id)) {
      return error(res, 'Es la única ambulancia del trabajo: no se puede eliminar. Si no va ninguna, elimina el trabajo', 400);
    }

    let sincronizado = null;
    await transaction(async (conn) => {
      await conn.execute(
        'UPDATE asignaciones_libres SET deleted_at = ? WHERE id = ?',
        [ahora(), rows[0].id]
      );
      if (trabajoId) sincronizado = await estadoTrabajo.sincronizarEstadoTrabajo(conn, trabajoId);
    });
    if (trabajoId) estadoTrabajo.avisarSiPendienteCierre(trabajoId, sincronizado);

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'delete_asignacion',
      entityType: 'asignacion', entityId: rows[0].id,
      ip: req.ip,
    });
    return success(res, null, 'Asignación eliminada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/activar
// ============================================================
async function activarAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // Solo un responsable o admin/gestor pueden activar; el personal no
    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'Solo un responsable puede iniciar esta asignación');
    }

    // "Inicio de la asignación": sella la hora real. Es idempotente y funciona
    // aunque el cron ya la haya pasado a 'activa' (inicio_real_at seguiría NULL
    // hasta que el responsable pulse el botón).
    if (asig.estado === 'finalizada' || asig.estado === 'cancelada') {
      return error(res, `No se puede iniciar una asignación en estado "${asig.estado}"`, 400);
    }

    // No antes de media hora de la hora prevista, para nadie: la hora real que
    // se sella es la evidencia de cuándo empezó el servicio. Si ya está sellada
    // la pulsación es un no-op y no se le pone pega.
    if (!asig.inicio_real_at) {
      const desde = new Date(new Date(asig.fecha_inicio).getTime() - INICIO_ANTICIPADO_MAX_MINUTOS * 60000);
      if (ahora() < desde) {
        return error(
          res,
          `Aún no puedes iniciar la asignación: se puede a partir del ${diaYHoraEnEspana(desde)} ` +
          `(${INICIO_ANTICIPADO_MAX_MINUTOS} min antes de la hora prevista)`,
          400
        );
      }
    }

    // Se mira ANTES de tocar la fila: el endpoint es idempotente y pulsar dos
    // veces «Inicio de la asignación» no debe volver a hacer sonar los teléfonos.
    // Si el cron ya la había pasado a 'activa' tampoco se avisa aquí — el
    // aviso lo mandó el cron.
    const yaEstabaActiva = asig.estado === 'activa';

    await transaction(async (conn) => {
      await conn.execute(
        'UPDATE asignaciones_libres SET estado = ?, inicio_real_at = COALESCE(inicio_real_at, ?) WHERE id = ?',
        ['activa', ahora(), asig.id]
      );
      // La primera ambulancia que arranca pone el trabajo en marcha
      if (asig.trabajo_id) await estadoTrabajo.sincronizarEstadoTrabajo(conn, asig.trabajo_id);
    });

    if (!yaEstabaActiva) avisos.avisarAsignacionActivada(asig);

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'activate_asignacion',
      entityType: 'asignacion', entityId: asig.id,
      details:  { vehiculo: asig.matricula },
      ip: req.ip,
    });
    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Asignación activada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/llegada
// ============================================================
// «Inicio evento/servicio»: sella la hora real a la que la ambulancia llega al
// punto donde se presta el servicio. Entre el inicio (recoger el vehículo y
// revisarlo) y la llegada va el desplazamiento; sin este sello no hay forma de
// saber cuándo empezó de verdad el trabajo en el sitio.
async function registrarLlegada(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'Solo un responsable puede registrar el inicio del evento/servicio');
    }

    // Ya sellada: no-op. Se mira antes que el estado para que repetir la
    // pulsación (doble toque, reintento con mala red) no dé error aunque la
    // asignación se haya cerrado mientras tanto.
    if (asig.llegada_servicio_at) {
      return success(res, asig, 'La llegada ya estaba registrada');
    }

    if (asig.estado === 'finalizada' || asig.estado === 'cancelada') {
      return error(res, `No se puede registrar la llegada en una asignación ${asig.estado}`, 400);
    }
    if (asig.estado !== 'activa' || !asig.inicio_real_at) {
      return error(res, 'Primero hay que pulsar «Inicio de la asignación»', 400);
    }
    if (!asig.progreso.inicio.completo) {
      return error(
        res,
        `Antes de la llegada sube las fotos de inicio (faltan: ${asig.progreso.inicio.faltantes.join(', ')})`,
        400
      );
    }

    // `IS NULL` en el WHERE: si dos pulsaciones se cruzan, solo la primera
    // sella la hora y solo ella deja rastro en la auditoría.
    const [result] = await query(
      'UPDATE asignaciones_libres SET llegada_servicio_at = ? WHERE id = ? AND llegada_servicio_at IS NULL',
      [ahora(), asig.id]
    );

    // Auditoría y aviso, solo quien selló: la pulsación que llegó tarde a la
    // carrera no ha cambiado nada y no debe hacer sonar el teléfono otra vez.
    // Van antes de releer: si la relectura fallara, la hora ya está sellada y
    // el reintento cae en el no-op, así que no habría otra ocasión.
    if (result?.affectedRows) {
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'arrive_asignacion',
        entityType: 'asignacion', entityId: asig.id,
        details:  { vehiculo: asig.matricula },
        ip: req.ip,
      });
      avisos.avisarLlegadaEvento(asig);
    }

    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Inicio evento/servicio registrado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/fin-servicio
// ============================================================
// «Fin evento/servicio»: la pareja de la llegada. Sella la hora a la que se
// termina en el punto del servicio, antes de volver a base; entre la llegada y
// este sello va el tiempo en el sitio, y de aquí al cierre (fotos de fin) la
// vuelta. Igual de OPCIONAL que la llegada: el cierre no lo exige.
// Se llama «del evento» y no «del servicio» para no confundirla con el cierre
// de la asignación («Finalizar asignación»), que es otra cosa.
async function registrarFinServicio(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'Solo un responsable puede registrar el fin del evento/servicio');
    }

    // Ya sellado: no-op, antes que el estado (mismo motivo que la llegada).
    if (asig.fin_servicio_at) {
      return success(res, asig, 'El fin del evento/servicio ya estaba registrado');
    }

    if (asig.estado === 'finalizada' || asig.estado === 'cancelada') {
      return error(res, `No se puede registrar el fin del evento/servicio en una asignación ${asig.estado}`, 400);
    }
    // La llegada ya implica inicio pulsado y fotos de inicio completas
    // (registrarLlegada lo exige), así que basta con mirarla a ella.
    if (asig.estado !== 'activa' || !asig.llegada_servicio_at) {
      return error(res, 'Primero hay que pulsar «Inicio evento/servicio»', 400);
    }

    // Terminar en el sitio antes de la hora prevista (fecha_fin) exige
    // explicarlo. Se pide aquí y no al «Finalizar asignación» (decisión del
    // usuario, 2026-10-04): lo que acaba antes de tiempo es el evento; la
    // vuelta a base y las fotos de fin no dicen nada del porqué. Se guarda en
    // la misma columna motivo_fin que usaba el cierre, para no migrar.
    const instante = ahora();
    const esAnticipado = instante < new Date(asig.fecha_fin);
    const motivo = typeof req.body?.motivo_fin === 'string' ? req.body.motivo_fin.trim() : '';
    if (esAnticipado && !motivo) {
      // errors[].field: el móvil decide con SU reloj si enseña el campo; si
      // discrepa del servidor, con esto sabe que tiene que pedirlo.
      return error(res, 'Hay que explicar el motivo: el evento/servicio termina antes de la hora prevista', 400,
        [{ field: 'motivo_fin', msg: 'obligatorio' }]);
    }
    const falloMotivo = esAnticipado && errorMotivo(motivo);
    if (falloMotivo) return error(res, falloMotivo, 400, [{ field: 'motivo_fin', msg: falloMotivo }]);

    const [result] = await query(
      `UPDATE asignaciones_libres SET fin_servicio_at = ?, motivo_fin = COALESCE(?, motivo_fin)
       WHERE id = ? AND fin_servicio_at IS NULL`,
      [instante, esAnticipado ? motivo : null, asig.id]
    );

    // Mismo orden que la llegada: auditoría y aviso antes de releer.
    if (result?.affectedRows) {
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'end_service_asignacion',
        entityType: 'asignacion', entityId: asig.id,
        details:  { vehiculo: asig.matricula, anticipado: esAnticipado, motivo_fin: esAnticipado ? motivo : null },
        ip: req.ip,
      });
      avisos.avisarFinEvento(asig);
    }

    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Fin del evento/servicio registrado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/finalizar
// ============================================================
async function finalizarAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // Solo un responsable o admin/gestor pueden finalizar; el personal no
    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'Solo un responsable puede finalizar esta asignación');
    }

    if (asig.estado === 'finalizada') {
      return error(res, 'La asignación ya está finalizada', 400);
    }
    if (asig.estado === 'cancelada') {
      return error(res, 'No se puede finalizar una asignación cancelada', 400);
    }

    const { km_fin, material_usado } = req.body;

    // El motivo de fin anticipado se pide al pulsar «Fin evento/servicio»
    // (registrarFinServicio). Aquí, como red, si se cierra antes de fecha_fin
    // y no hay motivo guardado: botón olvidado, fin del evento pulsado tras
    // fecha_fin y fecha_fin ampliada luego, o asignaciones de antes de esto.
    // Se mira el motivo y no fin_servicio_at justo por esos dos últimos casos.
    const esAnticipada = ahora() < new Date(asig.fecha_fin);
    const pideMotivo = esAnticipada && !asig.motivo_fin;
    const motivo = typeof req.body.motivo_fin === 'string' ? req.body.motivo_fin.trim() : '';
    if (pideMotivo && !motivo) {
      return error(res, 'Hay que explicar el motivo: se finaliza antes de la hora prevista', 400,
        [{ field: 'motivo_fin', msg: 'obligatorio' }]);
    }
    const falloMotivo = pideMotivo && errorMotivo(motivo);
    if (falloMotivo) return error(res, falloMotivo, 400, [{ field: 'motivo_fin', msg: falloMotivo }]);

    // El material gastado se exige SIEMPRE, y no se acepta en blanco. Un campo
    // vacío no distingue «no gastó nada» de «no lo rellenó», y ese es
    // justamente el dato: por eso el mensaje dice qué escribir cuando no hubo
    // gasto en vez de limitarse a decir que falta.
    const material = typeof material_usado === 'string' ? material_usado.trim() : '';
    if (!material) {
      return error(
        res,
        'material_usado es obligatorio: indica el material utilizado o escribe "Sin gasto de material"',
        400
      );
    }

    // Validar que km_fin >= km_inicio (si se proporcionan ambos). `!= null`
    // cubre también un `km_fin: null` explícito (el validador lo permite) sin
    // que `null < km_inicio` lo confunda con un 0 real.
    if (km_fin != null && asig.km_inicio !== null && km_fin < asig.km_inicio) {
      return error(res, 'km_fin no puede ser menor que km_inicio', 400);
    }

    // El kilometraje del vehículo no puede retroceder al cerrar un servicio:
    // ni una lectura equivocada del técnico ni una asignación finalizada tarde
    // pueden dejar el contador por detrás de donde ya está. Bajarlo a
    // propósito (un error de anotación anterior, por ejemplo) solo se puede
    // desde la ficha del vehículo, que admin/gestor/superadmin sí pueden
    // editar libremente y con aviso — no desde aquí.
    if (km_fin != null && asig.vehiculo_km_actual != null && km_fin < asig.vehiculo_km_actual) {
      return error(
        res,
        `Los km introducidos (${km_fin}) no pueden ser menores que los km actuales del vehículo (${asig.vehiculo_km_actual}). Si el dato es correcto, corrígelo desde la ficha del vehículo.`,
        400
      );
    }

    // Validar que todas las evidencias (inicio y fin) están subidas
    const progreso = await getProgreso(asig.id);
    if (!progreso.inicio.completo) {
      return error(
        res,
        `No se puede finalizar: faltan fotos de INICIO (${progreso.inicio.faltantes.join(', ')}). Sube primero las fotos de inicio.`,
        400
      );
    }
    if (!progreso.fin.completo) {
      return error(
        res,
        `Faltan fotos de FIN: ${progreso.fin.faltantes.join(', ')}`,
        400
      );
    }

    // Cerrar la asignación y poner al día el vehículo van juntos: si el
    // kilometraje de la flota no avanzara, la ficha del vehículo se quedaría
    // congelada aunque la ambulancia lleve meses saliendo. Y el estado del
    // trabajo, también: la última en cerrar lo deja pendiente de cierre.
    let sincronizado = null;
    await transaction(async (conn) => {
      await conn.execute(
        `UPDATE asignaciones_libres SET
           estado         = 'finalizada',
           km_fin         = ?,
           motivo_fin     = COALESCE(?, motivo_fin),
           material_usado = ?,
           finalizado_por = ?,
           finalizado_at  = ?
         WHERE id = ?`,
        // COALESCE: si no toca pedir motivo se manda NULL y se conserva el
        // que dejó «Fin evento/servicio».
        [km_fin ?? null, pideMotivo ? motivo : null, material, req.user.id, ahora(), asig.id]
      );

      // Solo si el técnico ha anotado los km: aquí son opcionales (en trabajos
      // son obligatorios), y sin lectura del cuentakilómetros no hay nada que
      // propagar. La validación de arriba ya rechaza un km_fin por debajo del
      // actual; el guard `kilometros_actuales < ?` de aquí es la red de
      // seguridad para la carrera entre esa lectura y este UPDATE (otra
      // asignación que adelanta el contador justo en medio), no la regla en
      // sí. Mismo criterio que usa finalizeTrabajo, y por eso la fecha de
      // último servicio tampoco se toca cuando la lectura no supera a la que
      // ya había.
      if (km_fin != null) {
        await conn.execute(
          `UPDATE vehicles SET kilometros_actuales   = ?,
                               fecha_ultimo_servicio = ?
           WHERE id = ? AND kilometros_actuales < ?`,
          [km_fin, fechaEnEspana(), asig.vehicle_id, km_fin]
        );
      }
      if (asig.trabajo_id) {
        sincronizado = await estadoTrabajo.sincronizarEstadoTrabajo(conn, asig.trabajo_id);
      }
    });

    // Tras la transacción: si el cierre se hubiera deshecho, el aviso habría
    // anunciado un servicio que sigue abierto. Vale también por el aviso de
    // «fotos de fin completas» — llegar aquí exige tenerlas todas.
    avisos.avisarAsignacionFinalizada(asig, { km_fin });
    if (asig.trabajo_id) estadoTrabajo.avisarSiPendienteCierre(asig.trabajo_id, sincronizado);

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'finalize_asignacion',
      entityType: 'asignacion', entityId: asig.id,
      details:  { vehiculo: asig.matricula, km_fin: km_fin ?? null, anticipada: esAnticipada, motivo_fin: pideMotivo ? motivo : undefined, material_usado: material },
      ip: req.ip,
    });
    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Asignación finalizada correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/evidencias
// ============================================================
async function uploadEvidencia(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // Solo un responsable o admin/gestor pueden subir evidencias; el personal no
    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'No puedes subir evidencias de esta asignación');
    }

    if (asig.estado === 'finalizada') {
      return error(res, 'No se pueden subir evidencias a una asignación ya finalizada', 400);
    }

    if (!req.processedFile) {
      return error(res, 'No se ha recibido ninguna imagen', 400);
    }

    const { tipo_imagen } = req.body;
    const momento = req.body.momento || 'fin';
    const imageUrl = req.processedFile.url;

    if (!['inicio', 'fin', 'general'].includes(momento)) {
      return error(res, 'momento debe ser "inicio", "fin" o "general"', 400);
    }
    const listaValida = momento === 'inicio' ? IMAGEN_TIPOS_INICIO
                      : momento === 'fin'    ? IMAGEN_TIPOS_FIN
                      : IMAGEN_TIPOS_GENERAL;
    if (!listaValida.includes(tipo_imagen)) {
      return error(res,
        `tipo_imagen "${tipo_imagen}" no es válido para momento="${momento}". Válidos: ${listaValida.join(', ')}`,
        400
      );
    }

    // Foto de inicio: hay que saber si esta subida es la que completa la tanda
    // para avisar una sola vez. Se mide antes y después de guardar; rehacer una
    // foto ya subida deja el progreso como estaba y no vuelve a avisar.
    const inicioCompletoAntes = momento === 'inicio'
      ? (await getProgreso(asig.id)).inicio.completo
      : true;

    // Las fotos 'general' (incidencias/observaciones) son acumulables: no se
    // reemplazan entre sí. El resto (inicio/fin) es único por tipo+momento.
    const [existing] = momento === 'general' ? [[]] : await query(
      `SELECT id, image_url FROM vehicle_images
       WHERE asignacion_id = ? AND tipo_imagen = ? AND momento = ?`,
      [asig.id, tipo_imagen, momento]
    );

    // El instante lo pone Node (contrato de fechas), y al rehacer una foto se
    // vuelve a sellar: la hora que se ve es la de la imagen que se conserva.
    const tomadaEn = ahora();

    let imageId;
    if (existing.length) {
      // Borrar el archivo anterior
      deleteFile(existing[0].image_url);
      await query(
        'UPDATE vehicle_images SET image_url = ?, uploaded_by = ?, created_at = ? WHERE id = ?',
        [imageUrl, req.user.id, tomadaEn, existing[0].id]
      );
      imageId = existing[0].id;
    } else {
      const [result] = await query(
        `INSERT INTO vehicle_images (vehicle_id, asignacion_id, tipo_imagen, momento, image_url, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [asig.vehicle_id, asig.id, tipo_imagen, momento, imageUrl, req.user.id, tomadaEn]
      );
      imageId = result.insertId;
    }

    const progreso = await getProgreso(asig.id);

    // El salto de incompleto a completo es el suceso, no el hecho de que esté
    // completo: sin esta comparación, cada foto rehecha después volvería a
    // hacer sonar los teléfonos.
    if (momento === 'inicio' && !inicioCompletoAntes && progreso.inicio.completo) {
      avisos.avisarFotosInicioCompletas(asig);
    }

    return success(res, {
      id:          imageId,
      image_url:   imageUrl,
      tipo_imagen,
      momento,
      asignacion_id: asig.id,
      uploaded_at:   tomadaEn,
      progreso,
    }, 'Evidencia subida correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/incidencias
// Registra una incidencia detectada al revisar la asignación.
// Queda vinculada al vehículo, a ESTA asignación y al técnico
// responsable de la misma (no al responsable actual del vehículo).
// ============================================================
async function crearIncidenciaDesdeAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_INCIDENCIAS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // El responsable de la asignación puede registrar incidencias en la suya;
    // admin/gestor (MANAGE_INCIDENCIAS) en cualquiera.
    // El personal acompañante NO registra incidencias: solo ve la asignación.
    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'Solo un responsable o un gestor pueden registrar incidencias en esta asignación');
    }

    const { tipo, gravedad, descripcion, responsable_user_id } = req.body;
    if (!descripcion || !descripcion.trim()) {
      return error(res, 'Descripción requerida', 400);
    }

    // Por defecto la incidencia queda asignada al responsable de la
    // asignación: a quien la registra si es uno de ellos (con varios
    // responsables, el principal puede no tener nada que ver) y si no al
    // principal. Admin/gestor puede atribuírsela a otro empleado.
    const reportaResponsable = rolEnAsignacion(asig, req.user.id) === 'responsable';
    let responsableId       = reportaResponsable ? req.user.id       : asig.user_id;
    let responsableUsername = reportaResponsable ? req.user.username : asig.responsable_username;
    if (responsable_user_id !== undefined && responsable_user_id !== null) {
      if (!canManage) {
        return forbidden(res, 'Solo un gestor puede asignar la incidencia a otro empleado');
      }
      const [urow] = await query(
        'SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL',
        [responsable_user_id]
      );
      if (!urow.length) return error(res, 'El empleado indicado no existe', 400);
      responsableId       = urow[0].id;
      responsableUsername = urow[0].username;
    }

    const [result] = await query(
      `INSERT INTO vehicle_incidencias
         (vehicle_id, trabajo_id, asignacion_id, reported_by, responsable_user_id,
          tipo, gravedad, descripcion)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        asig.vehicle_id,
        asig.id,
        req.user.id,
        responsableId,
        tipo     || 'dano_exterior',
        gravedad || 'leve',
        descripcion.trim(),
      ]
    );

    const [created_row] = await query(
      'SELECT * FROM vehicle_incidencias WHERE id = ?', [result.insertId]
    );

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'create_incidencia',
      entityType: 'vehicle', entityId: asig.vehicle_id,
      details:  {
        asignacion_id: asig.id,
        vehiculo:      asig.matricula,
        responsable_user_id: responsableId,
        responsable:   responsableUsername,
        tipo:          tipo || 'dano_exterior',
        gravedad:      gravedad || 'leve',
        descripcion:   descripcion.trim(),
      },
      ip: req.ip,
    });

    return created(res, created_row[0], 'Incidencia registrada y asignada al responsable');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAsignaciones,
  listAlarmas,
  getAsignacion,
  createAsignacion,
  updateAsignacion,
  deleteAsignacion,
  activarAsignacion,
  registrarLlegada,
  registrarFinServicio,
  finalizarAsignacion,
  uploadEvidencia,
  crearIncidenciaDesdeAsignacion,
  rolEnAsignacion,
  esCoordinador,
  leerMiembros,
  // Para el alta de un trabajo con su primera ambulancia (trabajos.controller)
  usuariosNoValidos,
  insertarAsignacion,
  fueraDelTrabajo,
  getAsignacionCompleta,
};
