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
const avisos                     = require('../services/avisosAsignacion.service');
const vigilancia                 = require('../services/vigilancia.service');

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
 * «Inicio de servicio». Marca cada evidencia de inicio con `retraso_min` (null
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

// Helper: obtener asignación completa con relaciones
async function getAsignacionCompleta(id) {
  const [rows] = await query(
    `SELECT al.*,
            v.matricula, v.alias AS vehiculo_alias,
            v.kilometros_actuales AS vehiculo_km_actual,
            CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
            u.username AS responsable_username,
            CONCAT(c.nombre,' ',c.apellidos) AS creado_por_nombre
     FROM asignaciones_libres al
     JOIN vehicles v ON al.vehicle_id = v.id
     JOIN users u    ON al.user_id    = u.id
     JOIN users c    ON al.created_by = c.id
     WHERE al.id = ? AND al.deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) return null;

  const asig = rows[0];

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
 * reloj. Un responsable que pulsa «Inicio de servicio» antes de la hora deja
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
    const limit  = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT);
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

    const where = 'WHERE ' + whereParts.join(' AND ');

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM asignaciones_libres al ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT al.id, al.vehicle_id, al.user_id, al.fecha_inicio, al.fecha_fin,
              al.estado, al.inicio_real_at, al.llegada_servicio_at, al.km_inicio, al.km_fin, al.notas, al.created_at,
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

    // Operacionales solo ven aquellas en las que van (responsable o personal)
    if (!canManage && !rolEnAsignacion(asig, req.user.id)) {
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

    const asignacionId = await transaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO asignaciones_libres
           (vehicle_id, user_id, created_by, fecha_inicio, fecha_fin, km_inicio, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vehicle_id, responsables[0], req.user.id, fecha_inicio, fecha_fin, km_inicio || null, notas || null]
      );
      await guardarMiembros(conn, result.insertId, responsables, personal);
      return result.insertId;
    });

    const asig    = await getAsignacionCompleta(asignacionId);
    const solapes = await buscarSolapes([...responsables, ...personal], fecha_inicio, fecha_fin, asignacionId);

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
    return created(res, { ...asig, solapes }, 'Asignación creada correctamente');
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
    if (vehicle_id) {
      const [veh] = await query('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicle_id]);
      if (!veh.length) return notFound(res, 'Vehículo');

      // Reasignar el vehículo una vez hay evidencia (fotos o incidencias) es
      // peligroso: tanto getProgreso como crearIncidenciaDesdeAsignacion
      // graban/cuentan por asignación, no por vehículo, así que lo que ya se
      // subió del vehículo anterior seguiría contando —o quedaría mal
      // atribuido— para el nuevo. Se corta de raíz: solo se puede cambiar
      // mientras sigue "programada" y no hay ni una foto ni una incidencia
      // registrada todavía.
      if (Number(vehicle_id) !== asig.vehicle_id) {
        if (asig.estado !== 'programada') {
          return error(res, 'El vehículo solo se puede cambiar mientras la asignación está "programada"', 400);
        }
        if (asig.evidencias.length || asig.incidencias.length) {
          return error(res, 'No se puede cambiar el vehículo: ya hay evidencia o incidencias registradas en esta asignación', 400);
        }
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

    await transaction(async (conn) => {
      await conn.execute(
        // La marca del aviso «sin iniciar» se limpia si cambia la hora
        // prevista: una asignación aplazada tiene que poder volver a avisar
        // a su nueva hora. Va la PRIMERA porque MySQL aplica el SET de
        // izquierda a derecha: detrás de `fecha_inicio = …` ya compararía
        // contra el valor nuevo y nunca vería el cambio.
        `UPDATE asignaciones_libres SET
           aviso_sin_iniciar_at = IF(? <> fecha_inicio, NULL, aviso_sin_iniciar_at),
           vehicle_id   = COALESCE(?, vehicle_id),
           fecha_inicio = COALESCE(?, fecha_inicio),
           fecha_fin    = COALESCE(?, fecha_fin),
           km_inicio    = COALESCE(?, km_inicio),
           notas        = IF(?, ?, notas),
           estado       = COALESCE(?, estado)
         WHERE id = ?`,
        [
          fecha_inicio || null,
          vehicle_id   || null,
          fecha_inicio || null,
          fecha_fin    || null,
          km_inicio    !== undefined ? km_inicio : null,
          // Las notas no van por COALESCE: vaciarlas (`null` o '') tiene que
          // borrarlas, y con COALESCE un null conservaba las de antes.
          notas !== undefined ? 1 : 0,
          notas !== undefined ? (String(notas ?? '').trim() || null) : null,
          estado       || null,
          asig.id,
        ]
      );
      if (cambiaMiembros) await guardarMiembros(conn, asig.id, responsables, personal);
    });

    const updated = await getAsignacionCompleta(asig.id);
    const solapes = await buscarSolapes(
      [...responsables, ...personal], updated.fecha_inicio, updated.fecha_fin, asig.id);

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
    return success(res, { ...updated, solapes }, 'Asignación actualizada');
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
      'SELECT id, estado FROM asignaciones_libres WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return notFound(res, 'Asignación');

    await query(
      'UPDATE asignaciones_libres SET deleted_at = ? WHERE id = ?',
      [ahora(), rows[0].id]
    );

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

    // "Inicio de servicio": sella la hora real. Es idempotente y funciona
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
          `Aún no puedes iniciar el servicio: se puede a partir del ${diaYHoraEnEspana(desde)} ` +
          `(${INICIO_ANTICIPADO_MAX_MINUTOS} min antes de la hora prevista)`,
          400
        );
      }
    }

    // Se mira ANTES de tocar la fila: el endpoint es idempotente y pulsar dos
    // veces «Inicio de servicio» no debe volver a hacer sonar los teléfonos.
    // Si el cron ya la había pasado a 'activa' tampoco se avisa aquí — el
    // aviso lo mandó el cron.
    const yaEstabaActiva = asig.estado === 'activa';

    await query(
      'UPDATE asignaciones_libres SET estado = ?, inicio_real_at = COALESCE(inicio_real_at, ?) WHERE id = ?',
      ['activa', ahora(), asig.id]
    );

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
// «Llegada al servicio»: sella la hora real a la que la ambulancia llega al
// punto donde se presta el servicio. Entre el inicio (recoger el vehículo y
// revisarlo) y la llegada va el desplazamiento; sin este sello no hay forma de
// saber cuándo empezó de verdad el trabajo en el sitio.
async function registrarLlegada(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    if (!canManage && rolEnAsignacion(asig, req.user.id) !== 'responsable') {
      return forbidden(res, 'Solo un responsable puede registrar la llegada al servicio');
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
      return error(res, 'Primero hay que pulsar «Inicio de servicio»', 400);
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

    if (result?.affectedRows) {
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'arrive_asignacion',
        entityType: 'asignacion', entityId: asig.id,
        details:  { vehiculo: asig.matricula },
        ip: req.ip,
      });
    }

    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Llegada al servicio registrada');
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

    const { km_fin, motivo_fin, material_usado } = req.body;

    // Si es anticipada (ahora < fecha_fin), el motivo es obligatorio
    const esAnticipada = ahora() < new Date(asig.fecha_fin);
    if (esAnticipada && (!motivo_fin || !motivo_fin.trim())) {
      return error(res, 'motivo_fin es obligatorio cuando la finalización es anticipada', 400);
    }

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
    // congelada aunque la ambulancia lleve meses saliendo.
    await transaction(async (conn) => {
      await conn.execute(
        `UPDATE asignaciones_libres SET
           estado         = 'finalizada',
           km_fin         = ?,
           motivo_fin     = ?,
           material_usado = ?,
           finalizado_por = ?,
           finalizado_at  = ?
         WHERE id = ?`,
        [km_fin ?? null, motivo_fin || null, material, req.user.id, ahora(), asig.id]
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
    });

    // Tras la transacción: si el cierre se hubiera deshecho, el aviso habría
    // anunciado un servicio que sigue abierto. Vale también por el aviso de
    // «fotos de fin completas» — llegar aquí exige tenerlas todas.
    avisos.avisarAsignacionFinalizada(asig, { km_fin });

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'finalize_asignacion',
      entityType: 'asignacion', entityId: asig.id,
      details:  { vehiculo: asig.matricula, km_fin: km_fin ?? null, anticipada: esAnticipada, motivo_fin: motivo_fin || null, material_usado: material },
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
  finalizarAsignacion,
  uploadEvidencia,
  crearIncidenciaDesdeAsignacion,
  rolEnAsignacion,
  leerMiembros,
};
