/**
 * controllers/trabajos.controller.js
 * CRUD de trabajos, su cierre por el coordinador y «mis trabajos».
 *
 * Desde v33 el trabajo es el PADRE: sus ambulancias son asignaciones
 * (`asignaciones_libres.trabajo_id`), cada una con su ciclo de vida completo,
 * sus responsables y su equipo, y todo eso lo opera asignaciones.controller.
 * Aquí queda lo del trabajo: los datos, quién lo coordina, quién ve qué
 * (`vistaParaUsuario`) y el cierre. El estado se DERIVA de las asignaciones
 * (services/estadoTrabajo.service) salvo el último paso, que es un acto del
 * coordinador (`cerrarTrabajo`).
 *
 * Conviven los trabajos del modelo v25, con sus vehículos en
 * `trabajo_vehiculos` y su ciclo propio (activarVehiculo, finalizeVehiculo,
 * uploadEvidencia, y activar/finalize de trabajos sin vehículos). Esas rutas
 * siguen vivas hasta la fase 6 del plan del trabajo padre. Reglas en §6.1 y
 * §6.2 del mapa.
 */

'use strict';

const { query, transaction }          = require('../config/database');
const { success, created, error, notFound, forbidden, paginated } =
  require('../utils/response.utils');
const { PAGINATION, TRABAJO_ESTADOS, TRABAJO_ID_PREFIX, PERMISSIONS,
        IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN } =
  require('../config/constants');
const { hasPermission }               = require('../middleware/roles.middleware');
const { logAudit }                    = require('./admin.controller');
const { ahora, fechaEnEspana, anioMesEnEspana, instanteEnEspana, instanteUtc } =
  require('../utils/fecha.utils');
const { errorMotivo }                 = require('../utils/motivo.utils');
const estadoTrabajo                   = require('../services/estadoTrabajo.service');
const avisos                          = require('../services/avisosAsignacion.service');
const asignaciones                    = require('./asignaciones.controller');

const { CERRADOS } = estadoTrabajo;
const { sincronizarEstadoTrabajo } = estadoTrabajo;

// ============================================================
// Quién es quién
// ============================================================

/** Activa, cierra y edita cualquier vehículo de cualquier trabajo. */
const gestiona = (user) => hasPermission(user, PERMISSIONS.MANAGE_TRABAJOS);

/**
 * Ve todos los trabajos y el detalle completo de todos sus vehículos. Sin
 * esto solo se ven los trabajos propios (equipo o responsable de un vehículo).
 * Antes el recorte colgaba de `isOperacional`, y un usuario SIN ningún rol —la
 * mayoría de la plantilla— no era «operacional» y veía la lista entera.
 */
const veTodo = (user) =>
  gestiona(user) || hasPermission(user, PERMISSIONS.VIEW_ALL_TRABAJOS);

/**
 * «Es mío»: lo coordino, o voy en alguna de sus ambulancias (responsable o
 * equipo de una asignación viva: la cancelada ya no lleva a nadie). Y los del
 * modelo v25: en su equipo o responsable de alguno de sus vehículos. Lleva
 * CUATRO parámetros, todos el id del usuario (`propios(uid)`).
 */
const FILTRO_PROPIOS = `(
  t.coordinador_user_id = ?
  OR EXISTS (SELECT 1 FROM asignaciones_libres alp
               JOIN asignacion_usuarios aup ON aup.asignacion_id = alp.id
              WHERE alp.trabajo_id = t.id AND alp.deleted_at IS NULL
                AND alp.estado <> 'cancelada' AND aup.user_id = ?)
  OR EXISTS (SELECT 1 FROM trabajo_usuarios tu WHERE tu.trabajo_id = t.id AND tu.user_id = ?)
  OR EXISTS (SELECT 1 FROM trabajo_vehiculos tvp
               JOIN trabajo_vehiculo_responsables tvr ON tvr.trabajo_vehiculo_id = tvp.id
              WHERE tvp.trabajo_id = t.id AND tvr.user_id = ?))`;
const propios = (uid) => [uid, uid, uid, uid];

// ============================================================
// Helpers
// ============================================================

/** Genera identificador único: TRB-2024-0001 */
async function generateIdentificador() {
  const year = anioMesEnEspana().anio;
  const [rows] = await query(
    `SELECT identificador FROM trabajos
     WHERE identificador LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${TRABAJO_ID_PREFIX}-${year}-%`]
  );
  let seq = 1;
  if (rows.length) {
    const last = rows[0].identificador.split('-').pop();
    seq = parseInt(last) + 1;
  }
  return `${TRABAJO_ID_PREFIX}-${year}-${String(seq).padStart(4, '0')}`;
}

/** Texto opcional: recortado, y el vacío se guarda como NULL. */
function textoOpcional(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const t = String(valor).trim();
  return t || null;
}

/** Lista de ids enteros de un campo del body, o undefined si no viene. */
function idsDe(valor) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista.map(v => Number(v));
}

/**
 * Normaliza `vehiculos` del body. Cada uno necesita al menos un responsable.
 * Acepta `responsable_user_id` suelto (el formulario anterior) además de
 * `responsables: [ids]`.
 *
 * @returns {{vehiculos?: Array<{vehicle_id, responsables, kilometros_inicio}>, error?: string}}
 */
function leerVehiculos(lista) {
  if (lista === undefined) return {};
  if (!Array.isArray(lista)) return { error: 'vehiculos debe ser una lista' };

  const vehiculos = [];
  for (const veh of lista) {
    const vehicleId = Number(veh?.vehicle_id);
    if (!Number.isInteger(vehicleId) || vehicleId < 1) {
      return { error: 'Cada vehículo del trabajo necesita un vehicle_id válido' };
    }
    const responsables = idsDe(veh.responsables) ?? idsDe(veh.responsable_user_id) ?? [];
    if (!responsables.length) {
      return { error: 'Cada vehículo necesita al menos un responsable' };
    }
    if (responsables.some(id => !Number.isInteger(id) || id < 1)) {
      return { error: 'Los responsables deben ser ids de usuario válidos' };
    }
    if (new Set(responsables).size !== responsables.length) {
      return { error: 'La misma persona no puede figurar dos veces como responsable del mismo vehículo' };
    }
    const km = veh.kilometros_inicio;
    vehiculos.push({
      vehicle_id: vehicleId,
      responsables,
      kilometros_inicio: km === undefined || km === null || km === '' ? null : Number(km),
    });
  }
  if (new Set(vehiculos.map(v => v.vehicle_id)).size !== vehiculos.length) {
    return { error: 'El mismo vehículo no puede figurar dos veces en el trabajo' };
  }
  return { vehiculos };
}

/**
 * Ids que no existen o están dados de baja. `yaMiembros` se salta: quien ya
 * iba en el trabajo no bloquea una edición aunque desde entonces lo hayan
 * dado de baja.
 */
