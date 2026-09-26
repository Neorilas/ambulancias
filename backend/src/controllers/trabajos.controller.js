/**
 * controllers/trabajos.controller.js
 * CRUD de trabajos + ciclo de vida POR VEHÍCULO (activar / evidencias / cerrar).
 *
 * Un trabajo tiene 0..N vehículos y un equipo de 0..N personas. Cada vehículo
 * lleva 1..N responsables (tabla trabajo_vehiculo_responsables, v25), que son
 * quienes lo activan, suben su evidencia y lo cierran, cada uno el suyo y por
 * su cuenta. `trabajos.estado` ya no se escribe a mano: se DERIVA de los
 * estados de sus vehículos (sincronizarEstadoTrabajo). Reglas en §6.2 del mapa.
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

const CERRADOS = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO];

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
 * «Es mío»: va en el equipo o es responsable de alguno de sus vehículos. Un
 * responsable no tiene por qué figurar además en el equipo. Lleva DOS
 * parámetros, los dos el id del usuario.
 */
const FILTRO_PROPIOS = `(
  EXISTS (SELECT 1 FROM trabajo_usuarios tu WHERE tu.trabajo_id = t.id AND tu.user_id = ?)
  OR EXISTS (SELECT 1 FROM trabajo_vehiculos tvp
               JOIN trabajo_vehiculo_responsables tvr ON tvr.trabajo_vehiculo_id = tvp.id
              WHERE tvp.trabajo_id = t.id AND tvr.user_id = ?))`;

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

/**
 * Estado del trabajo a partir de los de sus vehículos:
 *  - todos cerrados → finalizado (o finalizado_anticipado si alguno lo fue);
 *  - alguno activo o ya cerrado → activo (el trabajo está en marcha);
 *  - ninguno empezado → programado.
 * Sin vehículos devuelve null: ese trabajo se gestiona a mano (0 vehículos).
 */
function estadoTrabajoDesde(estados) {
  if (!estados.length) return null;
  if (estados.every(e => CERRADOS.includes(e))) {
    return estados.includes(TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO)
      ? TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO
      : TRABAJO_ESTADOS.FINALIZADO;
  }
  if (estados.some(e => e !== TRABAJO_ESTADOS.PROGRAMADO)) return TRABAJO_ESTADOS.ACTIVO;
  return TRABAJO_ESTADOS.PROGRAMADO;
}

/**
 * Recalcula `trabajos.estado`. Se guarda en vez de calcularse al leer para que
 * el listado y el calendario sigan filtrando por una columna, sin juntar
 * vehículos en cada GET. Se llama tras CADA cambio de estado de un vehículo.
 */