async function usuariosNoValidos(ids, yaMiembros = []) {
  const nuevos = [...new Set(ids)].filter(id => !yaMiembros.includes(id));
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

/**
 * Reescribe los responsables de un vehículo del trabajo y sincroniza el
 * principal (`trabajo_vehiculos.responsable_user_id`, el primero de la lista),
 * que siguen leyendo la vista v_trabajos_activos y el historial del vehículo.
 */
async function guardarResponsables(conn, trabajoVehiculoId, responsables) {
  await conn.execute(
    'DELETE FROM trabajo_vehiculo_responsables WHERE trabajo_vehiculo_id = ?',
    [trabajoVehiculoId]
  );
  await conn.execute(
    `INSERT INTO trabajo_vehiculo_responsables (trabajo_vehiculo_id, user_id, orden)
     VALUES ${responsables.map(() => '(?, ?, ?)').join(', ')}`,
    responsables.flatMap((id, i) => [trabajoVehiculoId, id, i])
  );
  await conn.execute(
    'UPDATE trabajo_vehiculos SET responsable_user_id = ? WHERE id = ?',
    [responsables[0], trabajoVehiculoId]
  );
}

/** Progreso de fotos de inicio y fin de un vehículo, a partir de sus imágenes. */
function progresoDe(fotosVeh) {
  const tanda = (tipos, momento) => {
    const ok = tipos.filter(t => fotosVeh.some(i => i.momento === momento && i.tipo_imagen === t));
    return {
      completado: ok.length,
      total:      tipos.length,
      faltantes:  tipos.filter(t => !ok.includes(t)),
      completo:   ok.length === tipos.length,
    };
  };
  return { inicio: tanda(IMAGEN_TIPOS_INICIO, 'inicio'), fin: tanda(IMAGEN_TIPOS_FIN, 'fin') };
}

/**
 * Las ambulancias de un trabajo del modelo nuevo (v33): sus asignaciones vivas
 * con quién va en cada una y el progreso de sus fotos. Sin las imágenes: se
 * ven en la ficha de cada asignación, que es donde se operan.
 */
async function leerAsignacionesDelTrabajo(id) {
  const [asigs] = await query(
    `SELECT al.id, al.vehicle_id, al.user_id, al.estado, al.fecha_inicio, al.fecha_fin,
            al.inicio_real_at, al.llegada_servicio_at, al.fin_servicio_at, al.finalizado_at,
            al.km_inicio, al.km_fin, al.notas,
            v.matricula, v.alias AS vehiculo_alias
     FROM asignaciones_libres al
     JOIN vehicles v ON v.id = al.vehicle_id
     WHERE al.trabajo_id = ? AND al.deleted_at IS NULL
     ORDER BY al.estado = 'cancelada', al.fecha_inicio, al.id`,
    [id]
  );
  if (!asigs.length) return [];

  const [miembros] = await query(
    `SELECT au.asignacion_id, au.rol, u.id, u.nombre, u.apellidos, u.username
     FROM asignacion_usuarios au
     JOIN asignaciones_libres al ON al.id = au.asignacion_id
     JOIN users u ON u.id = au.user_id
     WHERE al.trabajo_id = ? AND al.deleted_at IS NULL
     ORDER BY au.asignacion_id, au.orden, au.created_at`,
    [id]
  );
  const [fotos] = await query(
    `SELECT vi.asignacion_id, vi.tipo_imagen, vi.momento
     FROM vehicle_images vi
     JOIN asignaciones_libres al ON al.id = vi.asignacion_id
     WHERE al.trabajo_id = ? AND al.deleted_at IS NULL`,
    [id]
  );
  const persona = ({ asignacion_id, rol, ...p }) => p;
  return asigs.map(a => ({
    ...a,
    responsables: miembros.filter(m => m.asignacion_id === a.id && m.rol === 'responsable').map(persona),
    personal:     miembros.filter(m => m.asignacion_id === a.id && m.rol === 'personal').map(persona),
    progreso_fotos: progresoDe(fotos.filter(f => f.asignacion_id === a.id)),
  }));
}

/** Obtiene el trabajo completo, SIN recortar (el recorte es `vistaParaUsuario`). */
async function getTrabajoCompleto(id) {
  const [trows] = await query(
    `SELECT t.*, u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos,
            co.nombre AS coordinador_nombre, co.apellidos AS coordinador_apellidos
     FROM trabajos t
     JOIN users u ON t.created_by = u.id
     LEFT JOIN users co ON co.id = t.coordinador_user_id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  );
  if (!trows.length) return null;

  const { coordinador_nombre, coordinador_apellidos, ...t } = trows[0];
  t.coordinador = t.coordinador_user_id
    ? { id: t.coordinador_user_id, nombre: coordinador_nombre, apellidos: coordinador_apellidos }
    : null;
  t.asignaciones = await leerAsignacionesDelTrabajo(id);

  const [vehicles] = await query(
    `SELECT tv.id AS trabajo_vehiculo_id, tv.vehicle_id, tv.responsable_user_id,
            tv.estado, tv.inicio_real_at, tv.finalizado_at, tv.motivo_finalizacion_anticipada,
            tv.kilometros_inicio, tv.kilometros_fin,
            v.matricula, v.alias AS vehiculo_alias, v.kilometros_actuales AS vehiculo_km_actual
     FROM trabajo_vehiculos tv
     JOIN vehicles v ON tv.vehicle_id = v.id
     WHERE tv.trabajo_id = ?
     ORDER BY tv.id`,
    [id]
  );

  const [responsables] = await query(
    `SELECT tvr.trabajo_vehiculo_id, u.id, u.username, u.nombre, u.apellidos
     FROM trabajo_vehiculo_responsables tvr
     JOIN trabajo_vehiculos tv ON tv.id = tvr.trabajo_vehiculo_id
     JOIN users u ON u.id = tvr.user_id
     WHERE tv.trabajo_id = ?
     ORDER BY tvr.trabajo_vehiculo_id, tvr.orden`,
    [id]
  );

  // Equipo: ve la ficha del trabajo, no la evidencia de los vehículos
  const [usuarios] = await query(
    `SELECT tu.user_id, u.username, u.nombre, u.apellidos,
            GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
     FROM trabajo_usuarios tu
     JOIN users u ON tu.user_id = u.id
     LEFT JOIN user_roles ur ON u.id = ur.user_id
     LEFT JOIN roles r ON ur.role_id = r.id
     WHERE tu.trabajo_id = ?
     GROUP BY tu.user_id`,
    [id]
  );

  const [images] = await query(
    `SELECT vi.id, vi.vehicle_id, vi.tipo_imagen, vi.momento, vi.image_url, vi.created_at,
            v.matricula
     FROM vehicle_images vi
     JOIN vehicles v ON vi.vehicle_id = v.id
     WHERE vi.trabajo_id = ?
     ORDER BY FIELD(vi.momento,'inicio','fin','general'), vi.created_at ASC`,
    [id]
  );

  return {
    ...t,
    vehiculos: vehicles.map(v => ({
      ...v,
      responsables: responsables
        .filter(r => r.trabajo_vehiculo_id === v.trabajo_vehiculo_id)
        .map(({ trabajo_vehiculo_id, ...r }) => r),
      progreso_fotos: progresoDe(images.filter(i => i.vehicle_id === v.vehicle_id)),
    })),
    usuarios:  usuarios.map(u => ({ ...u, roles: u.roles ? u.roles.split(',') : [] })),
    evidencias: images,
  };
}

/**
 * Por qué NO se puede cerrar el trabajo ahora (o null si se puede). La usan
 * `cerrarTrabajo` (que manda) y `vistaParaUsuario` (`puede_cerrar`, para no
 * ofrecer el botón en vano), así que dicen lo mismo.
 *  - D3: ninguna ambulancia abierta (programada o activa).
 *  - Sin ninguna viva (2026-10-10: un trabajo puede no tener ambulancias, o
 *    quedarse sin ellas), solo una vez empezado: antes, lo que toca si no se
 *    va a hacer es eliminarlo, no cerrarlo como hecho.
 *  - Un trabajo v25 (con vehículos en trabajo_vehiculos) se cierra por ellos.
 *
 * @param {{estado, fecha_inicio, v25: boolean}} t
 * @param {string[]} estados  los de sus asignaciones no borradas
 */
function motivoNoSeCierra(t, estados) {
  if (CERRADOS.includes(t.estado)) return 'El trabajo ya está cerrado';
  if (t.v25) return 'Este trabajo es del modelo anterior: se cierra al cerrar sus vehículos';
  const abiertas = estados.filter(e => e === 'programada' || e === 'activa').length;
  if (abiertas) {
    return `No se puede cerrar: ${abiertas === 1 ? 'queda 1 ambulancia' : `quedan ${abiertas} ambulancias`} sin finalizar`;
  }
  const vivas = estados.filter(e => e !== 'cancelada').length;
  if (!vivas && instanteUtc(t.fecha_inicio) > ahora()) {
    return 'Aún no ha empezado y no lleva ninguna ambulancia: si no se va a hacer, elimínalo';
  }
  return null;
}

/**
 * De una ambulancia ajena solo se ve cuál es y quién va en ella (decisión 6
 * del plan del trabajo padre): ni estado, ni fechas, ni km, ni fotos. Es una
 * LISTA BLANCA a propósito (§6.2 del mapa): un campo nuevo de la asignación no
 * se le escapa a nadie por no haberlo quitado aquí.
 */
function ambulanciaAjena(a) {
  return {
    id: a.id, vehicle_id: a.vehicle_id, matricula: a.matricula, vehiculo_alias: a.vehiculo_alias,
    responsables: a.responsables, personal: a.personal,
    mi_rol: null, detalle: false,
  };
}

/**
 * Lo que este usuario puede ver del trabajo, o null si no puede verlo.
 *
 * Modelo nuevo (asignaciones, v33):
 *  - Gestión (ver todo) y el coordinador: todas las ambulancias, con detalle (D2).
 *  - Quien va en una ambulancia (responsable o equipo): la suya entera; de las
 *    demás, `ambulanciaAjena`. Las canceladas no se le enseñan.
 * Cada ambulancia sale con `mi_rol` ('responsable' | 'equipo' | null) y
 * `detalle`, para que el frontend no tenga que repetir la regla.
 *
 * Modelo v25 (vehículos):
 *  - Responsable: el detalle (km, fotos, progreso) de SUS vehículos; el resto,
 *    recortado como a cualquiera del equipo.
 *  - Equipo: título, descripción, ubicación, fechas y qué vehículos van (alias,
 *    matrícula, estado, responsables), sin evidencia ni kilómetros.
 * Cada vehículo sale con `soy_responsable` y `detalle`.
 */
function vistaParaUsuario(t, user) {
  const todo     = veTodo(user);
  const coordina = !!t.coordinador_user_id && t.coordinador_user_id === user.id;
  const enEquipo = t.usuarios.some(u => u.user_id === user.id);

  const rolEn = (a) => (a.responsables.some(r => r.id === user.id) ? 'responsable'
    : a.personal.some(p => p.id === user.id) ? 'equipo' : null);
  const asignacionesVista = (t.asignaciones || [])
    .map(a => ({ ...a, mi_rol: a.estado === 'cancelada' ? null : rolEn(a) }))
    .filter(a => todo || coordina || a.estado !== 'cancelada')
    .map(a => ((todo || coordina || a.mi_rol) ? { ...a, detalle: true } : ambulanciaAjena(a)));
  const rolNuevo = asignacionesVista.some(a => a.mi_rol === 'responsable') ? 'responsable'
    : asignacionesVista.some(a => a.mi_rol === 'equipo') ? 'equipo' : null;

  const vehiculos = t.vehiculos.map(v => {
    const soy = v.responsables.some(r => r.id === user.id)
      // Red de seguridad: una fila sin responsables (no debería existir tras v25)
      || (!v.responsables.length && v.responsable_user_id === user.id);
    if (todo || soy) return { ...v, soy_responsable: soy, detalle: true };
    const {
      kilometros_inicio, kilometros_fin, vehiculo_km_actual,
      progreso_fotos, motivo_finalizacion_anticipada, ...ligero
    } = v;
    return { ...ligero, soy_responsable: false, detalle: false };
  });

  const soyResponsable = vehiculos.some(v => v.soy_responsable);
  if (!todo && !coordina && !enEquipo && !soyResponsable && !rolNuevo) return null;

  const conDetalle = new Set(vehiculos.filter(v => v.detalle).map(v => v.vehicle_id));
  return {
    ...t,
    vehiculos,
    asignaciones: asignacionesVista,
    evidencias: t.evidencias.filter(e => conDetalle.has(e.vehicle_id)),
    mi_rol: todo ? 'gestion'
      : coordina ? 'coordinador'
      : (soyResponsable || rolNuevo === 'responsable') ? 'responsable' : 'equipo',
    // D3: lo cierra el coordinador o gestión, con la misma regla que
    // cerrarTrabajo (motivoNoSeCierra), que es quien manda.
    puede_cerrar: (coordina || gestiona(user)) && !motivoNoSeCierra(
      { ...t, v25: (t.vehiculos || []).length > 0 },
      (t.asignaciones || []).map(a => a.estado)),
  };
}

/**
 * Carga la fila trabajo↔vehículo sobre la que se va a actuar y dice si este
 * usuario puede operar en ella (gestión o responsable de ESE vehículo).
 */
async function cargarVehiculoDelTrabajo(trabajoId, vehicleId, user) {
  const [rows] = await query(
    `SELECT tv.id, tv.trabajo_id, tv.vehicle_id, tv.estado, tv.inicio_real_at,
            tv.kilometros_inicio,
            t.nombre, t.fecha_inicio, t.fecha_fin,
            v.matricula, v.alias AS vehiculo_alias, v.kilometros_actuales AS vehiculo_km_actual
     FROM trabajo_vehiculos tv
     JOIN trabajos t ON t.id = tv.trabajo_id
     JOIN vehicles v ON v.id = tv.vehicle_id
     WHERE tv.trabajo_id = ? AND tv.vehicle_id = ? AND t.deleted_at IS NULL`,
    [trabajoId, vehicleId]
  );
  if (!rows.length) return { fila: null, puede: false };
  if (gestiona(user)) return { fila: rows[0], puede: true };

  const [resp] = await query(
    'SELECT 1 AS ok FROM trabajo_vehiculo_responsables WHERE trabajo_vehiculo_id = ? AND user_id = ?',
    [rows[0].id, user.id]
  );
  return { fila: rows[0], puede: resp.length > 0 };
}

// ============================================================
// GET /trabajos
// ============================================================
async function listTrabajos(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.max(1, Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT));
    const offset = (page - 1) * limit;

    const { estado, tipo, fecha_desde, fecha_hasta, search } = req.query;

    let where  = 'WHERE t.deleted_at IS NULL';
    const params = [];

    if (!veTodo(req.user)) {
      where += ` AND ${FILTRO_PROPIOS}`;
      params.push(...propios(req.user.id));
    }

    if (estado) { where += ' AND t.estado = ?';       params.push(estado); }
    if (tipo)   { where += ' AND t.tipo = ?';         params.push(tipo); }
    if (fecha_desde) { where += ' AND t.fecha_inicio >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND t.fecha_fin <= ?';    params.push(fecha_hasta + ' 23:59:59'); }
    if (search) {
      where += ' AND (t.nombre LIKE ? OR t.identificador LIKE ? OR t.ubicacion LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM trabajos t ${where}`, params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado, t.ubicacion,
              t.fecha_inicio, t.fecha_fin, t.created_at, t.coordinador_user_id,
              u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos,
              CONCAT(co.nombre, ' ', co.apellidos) AS coordinador_nombre,
              -- Ambulancias: las asignaciones vivas (v33) o los vehículos (v25)
              (SELECT COUNT(*) FROM asignaciones_libres a
                WHERE a.trabajo_id = t.id AND a.deleted_at IS NULL AND a.estado <> 'cancelada')
              + (SELECT COUNT(*) FROM trabajo_vehiculos tv WHERE tv.trabajo_id = t.id) AS num_vehiculos,
              -- Personas distintas: el equipo del trabajo y, además, quien
              -- vaya en una ambulancia sin estar en él
              (SELECT COUNT(*) FROM trabajo_usuarios tu WHERE tu.trabajo_id = t.id)
              + (SELECT COUNT(DISTINCT au.user_id) FROM asignacion_usuarios au
                   JOIN asignaciones_libres a ON a.id = au.asignacion_id
                  WHERE a.trabajo_id = t.id AND a.deleted_at IS NULL AND a.estado <> 'cancelada'
                    AND NOT EXISTS (SELECT 1 FROM trabajo_usuarios tu2
                                     WHERE tu2.trabajo_id = t.id AND tu2.user_id = au.user_id)) AS num_usuarios
       FROM trabajos t
       JOIN users u ON t.created_by = u.id
       LEFT JOIN users co ON co.id = t.coordinador_user_id
       ${where}
       ORDER BY t.fecha_inicio DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /trabajos/calendario  (para vista agenda)
// ============================================================
async function listTrabajosCalendario(req, res, next) {
  try {
    const { year, month } = req.query;
    const hoy = anioMesEnEspana();
    const y = parseInt(year)  || hoy.anio;
    const m = parseInt(month) || hoy.mes;

    // Los límites del mes son medianoches ESPAÑOLAS convertidas al UTC que se
    // guarda en fecha_inicio/fecha_fin; si no, el día 1 empezaría a las 02:00.
    const desde = instanteEnEspana(y, m, 1);
    // Primer día del mes siguiente
    const mSig = m === 12 ? 1 : m + 1;
    const ySig = m === 12 ? y + 1 : y;
    const hasta = instanteEnEspana(ySig, mSig, 1);

    let sql    = `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado, t.ubicacion,
                         t.fecha_inicio, t.fecha_fin
                  FROM trabajos t
                  WHERE t.deleted_at IS NULL
                    AND t.fecha_inicio < ? AND t.fecha_fin >= ?`;
    const params = [hasta, desde];

    if (!veTodo(req.user)) {
      sql += ` AND ${FILTRO_PROPIOS}`;
      params.push(...propios(req.user.id));
    }

    sql += ' ORDER BY t.fecha_inicio ASC';

    const [rows] = await query(sql, params);
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /trabajos/:id
// ============================================================
async function getTrabajo(req, res, next) {
  try {
    const t = await getTrabajoCompleto(parseInt(req.params.id));
    if (!t) return notFound(res, 'Trabajo');

    const vista = vistaParaUsuario(t, req.user);
    if (!vista) return forbidden(res, 'No tienes acceso a este trabajo');

    return success(res, vista);
  } catch (err) {
    next(err);
  }
}

/** Inserta un vehículo en el trabajo con sus responsables. */
async function insertarVehiculo(conn, trabajoId, veh) {
  const [ins] = await conn.execute(
    `INSERT INTO trabajo_vehiculos (trabajo_id, vehicle_id, responsable_user_id, kilometros_inicio)
     VALUES (?, ?, ?, ?)`,
    [trabajoId, veh.vehicle_id, veh.responsables[0], veh.kilometros_inicio]
  );
  await guardarResponsables(conn, ins.insertId, veh.responsables);
  if (veh.kilometros_inicio) {
    await conn.execute(
      'UPDATE vehicles SET kilometros_actuales = ? WHERE id = ? AND kilometros_actuales < ?',
      [veh.kilometros_inicio, veh.vehicle_id, veh.kilometros_inicio]
    );
  }
}

/**
 * Normaliza las ambulancias del alta. Cada una es una asignación: vehículo,
 * responsables (1..N), equipo (`personal`, 0..N; en pantalla «Equipo», D8) y,
 * opcionales, sus fechas (por defecto las del trabajo), km de inicio y notas.
 * Pueden ser ninguna. D5: sin repetir ambulancia.
 *
 * @returns {{ambulancias?: object[], error?: string}}
 */
function leerAmbulancias(lista, trabajo) {
  // Desde el 2026-10-10 un trabajo puede nacer sin ambulancias: se le añaden
  // después desde su ficha.
  if (lista === undefined || lista === null) return { ambulancias: [] };
  if (!Array.isArray(lista)) return { error: 'asignaciones debe ser una lista' };
  const ambulancias = [];
  for (const amb of lista) {
    const vehicleId = Number(amb?.vehicle_id);
    if (!Number.isInteger(vehicleId) || vehicleId < 1) {
      return { error: 'Cada ambulancia necesita un vehicle_id válido' };
    }
    const miembros = asignaciones.leerMiembros(amb);
    if (miembros.error) return { error: miembros.error };
    if (!miembros.responsables) return { error: 'Cada ambulancia necesita al menos un responsable' };
    const fecha_inicio = amb.fecha_inicio || trabajo.fecha_inicio;
    const fecha_fin    = amb.fecha_fin    || trabajo.fecha_fin;
    if (instanteUtc(fecha_fin) <= instanteUtc(fecha_inicio)) {
      return { error: 'La hora de fin de cada ambulancia debe ser posterior a la de inicio' };
    }
    ambulancias.push({
      vehicle_id: vehicleId,
      responsables: miembros.responsables,
      personal: miembros.personal || [],
      fecha_inicio, fecha_fin,
      km_inicio: amb.km_inicio ?? null,
      notas: textoOpcional(amb.notas) ?? null,
    });
  }
  if (new Set(ambulancias.map(a => a.vehicle_id)).size !== ambulancias.length) {
    return { error: 'La misma ambulancia no puede ir dos veces en el trabajo' };
  }
  return { ambulancias };
}

// ============================================================
// POST /trabajos  (admin o gestor)
// El trabajo, su coordinador, su equipo (la gente asignada al trabajo,
// `usuarios` → trabajo_usuarios) y las ambulancias que ya se sepan, en una
// sola transacción. Puede nacer sin ambulancias (2026-10-10; deshace la D6):
// se añaden después desde su ficha con POST /asignaciones y trabajo_id, y su
// responsable puede ser del equipo del trabajo o no.
// ============================================================
async function createTrabajo(req, res, next) {
  try {
    const { nombre, tipo, fecha_inicio, fecha_fin } = req.body;

    if (instanteUtc(fecha_fin) <= instanteUtc(fecha_inicio)) {
      return error(res, 'fecha_fin debe ser posterior a fecha_inicio', 400);
    }
    // El formulario anterior (modelo v25) manda `vehiculos`. Ese modelo ya no
    // se crea; quien lo vea tiene la app sin actualizar.
    if (req.body.vehiculos !== undefined) {
      return error(res, 'Esta versión de la app ya no puede crear trabajos: recárgala para actualizarla', 400);
    }

    const coordinadorId = Number(req.body.coordinador_user_id);
    const { ambulancias, error: errAmb } = leerAmbulancias(req.body.asignaciones, { fecha_inicio, fecha_fin });
    if (errAmb) return error(res, errAmb, 400);

    // El equipo del trabajo: la gente asignada, vaya o no en una ambulancia
    const equipo = [...new Set(idsDe(req.body.usuarios) || [])];
    if (equipo.some(id => !Number.isInteger(id) || id < 1)) {
      return error(res, 'El equipo debe ser una lista de ids de usuario válidos', 400);
    }

    const vehiculoIds = ambulancias.map(a => a.vehicle_id);
    if (vehiculoIds.length) {
      const [vehs] = await query(
        `SELECT id FROM vehicles WHERE id IN (${vehiculoIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        vehiculoIds
      );
      if (vehs.length !== vehiculoIds.length) return notFound(res, 'Vehículo');
    }

    const personas = [coordinadorId, ...equipo, ...ambulancias.flatMap(a => [...a.responsables, ...a.personal])];
    const malos = await asignaciones.usuariosNoValidos([...new Set(personas)]);
    if (malos.length) {
      return error(res, `Usuarios inexistentes o dados de baja: ${malos.join(', ')}`, 400);
    }

    const identificador = await generateIdentificador();

    const { trabajoId, asignacionIds } = await transaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO trabajos (identificador, nombre, descripcion, ubicacion, tipo,
                               fecha_inicio, fecha_fin, coordinador_user_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [identificador, nombre, textoOpcional(req.body.descripcion) ?? null,
         textoOpcional(req.body.ubicacion) ?? null, tipo, fecha_inicio, fecha_fin,
         coordinadorId, req.user.id]
      );
      const nuevoId = result.insertId;
      for (const userId of equipo) {
        await conn.execute(
          'INSERT IGNORE INTO trabajo_usuarios (trabajo_id, user_id) VALUES (?, ?)', [nuevoId, userId]);
      }
      const ids = [];
      for (const amb of ambulancias) {
        ids.push(await asignaciones.insertarAsignacion(conn, { ...amb, trabajo_id: nuevoId }, req.user.id));
      }
      await sincronizarEstadoTrabajo(conn, nuevoId);
      return { trabajoId: nuevoId, asignacionIds: ids };
    });

    // Por ambulancia, lo mismo que devuelve el alta de una asignación suelta:
    // solapes de personas, ambulancia ocupada y fechas fuera del trabajo. Son
    // avisos para quien asigna, no bloqueos. Y el «nuevo servicio» a cada uno.
    const avisosAlta = [];
    for (const [i, asignacionId] of asignacionIds.entries()) {
      const amb   = ambulancias[i];
      const gente = [...amb.responsables, ...amb.personal];
      const asig  = await asignaciones.getAsignacionCompleta(asignacionId);
      if (asig) avisos.avisarAsignacionNueva(asig, gente, { asignadoPor: req.user.id });
      avisosAlta.push({
        asignacion_id: asignacionId,
        vehicle_id: amb.vehicle_id,
        solapes: await asignaciones.buscarSolapes(gente, amb.fecha_inicio, amb.fecha_fin, asignacionId),
        vehiculo_ocupado: await asignaciones.buscarVehiculoOcupado(
          amb.vehicle_id, amb.fecha_inicio, amb.fecha_fin, asignacionId),
        fuera_del_trabajo: asignaciones.fueraDelTrabajo({ fecha_inicio, fecha_fin }, amb.fecha_inicio, amb.fecha_fin),
      });
    }

    const t = await getTrabajoCompleto(trabajoId);
    // Al equipo del trabajo, «nuevo trabajo»; quien va en una ambulancia ya
    // ha recibido el «nuevo servicio» de arriba.
    const enAmbulancias = new Set(ambulancias.flatMap(a => [...a.responsables, ...a.personal]));
    avisos.avisarEquipoTrabajo(t, equipo.filter(id => !enAmbulancias.has(id)), { asignadoPor: req.user.id });
    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'create_trabajo',
      entityType: 'trabajo', entityId: trabajoId,
      details:  { identificador: t.identificador, nombre: t.nombre, tipo: t.tipo,
                  coordinador_user_id: coordinadorId, ambulancias: ambulancias.length,
                  equipo: equipo.length },
      ip: req.ip,
    });
    return created(res, { ...vistaParaUsuario(t, req.user), avisos_alta: avisosAlta }, 'Trabajo creado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /trabajos/:id  (admin o gestor)
// ============================================================
async function updateTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await query(
      `SELECT id, estado, fecha_inicio, fecha_fin, coordinador_user_id,
              (SELECT COUNT(*) FROM asignaciones_libres a
                WHERE a.trabajo_id = trabajos.id AND a.deleted_at IS NULL) AS num_asignaciones
       FROM trabajos WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    if (!existing.length) return notFound(res, 'Trabajo');

    const actual = existing[0];
    if (CERRADOS.includes(actual.estado)) {
      return error(res, 'No se puede modificar un trabajo finalizado', 400);
    }
    // Del modelo nuevo (con coordinador, o con asignaciones), las ambulancias
    // y quién va en ellas se cambian en cada asignación: `vehiculos` es del
    // v25. `usuarios` sí vale: es el equipo del trabajo (2026-10-10).
    const modeloNuevo = Number(actual.num_asignaciones) > 0 || !!actual.coordinador_user_id;
    if (modeloNuevo && req.body.vehiculos !== undefined) {
      return error(res, 'Las ambulancias de este trabajo y quién va en ellas se cambian en cada una de ellas', 400);
    }
    const coordinador = req.body.coordinador_user_id !== undefined
      ? Number(req.body.coordinador_user_id) : undefined;

    const { nombre, tipo, fecha_inicio, fecha_fin, usuarios } = req.body;
    const descripcion = textoOpcional(req.body.descripcion);
    const ubicacion   = textoOpcional(req.body.ubicacion);

    const inicio = fecha_inicio !== undefined ? fecha_inicio : actual.fecha_inicio;
    const fin    = fecha_fin    !== undefined ? fecha_fin    : actual.fecha_fin;
    // Aquí se mezcla el texto del body (UTC sin zona) con el Date leído de BD
    // si solo se cambia una fecha: instanteUtc los pone en la misma escala.
    if (instanteUtc(fin) <= instanteUtc(inicio)) {
      return error(res, 'fecha_fin debe ser posterior a fecha_inicio', 400);
    }

    const { vehiculos, error: errVeh } = leerVehiculos(req.body.vehiculos);
    if (errVeh) return error(res, errVeh, 400);

    const equipo = idsDe(usuarios);
    if (equipo && equipo.some(id => !Number.isInteger(id) || id < 1)) {
      return error(res, 'El equipo debe ser una lista de ids de usuario válidos', 400);
    }

    // Quien ya iba en el trabajo no bloquea la edición aunque lo hayan dado de baja
    const [miembros] = await query(
      `SELECT tu.user_id FROM trabajo_usuarios tu WHERE tu.trabajo_id = ?
       UNION
       SELECT tvr.user_id FROM trabajo_vehiculo_responsables tvr
         JOIN trabajo_vehiculos tv ON tv.id = tvr.trabajo_vehiculo_id
        WHERE tv.trabajo_id = ?`,
      [id, id]
    );
    const malos = await usuariosNoValidos(
      [...(equipo || []), ...(vehiculos || []).flatMap(v => v.responsables),
       ...(coordinador !== undefined ? [coordinador] : [])],
      [...miembros.map(m => m.user_id), actual.coordinador_user_id].filter(Boolean)
    );
    if (malos.length) {
      return error(res, `Usuarios inexistentes o dados de baja: ${malos.join(', ')}`, 400);
    }

    // Los vehículos se comparan con los que ya hay, no se borran y se vuelven
    // a meter: borrar la fila se llevaría por delante su estado, su hora real
    // de inicio y sus responsables. Y un vehículo que ya ha empezado (o tiene
    // fotos subidas) no se puede quitar: su evidencia quedaría colgando de un
    // trabajo que ya no lo lleva.
    let actuales = [];
    if (vehiculos !== undefined) {
      [actuales] = await query(
        `SELECT tv.id, tv.vehicle_id, tv.estado,
                (SELECT COUNT(*) FROM vehicle_images vi
                  WHERE vi.trabajo_id = tv.trabajo_id AND vi.vehicle_id = tv.vehicle_id) AS fotos,
                v.matricula
         FROM trabajo_vehiculos tv
         JOIN vehicles v ON v.id = tv.vehicle_id
         WHERE tv.trabajo_id = ?`,
        [id]
      );
      const pedidos = new Set(vehiculos.map(v => v.vehicle_id));
      const bloqueado = actuales.find(a => !pedidos.has(a.vehicle_id) &&
        (a.estado !== TRABAJO_ESTADOS.PROGRAMADO || a.fotos > 0));
      if (bloqueado) {
        return error(res,
          `No se puede quitar el vehículo ${bloqueado.matricula}: ya ha empezado o tiene fotos subidas`,
          400);
      }
    }

    await transaction(async (conn) => {
      const updates = [];
      const vals    = [];
      if (nombre       !== undefined) { updates.push('nombre = ?');       vals.push(nombre); }
      if (descripcion  !== undefined) { updates.push('descripcion = ?');  vals.push(descripcion); }
      if (ubicacion    !== undefined) { updates.push('ubicacion = ?');    vals.push(ubicacion); }
      if (tipo         !== undefined) { updates.push('tipo = ?');         vals.push(tipo); }
      if (fecha_inicio !== undefined) { updates.push('fecha_inicio = ?'); vals.push(fecha_inicio); }
      if (fecha_fin    !== undefined) { updates.push('fecha_fin = ?');    vals.push(fecha_fin); }
      if (coordinador  !== undefined) { updates.push('coordinador_user_id = ?'); vals.push(coordinador); }

      if (updates.length) {
        await conn.execute(`UPDATE trabajos SET ${updates.join(', ')} WHERE id = ?`, [...vals, id]);
      }

      if (vehiculos !== undefined) {
        const porVehiculo = new Map(actuales.map(a => [a.vehicle_id, a]));
        for (const a of actuales) {
          if (!vehiculos.some(v => v.vehicle_id === a.vehicle_id)) {
            await conn.execute('DELETE FROM trabajo_vehiculos WHERE id = ?', [a.id]);
          }
        }
        for (const veh of vehiculos) {
          const fila = porVehiculo.get(veh.vehicle_id);
          if (!fila) {
            await insertarVehiculo(conn, id, veh);
            continue;
          }
          await guardarResponsables(conn, fila.id, veh.responsables);
          if (fila.estado === TRABAJO_ESTADOS.PROGRAMADO) {
            await conn.execute('UPDATE trabajo_vehiculos SET kilometros_inicio = ? WHERE id = ?',
              [veh.kilometros_inicio, fila.id]);
          }
        }
        // Añadir o quitar vehículos puede cambiar el estado del conjunto
        await sincronizarEstadoTrabajo(conn, id);
      }

      if (equipo !== undefined) {
        await conn.execute('DELETE FROM trabajo_usuarios WHERE trabajo_id = ?', [id]);
        for (const userId of equipo) {
          await conn.execute(
            'INSERT IGNORE INTO trabajo_usuarios (trabajo_id, user_id) VALUES (?, ?)',
            [id, userId]
          );
        }
      }
    });

    const t = await getTrabajoCompleto(id);
    // «Nuevo trabajo» solo a quien ENTRA en el equipo; quien ya iba no tiene
    // nada nuevo que saber. Solo en el modelo nuevo: el v25 nunca avisó.
    if (equipo !== undefined && (modeloNuevo || coordinador !== undefined)) {
      const yaIban = new Set(miembros.map(m => m.user_id));
      avisos.avisarEquipoTrabajo(t, equipo.filter(id => !yaIban.has(id)), { asignadoPor: req.user.id });
    }
    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'update_trabajo',
      entityType: 'trabajo', entityId: id,
      details:  { nombre: t.nombre, estado: t.estado },
      ip: req.ip,
    });
    return success(res, t, 'Trabajo actualizado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /trabajos/:id  (soft delete - admin o gestor)
// ============================================================
async function deleteTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await query(
      'SELECT id, estado FROM trabajos WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (!existing.length) return notFound(res, 'Trabajo');

    if (existing[0].estado === TRABAJO_ESTADOS.ACTIVO) {
      return error(res, 'No se puede eliminar un trabajo activo', 400);
    }
    // Con asignaciones: solo si ninguna ha empezado. Las fotos y la hora real
    // de una ambulancia que ya salió son la evidencia del servicio.
    const [asigs] = await query(
      'SELECT estado FROM asignaciones_libres WHERE trabajo_id = ? AND deleted_at IS NULL', [id]
    );
    if (asigs.some(a => a.estado === 'activa' || a.estado === 'finalizada')) {
      return error(res, 'No se puede eliminar: alguna de sus ambulancias ya ha empezado o ha terminado', 400);
    }

    // Sus ambulancias se van con él: un trabajo borrado no deja asignaciones
    // programadas colgando en «Mis trabajos» ni en el listado.
    const instante = ahora();
    await transaction(async (conn) => {
      await conn.execute('UPDATE trabajos SET deleted_at = ? WHERE id = ?', [instante, id]);
      if (asigs.length) {
        await conn.execute(
          'UPDATE asignaciones_libres SET deleted_at = ? WHERE trabajo_id = ? AND deleted_at IS NULL',
          [instante, id]
        );
      }
    });
    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'delete_trabajo',
      entityType: 'trabajo', entityId: id,
      ip: req.ip,
    });
    return success(res, null, 'Trabajo eliminado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/vehiculos/:vehicleId/activar
// «Inicio de servicio» de UN vehículo del trabajo
// ============================================================
async function activarVehiculo(req, res, next) {
  try {
    const trabajoId = parseInt(req.params.id);
    const vehicleId = parseInt(req.params.vehicleId);

    const { fila, puede } = await cargarVehiculoDelTrabajo(trabajoId, vehicleId, req.user);
    if (!fila) return notFound(res, 'Vehículo en este trabajo');
    if (!puede) return forbidden(res, 'Solo un responsable de este vehículo puede activarlo');

    if (CERRADOS.includes(fila.estado)) {
      return error(res, 'Este vehículo ya ha cerrado su parte del trabajo', 400);
    }

    // Quien no gestiona solo puede adelantarse hasta 24 h. Si el cron ya lo
    // pasó a 'activo' a su hora, aquí solo se sella la hora real.
    if (!gestiona(req.user) && fila.estado === TRABAJO_ESTADOS.PROGRAMADO) {
      const horasRestantes = (new Date(fila.fecha_inicio) - ahora()) / (1000 * 60 * 60);
      if (horasRestantes > 24) {
        return error(res, 'Solo puedes activar el vehículo en las 24 horas previas al inicio', 400);
      }
    }

    // Idempotente, como «Inicio de servicio» en asignaciones: la hora real es
    // la de la PRIMERA pulsación, y funciona aunque el cron ya lo activara.
    await transaction(async (conn) => {
      await conn.execute(
        `UPDATE trabajo_vehiculos
            SET estado = ?, inicio_real_at = COALESCE(inicio_real_at, ?)
          WHERE id = ?`,
        [TRABAJO_ESTADOS.ACTIVO, ahora(), fila.id]
      );
      await conn.execute(
        'UPDATE trabajos SET activado_por = COALESCE(activado_por, ?) WHERE id = ?',
        [req.user.id, trabajoId]
      );
      await sincronizarEstadoTrabajo(conn, trabajoId);
    });

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'activate_trabajo_vehiculo',
      entityType: 'trabajo', entityId: trabajoId,
      details:  { trabajo_vehiculo_id: fila.id, vehicle_id: vehicleId, matricula: fila.matricula },
      ip: req.ip,
    });
    const t = await getTrabajoCompleto(trabajoId);
    return success(res, vistaParaUsuario(t, req.user), 'Vehículo activado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/vehiculos/:vehicleId/finalize
// Cierre de UN vehículo con evidencias obligatorias. El trabajo entero pasa a
// finalizado cuando el último de sus vehículos cierra.
// ============================================================
async function finalizeVehiculo(req, res, next) {
  try {
    const trabajoId = parseInt(req.params.id);
    const vehicleId = parseInt(req.params.vehicleId);

    const { fila, puede } = await cargarVehiculoDelTrabajo(trabajoId, vehicleId, req.user);
    if (!fila) return notFound(res, 'Vehículo en este trabajo');
    if (!puede) return forbidden(res, 'Solo un responsable de este vehículo puede cerrarlo');

    if (CERRADOS.includes(fila.estado)) {
      return error(res, 'Este vehículo ya ha cerrado su parte del trabajo', 400);
    }

    const { motivo_finalizacion_anticipada } = req.body;
    const kmFin = req.body.kilometros_fin;
    const isAnticipado = ahora() < new Date(fila.fecha_fin);

    if (isAnticipado && !motivo_finalizacion_anticipada?.trim()) {
      return error(res, 'Es obligatorio indicar el motivo de finalización anticipada', 400);
    }
    if (isAnticipado && errorMotivo(motivo_finalizacion_anticipada)) {
      return error(res, errorMotivo(motivo_finalizacion_anticipada), 400);
    }

    if (kmFin === undefined || kmFin === null || kmFin === '') {
      return error(res, 'Faltan los kilómetros finales del vehículo', 400);
    }
    if (fila.kilometros_inicio != null && kmFin < fila.kilometros_inicio) {
      return error(res, 'Los kilómetros finales no pueden ser menores que los de inicio', 400);
    }
    // El cuentakilómetros no retrocede al cerrar un servicio: mismo criterio
    // que finalizarAsignacion (§6.1 del mapa). Bajarlo a propósito, desde la
    // ficha del vehículo.
    if (fila.vehiculo_km_actual != null && kmFin < fila.vehiculo_km_actual) {
      return error(
        res,
        `Los km introducidos (${kmFin}) no pueden ser menores que los km actuales del vehículo (${fila.vehiculo_km_actual}). Si el dato es correcto, corrígelo desde la ficha del vehículo.`,
        400
      );
    }

    // Evidencias: fotos de INICIO + FIN de este vehículo en este trabajo
    const [imgs] = await query(
      'SELECT tipo_imagen, momento FROM vehicle_images WHERE vehicle_id = ? AND trabajo_id = ?',
      [vehicleId, trabajoId]
    );
    const progreso = progresoDe(imgs);
    if (!progreso.inicio.completo) {
      return error(res,
        `No se puede cerrar: faltan las fotos de INICIO de ${fila.matricula} (${progreso.inicio.faltantes.join(', ')}). Sube primero las fotos de inicio.`,
        400
      );
    }
    if (!progreso.fin.completo) {
      return error(res,
        `Faltan fotos de FIN de ${fila.matricula}: ${progreso.fin.faltantes.join(', ')}`, 400
      );
    }

    const nuevoEstado = isAnticipado
      ? TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO
      : TRABAJO_ESTADOS.FINALIZADO;

    let estadoDelTrabajo;
    await transaction(async (conn) => {
      await conn.execute(
        `UPDATE trabajo_vehiculos
            SET estado = ?, kilometros_fin = ?, finalizado_at = ?,
                motivo_finalizacion_anticipada = ?
          WHERE id = ?`,
        [nuevoEstado, kmFin, ahora(), isAnticipado ? motivo_finalizacion_anticipada.trim() : null, fila.id]
      );
      // El guard `<` queda de red para la carrera entre la validación y aquí
      await conn.execute(
        `UPDATE vehicles SET kilometros_actuales = ?, fecha_ultimo_servicio = ?
          WHERE id = ? AND kilometros_actuales < ?`,
        [kmFin, fechaEnEspana(), vehicleId, kmFin]
      );
      ({ estado: estadoDelTrabajo } = await sincronizarEstadoTrabajo(conn, trabajoId));
    });

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'finalize_trabajo_vehiculo',
      entityType: 'trabajo', entityId: trabajoId,
      details:  { trabajo_vehiculo_id: fila.id, vehicle_id: vehicleId, matricula: fila.matricula,
                  estado: nuevoEstado, anticipado: isAnticipado, estado_trabajo: estadoDelTrabajo },
      ip: req.ip,
    });
    const t = await getTrabajoCompleto(trabajoId);
    const mensaje = CERRADOS.includes(estadoDelTrabajo)
      ? 'Vehículo cerrado. Era el último: el trabajo queda finalizado'
      : 'Vehículo cerrado correctamente';
    return success(res, vistaParaUsuario(t, req.user), mensaje);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/activar  y  /finalize
// Solo para trabajos SIN vehículos (p. ej. una cobertura sin ambulancia): no
// hay fila trabajo↔vehículo de la que colgar el ciclo de vida, así que lo lleva
// gestión a mano. Con vehículos, cada uno se activa y se cierra por separado.
// ============================================================
async function cargarTrabajoSinVehiculos(id) {
  const [rows] = await query(
    `SELECT t.id, t.estado, t.fecha_inicio, t.fecha_fin, t.coordinador_user_id,
            (SELECT COUNT(*) FROM trabajo_vehiculos tv WHERE tv.trabajo_id = t.id)
            + (SELECT COUNT(*) FROM asignaciones_libres a WHERE a.trabajo_id = t.id) AS num_vehiculos
     FROM trabajos t
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

const MSG_CON_VEHICULOS =
  'Este trabajo tiene vehículos: cada responsable activa y cierra el suyo por separado';

/**
 * Activar y cerrar a mano es solo del v25 «sin vehículos». Un trabajo del
 * modelo nuevo (con coordinador, o que ha tenido ambulancias) arranca con su
 * primera ambulancia y lo cierra su coordinador: aunque se haya quedado sin
 * ambulancias (2026-10-10), por aquí gestión lo cerraría saltándose esa regla.
 */
function motivoNoManual(trabajo) {
  if (trabajo.coordinador_user_id) {
    return 'Este trabajo arranca con su primera ambulancia y lo cierra su coordinador con «Cerrar trabajo»';
  }
  return trabajo.num_vehiculos > 0 ? MSG_CON_VEHICULOS : null;
}

async function activarTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const trabajo = await cargarTrabajoSinVehiculos(id);
    if (!trabajo) return notFound(res, 'Trabajo');
    if (motivoNoManual(trabajo)) return error(res, motivoNoManual(trabajo), 400);
    if (trabajo.estado !== TRABAJO_ESTADOS.PROGRAMADO) {
      return error(res, 'Solo se pueden activar trabajos programados', 400);
    }

    await query(
      'UPDATE trabajos SET estado = ?, activado_por = ? WHERE id = ?',
      [TRABAJO_ESTADOS.ACTIVO, req.user.id, id]
    );

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'activate_trabajo',
      entityType: 'trabajo', entityId: id,
      ip: req.ip,
    });
    const t = await getTrabajoCompleto(id);
    return success(res, vistaParaUsuario(t, req.user), 'Trabajo activado');
  } catch (err) {
    next(err);
  }
}

async function finalizeTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const trabajo = await cargarTrabajoSinVehiculos(id);
    if (!trabajo) return notFound(res, 'Trabajo');
    if (motivoNoManual(trabajo)) return error(res, motivoNoManual(trabajo), 400);
    if (CERRADOS.includes(trabajo.estado)) {
      return error(res, 'El trabajo ya está finalizado', 400);
    }

    const { motivo_finalizacion_anticipada } = req.body;
    const isAnticipado = ahora() < new Date(trabajo.fecha_fin);
    if (isAnticipado && !motivo_finalizacion_anticipada?.trim()) {
      return error(res, 'Es obligatorio indicar el motivo de finalización anticipada', 400);
    }
    if (isAnticipado && errorMotivo(motivo_finalizacion_anticipada)) {
      return error(res, errorMotivo(motivo_finalizacion_anticipada), 400);
    }
    const nuevoEstado = isAnticipado
      ? TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO
      : TRABAJO_ESTADOS.FINALIZADO;

    await query(
      'UPDATE trabajos SET estado = ?, motivo_finalizacion_anticipada = ? WHERE id = ?',
      [nuevoEstado, isAnticipado ? motivo_finalizacion_anticipada.trim() : null, id]
    );

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'finalize_trabajo',
      entityType: 'trabajo', entityId: id,
      details:  { estado: nuevoEstado, anticipado: isAnticipado },
      ip: req.ip,
    });
    const t = await getTrabajoCompleto(id);
    return success(res, vistaParaUsuario(t, req.user), 'Trabajo finalizado correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/cerrar
// D3: lo cierra su coordinador (o gestión) cuando TODAS sus ambulancias han
// finalizado. Es el único estado del trabajo que no se deriva: el resto lo
// pone estadoTrabajo.service a partir de las asignaciones.
// ============================================================
async function cerrarTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await query(
      `SELECT t.id, t.identificador, t.nombre, t.estado, t.fecha_inicio, t.coordinador_user_id,
              (SELECT COUNT(*) FROM trabajo_vehiculos tv WHERE tv.trabajo_id = t.id) AS num_vehiculos_v25
       FROM trabajos t WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id]
    );
    if (!rows.length) return notFound(res, 'Trabajo');
    const trabajo = rows[0];

    if (!gestiona(req.user) && trabajo.coordinador_user_id !== req.user.id) {
      return forbidden(res, 'Solo el coordinador del trabajo puede cerrarlo');
    }

    // Se mira en las asignaciones y no en el estado guardado: es la regla, y
    // así no depende de que la última sincronización llegara a escribirse.
    const [asigs] = await query(
      'SELECT estado FROM asignaciones_libres WHERE trabajo_id = ? AND deleted_at IS NULL', [id]
    );
    const motivo = motivoNoSeCierra(
      { ...trabajo, v25: Number(trabajo.num_vehiculos_v25) > 0 }, asigs.map(a => a.estado));
    if (motivo) return error(res, motivo, 400);

    // El WHERE repite «no cerrado»: si dos personas pulsan a la vez, solo una
    // lo cierra y solo ella deja rastro en la auditoría.
    const [upd] = await query(
      `UPDATE trabajos SET estado = ?, cerrado_at = ?, cerrado_por = ?
       WHERE id = ? AND estado NOT IN ('finalizado', 'finalizado_anticipado')`,
      [TRABAJO_ESTADOS.FINALIZADO, ahora(), req.user.id, id]
    );
    if (upd?.affectedRows) {
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'close_trabajo',
        entityType: 'trabajo', entityId: id,
        details:  { identificador: trabajo.identificador, nombre: trabajo.nombre,
                    coordinador_user_id: trabajo.coordinador_user_id,
                    por_gestion: trabajo.coordinador_user_id !== req.user.id },
        ip: req.ip,
      });
    }

    const t = await getTrabajoCompleto(id);
    return success(res, vistaParaUsuario(t, req.user), 'Trabajo cerrado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/evidencias
// Subida de evidencias (imágenes) para un vehículo del trabajo
// ============================================================
async function uploadEvidencia(req, res, next) {
  try {
    const trabajoId = parseInt(req.params.id);
    const vehicleId = parseInt(req.body.vehicle_id);
    const tipoImagen = req.body.tipo_imagen;
    const momento    = req.body.momento || 'fin'; // 'inicio' | 'fin'

    if (!vehicleId || isNaN(vehicleId)) {
      return error(res, 'vehicle_id requerido', 400);
    }
    if (!['inicio', 'fin'].includes(momento)) {
      return error(res, 'momento debe ser "inicio" o "fin"', 400);
    }

    const listaValida = momento === 'inicio' ? IMAGEN_TIPOS_INICIO : IMAGEN_TIPOS_FIN;
    if (!listaValida.includes(tipoImagen)) {
      return error(res,
        `tipo_imagen "${tipoImagen}" no es válido para momento="${momento}". Válidos: ${listaValida.join(', ')}`,
        400
      );
    }

    // El candado es el del VEHÍCULO, no el del trabajo: con dos vehículos, el
    // que ya cerró no admite más fotos aunque el otro siga en marcha.
    const [rel] = await query(
      `SELECT tv.id, tv.estado
       FROM trabajo_vehiculos tv
       JOIN trabajos t ON t.id = tv.trabajo_id
       WHERE tv.trabajo_id = ? AND tv.vehicle_id = ? AND t.deleted_at IS NULL`,
      [trabajoId, vehicleId]
    );
    if (!rel.length) return error(res, 'El vehículo no está asignado a este trabajo', 400);

    if (CERRADOS.includes(rel[0].estado)) {
      return error(res, 'Este vehículo ya ha cerrado su parte del trabajo: no admite más fotos', 400);
    }

    if (!req.processedFile) return error(res, 'No se recibió ninguna imagen', 400);

    // Si ya existe una imagen de ese tipo+momento para este trabajo+vehículo, sobreescribir
    const [existing] = await query(
      `SELECT id, image_url FROM vehicle_images
       WHERE vehicle_id = ? AND trabajo_id = ? AND tipo_imagen = ? AND momento = ?`,
      [vehicleId, trabajoId, tipoImagen, momento]
    );

    // El instante lo pone Node (contrato de fechas), y al rehacer una foto se
    // vuelve a sellar: la hora que se ve es la de la imagen que se conserva.
    const tomadaEn = ahora();

    let imageId;
    if (existing.length) {
      // Eliminar archivo viejo
      const { deleteFile } = require('../middleware/upload.middleware');
      deleteFile(existing[0].image_url);

      await query(
        'UPDATE vehicle_images SET image_url = ?, uploaded_by = ?, created_at = ? WHERE id = ?',
        [req.processedFile.url, req.user.id, tomadaEn, existing[0].id]
      );
      imageId = existing[0].id;
    } else {
      const [result] = await query(
        `INSERT INTO vehicle_images (vehicle_id, tipo_imagen, momento, image_url, trabajo_id, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vehicleId, tipoImagen, momento, req.processedFile.url, trabajoId, req.user.id, tomadaEn]
      );
      imageId = result.insertId;
    }

    // Calcular progreso del momento actual
    const [progress] = await query(
      `SELECT tipo_imagen FROM vehicle_images
       WHERE vehicle_id = ? AND trabajo_id = ? AND momento = ?`,
      [vehicleId, trabajoId, momento]
    );
    const tiposSubidos = progress.map(p => p.tipo_imagen);
    const faltantes    = listaValida.filter(t => !tiposSubidos.includes(t));

    return created(res, {
      id:          imageId,
      image_url:   req.processedFile.url,
      tipo_imagen: tipoImagen,
      momento,
      vehicle_id:  vehicleId,
      trabajo_id:  trabajoId,
      created_at:  tomadaEn,
      progreso: {
        completado: tiposSubidos.length,
        total:      listaValida.length,
        faltantes,
        completo:   faltantes.length === 0,
      },
    }, 'Evidencia subida correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /trabajos/mis-trabajos
// La portada del técnico (D7): una tarjeta por trabajo que coordina, en cuyo
// equipo está o en el que va en alguna ambulancia, con «tu ambulancia» y su
// estado. Sigue
// saliendo con su ambulancia ya finalizada hasta que el coordinador cierra el
// trabajo (D11): por eso el filtro mira el estado del TRABAJO, no el de la
// asignación.
// ============================================================
async function misTrab(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.max(1, Math.min(parseInt(req.query.limit) || 20, PAGINATION.MAX_LIMIT));
    const offset = (page - 1) * limit;
    const uid    = req.user.id;

    const where = `WHERE t.deleted_at IS NULL
                     AND t.estado IN ('programado', 'activo', 'pendiente_cierre')
                     AND ${FILTRO_PROPIOS}`;

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM trabajos t ${where}`, propios(uid)
    );

    const [rows] = await query(
      `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado, t.ubicacion,
              t.fecha_inicio, t.fecha_fin, t.coordinador_user_id,
              t.coordinador_user_id = ? AS soy_coordinador,
              EXISTS (SELECT 1 FROM trabajo_usuarios te
                       WHERE te.trabajo_id = t.id AND te.user_id = ?) AS en_equipo,
              (SELECT GROUP_CONCAT(COALESCE(v.alias, v.matricula) ORDER BY a.fecha_inicio, a.id SEPARATOR ', ')
                 FROM asignaciones_libres a JOIN vehicles v ON v.id = a.vehicle_id
                WHERE a.trabajo_id = t.id AND a.deleted_at IS NULL AND a.estado <> 'cancelada') AS vehiculos_resumen
       FROM trabajos t
       ${where}
       ORDER BY FIELD(t.estado, 'activo', 'pendiente_cierre', 'programado'), t.fecha_inicio ASC, t.id
       LIMIT ? OFFSET ?`,
      [uid, uid, ...propios(uid), limit, offset]
    );

    // «Tu ambulancia»: la asignación en la que va este usuario en cada
    // trabajo. Si fuera en dos (puede: D5 es por ambulancia, no por persona),
    // manda la que lleva como responsable.
    const porTrabajo = new Map();
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const [mias] = await query(
        `SELECT a.trabajo_id, a.id, a.estado, a.fecha_inicio, a.fecha_fin, a.inicio_real_at,
                a.llegada_servicio_at, a.fin_servicio_at,
                v.matricula, v.alias AS vehiculo_alias, au.rol,
                (SELECT GROUP_CONCAT(CONCAT(ru.nombre, ' ', ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
                   FROM asignacion_usuarios ra JOIN users ru ON ru.id = ra.user_id
                  WHERE ra.asignacion_id = a.id AND ra.rol = 'responsable') AS responsables_nombres
         FROM asignaciones_libres a
         JOIN asignacion_usuarios au ON au.asignacion_id = a.id AND au.user_id = ?
         JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.trabajo_id IN (${ids.map(() => '?').join(',')})
           AND a.deleted_at IS NULL AND a.estado <> 'cancelada'
         ORDER BY au.rol = 'responsable' DESC, a.fecha_inicio, a.id`,
        [uid, ...ids]
      );
      for (const m of mias) {
        if (!porTrabajo.has(m.trabajo_id)) {
          const { trabajo_id, rol, ...resto } = m;
          porTrabajo.set(trabajo_id, { ...resto, mi_rol: rol === 'responsable' ? 'responsable' : 'equipo' });
        }
      }
    }

    const data = rows.map(r => ({
      ...r,
      soy_coordinador: !!r.soy_coordinador,
      en_equipo: !!r.en_equipo,
      mi_asignacion: porTrabajo.get(r.id) || null,
    }));
    return paginated(res, { data, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTrabajos, listTrabajosCalendario, getTrabajo,
  createTrabajo, updateTrabajo, deleteTrabajo, cerrarTrabajo,
  activarVehiculo, finalizeVehiculo,
  activarTrabajo, finalizeTrabajo,
  uploadEvidencia, misTrab,
  // Para los tests (el cálculo vive en services/estadoTrabajo.service)
  estadoTrabajoDesde: estadoTrabajo.estadoTrabajoDesde,
  sincronizarEstadoTrabajo, vistaParaUsuario, leerVehiculos, leerAmbulancias, motivoNoSeCierra,
};