async function sincronizarEstadoTrabajo(conn, trabajoId) {
  const [rows] = await conn.execute(
    'SELECT estado FROM trabajo_vehiculos WHERE trabajo_id = ?', [trabajoId]
  );
  const estado = estadoTrabajoDesde(rows.map(r => r.estado));
  if (estado) {
    await conn.execute('UPDATE trabajos SET estado = ? WHERE id = ?', [estado, trabajoId]);
  }
  return estado;
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

/** Obtiene el trabajo completo, SIN recortar (el recorte es `vistaParaUsuario`). */
async function getTrabajoCompleto(id) {
  const [trows] = await query(
    `SELECT t.*, u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos
     FROM trabajos t
     JOIN users u ON t.created_by = u.id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  );
  if (!trows.length) return null;

  const t = trows[0];

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
 * Lo que este usuario puede ver del trabajo, o null si no puede verlo.
 *  - Gestión (ver todo): el trabajo entero.
 *  - Responsable: el detalle (km, fotos, progreso) de SUS vehículos; el resto,
 *    recortado como a cualquiera del equipo.
 *  - Equipo: título, descripción, ubicación, fechas y qué vehículos van (alias,
 *    matrícula, estado, responsables), sin evidencia ni kilómetros.
 * Cada vehículo sale con `soy_responsable` y `detalle` para que el frontend
 * no tenga que repetir la regla.
 */
function vistaParaUsuario(t, user) {
  const todo     = veTodo(user);
  const enEquipo = t.usuarios.some(u => u.user_id === user.id);

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
  if (!todo && !enEquipo && !soyResponsable) return null;

  const conDetalle = new Set(vehiculos.filter(v => v.detalle).map(v => v.vehicle_id));
  return {
    ...t,
    vehiculos,
    evidencias: t.evidencias.filter(e => conDetalle.has(e.vehicle_id)),
    mi_rol: todo ? 'gestion' : (soyResponsable ? 'responsable' : 'equipo'),
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
      params.push(req.user.id, req.user.id);
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
              t.fecha_inicio, t.fecha_fin, t.created_at,
              u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos,
              COUNT(DISTINCT tv.vehicle_id) AS num_vehiculos,
              COUNT(DISTINCT tu.user_id) AS num_usuarios
       FROM trabajos t
       JOIN users u ON t.created_by = u.id
       LEFT JOIN trabajo_vehiculos tv ON t.id = tv.trabajo_id
       LEFT JOIN trabajo_usuarios tu ON t.id = tu.trabajo_id
       ${where}
       GROUP BY t.id
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
      params.push(req.user.id, req.user.id);
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

// ============================================================
// POST /trabajos  (admin o gestor)
// ============================================================
async function createTrabajo(req, res, next) {
  try {
    const { nombre, tipo, fecha_inicio, fecha_fin, usuarios = [] } = req.body;

    if (instanteUtc(fecha_fin) <= instanteUtc(fecha_inicio)) {
      return error(res, 'fecha_fin debe ser posterior a fecha_inicio', 400);
    }

    const { vehiculos = [], error: errVeh } = leerVehiculos(req.body.vehiculos);
    if (errVeh) return error(res, errVeh, 400);

    const equipo = (idsDe(usuarios) || []);
    if (equipo.some(id => !Number.isInteger(id) || id < 1)) {
      return error(res, 'El equipo debe ser una lista de ids de usuario válidos', 400);
    }
    const malos = await usuariosNoValidos([...equipo, ...vehiculos.flatMap(v => v.responsables)]);
    if (malos.length) {
      return error(res, `Usuarios inexistentes o dados de baja: ${malos.join(', ')}`, 400);
    }

    const identificador = await generateIdentificador();

    const trabajoId = await transaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO trabajos (identificador, nombre, descripcion, ubicacion, tipo,
                               fecha_inicio, fecha_fin, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [identificador, nombre, textoOpcional(req.body.descripcion) ?? null,
         textoOpcional(req.body.ubicacion) ?? null, tipo, fecha_inicio, fecha_fin, req.user.id]
      );
      const newId = result.insertId;

      for (const veh of vehiculos) await insertarVehiculo(conn, newId, veh);

      for (const userId of equipo) {
        await conn.execute(
          'INSERT IGNORE INTO trabajo_usuarios (trabajo_id, user_id) VALUES (?, ?)',
          [newId, userId]
        );
      }

      return newId;
    });

    const t = await getTrabajoCompleto(trabajoId);
    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'create_trabajo',
      entityType: 'trabajo', entityId: trabajoId,
      details:  { identificador: t.identificador, nombre: t.nombre, tipo: t.tipo,
                  vehiculos: vehiculos.length },
      ip: req.ip,
    });
    return created(res, t, 'Trabajo creado');
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
      'SELECT id, estado, fecha_inicio, fecha_fin FROM trabajos WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (!existing.length) return notFound(res, 'Trabajo');

    const actual = existing[0];
    if (CERRADOS.includes(actual.estado)) {
      return error(res, 'No se puede modificar un trabajo finalizado', 400);
    }

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
      [...(equipo || []), ...(vehiculos || []).flatMap(v => v.responsables)],
      miembros.map(m => m.user_id)
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

    await query('UPDATE trabajos SET deleted_at = ? WHERE id = ?', [ahora(), id]);
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

    let estadoTrabajo;
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
      estadoTrabajo = await sincronizarEstadoTrabajo(conn, trabajoId);
    });

    logAudit({
      userId:   req.user.id,
      userInfo: req.user.username,
      action:   'finalize_trabajo_vehiculo',
      entityType: 'trabajo', entityId: trabajoId,
      details:  { trabajo_vehiculo_id: fila.id, vehicle_id: vehicleId, matricula: fila.matricula,
                  estado: nuevoEstado, anticipado: isAnticipado, estado_trabajo: estadoTrabajo },
      ip: req.ip,
    });
    const t = await getTrabajoCompleto(trabajoId);
    const mensaje = CERRADOS.includes(estadoTrabajo)
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
    `SELECT t.id, t.estado, t.fecha_inicio, t.fecha_fin,
            (SELECT COUNT(*) FROM trabajo_vehiculos tv WHERE tv.trabajo_id = t.id) AS num_vehiculos
     FROM trabajos t
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

const MSG_CON_VEHICULOS =
  'Este trabajo tiene vehículos: cada responsable activa y cierra el suyo por separado';

async function activarTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const trabajo = await cargarTrabajoSinVehiculos(id);
    if (!trabajo) return notFound(res, 'Trabajo');
    if (trabajo.num_vehiculos > 0) return error(res, MSG_CON_VEHICULOS, 400);
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
    if (trabajo.num_vehiculos > 0) return error(res, MSG_CON_VEHICULOS, 400);
    if (CERRADOS.includes(trabajo.estado)) {
      return error(res, 'El trabajo ya está finalizado', 400);
    }

    const { motivo_finalizacion_anticipada } = req.body;
    const isAnticipado = ahora() < new Date(trabajo.fecha_fin);
    if (isAnticipado && !motivo_finalizacion_anticipada?.trim()) {
      return error(res, 'Es obligatorio indicar el motivo de finalización anticipada', 400);
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
// Una fila por trabajo (no por vehículo: con dos vehículos salía repetido).
// ============================================================
async function misTrab(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.max(1, Math.min(parseInt(req.query.limit) || 20, PAGINATION.MAX_LIMIT));
    const offset = (page - 1) * limit;
    const uid    = req.user.id;

    const where = `WHERE t.deleted_at IS NULL AND t.estado IN ('programado', 'activo')
                     AND ${FILTRO_PROPIOS}`;

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM trabajos t ${where}`, [uid, uid]
    );

    const [rows] = await query(
      `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado, t.ubicacion,
              t.fecha_inicio, t.fecha_fin,
              (SELECT GROUP_CONCAT(COALESCE(v.alias, v.matricula) ORDER BY tv.id SEPARATOR ', ')
                 FROM trabajo_vehiculos tv JOIN vehicles v ON v.id = tv.vehicle_id
                WHERE tv.trabajo_id = t.id) AS vehiculos_resumen,
              EXISTS (SELECT 1 FROM trabajo_vehiculos tv
                        JOIN trabajo_vehiculo_responsables tvr ON tvr.trabajo_vehiculo_id = tv.id
                       WHERE tv.trabajo_id = t.id AND tvr.user_id = ?) AS soy_responsable,
              (SELECT COUNT(*) FROM trabajo_vehiculos tv
                 JOIN trabajo_vehiculo_responsables tvr ON tvr.trabajo_vehiculo_id = tv.id
                WHERE tv.trabajo_id = t.id AND tvr.user_id = ?
                  AND tv.estado IN ('programado', 'activo')) AS mis_vehiculos_pendientes
       FROM trabajos t
       ${where}
       ORDER BY FIELD(t.estado, 'activo', 'programado'), t.fecha_inicio ASC
       LIMIT ? OFFSET ?`,
      [uid, uid, uid, uid, limit, offset]
    );

    return paginated(res, { data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTrabajos, listTrabajosCalendario, getTrabajo,
  createTrabajo, updateTrabajo, deleteTrabajo,
  activarVehiculo, finalizeVehiculo,
  activarTrabajo, finalizeTrabajo,
  uploadEvidencia, misTrab,
  // Para el cron y los tests
  estadoTrabajoDesde, sincronizarEstadoTrabajo, vistaParaUsuario, leerVehiculos,
};
