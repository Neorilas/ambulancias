/**
 * services/push.service.js
 * Avisos Web Push (VAPID) a los administradores.
 *
 * Qué resuelve: que el teléfono de quien gestiona la flota suene cuando pasa
 * algo en una asignación, sin app nativa ni Firebase. El navegador del admin
 * guarda una suscripción por dispositivo (tabla `push_subscriptions`) y desde
 * aquí se le empuja el aviso.
 *
 * REGLA DE ORO: nada de lo que hay en este módulo puede romper la petición que
 * lo invoca. Un aviso que no sale es un aviso perdido, no un 500 para el
 * técnico que estaba cerrando su servicio. Por eso todo lo público captura sus
 * propios errores y devuelve un resumen en vez de lanzar.
 */

'use strict';

const webpush = require('web-push');

const { query }              = require('../config/database');
const logger                 = require('../utils/logger.utils');
const { ahora }              = require('../utils/fecha.utils');
const { PERMISSIONS, ROLES } = require('../config/constants');

// ============================================================
// Configuración VAPID
// ============================================================

// Las claves viven SOLO en el entorno (el repo es público). Sin ellas el
// módulo queda inerte: la app funciona igual, simplemente no se manda nada.
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
// El RFC 8292 exige un contacto en el JWT para que el servicio de push pueda
// avisar si algo va mal. Vale un mailto: o una URL.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@vapss.net';

let configurado = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);

if (configurado) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (err) {
    // Claves mal formadas: se avisa al arrancar y se sigue sin push, en vez de
    // dejar que cada envío reviente por su cuenta.
    configurado = false;
    logger.error(`Push deshabilitado: claves VAPID inválidas — ${err.message}`);
  }
} else {
  logger.warn('Push deshabilitado: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
}

/** ¿Hay claves VAPID cargadas? Lo consulta el controlador para responder al frontend. */
function estaConfigurado() {
  return configurado;
}

/** Clave pública VAPID, que el navegador necesita para suscribirse. */
function clavePublica() {
  return configurado ? VAPID_PUBLIC : null;
}

// ============================================================
// Destinatarios
// ============================================================

/**
 * Suscripciones de quienes deben enterarse: permiso `manage_trabajos` o rol
 * de mando (administrador/superadmin).
 *
 * Se calcula en cada envío a propósito: una lista fija se quedaría vieja en
 * cuanto se diera de alta un administrador nuevo o se le retirara el permiso
 * a otro.
 *
 * El superadmin entra por rol aunque le faltara la fila en `role_permissions`:
 * es el mismo bypass que hace `hasPermission` en roles.middleware.js, y sin él
 * el criterio de «quién es admin» diría cosas distintas según se pregunte.
 *
 * Ojo con los roles no excluyentes: quien manda y además sale de servicio como
 * técnico sigue siendo admin y sigue recibiendo avisos de las asignaciones de
 * los demás. Lo que no recibe es el aviso de la suya propia — de eso se ocupa
 * `excluirUserId`.
 */
async function suscripcionesDeAdmins(excluirUserId = null) {
  const excluir = excluirUserId ?? null;
  const [rows] = await query(
    `SELECT DISTINCT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN users u       ON u.id       = ps.user_id
       JOIN user_roles ur ON ur.user_id = ps.user_id
       JOIN roles r       ON r.id       = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id       = r.id
       LEFT JOIN permissions p       ON p.id             = rp.permission_id
      WHERE u.activo = 1
        AND u.deleted_at IS NULL
        AND (p.nombre = ? OR r.nombre IN (?, ?))
        AND (? IS NULL OR ps.user_id <> ?)`,
    [PERMISSIONS.MANAGE_TRABAJOS, ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, excluir, excluir]
  );
  return rows;
}

/** Suscripciones de un usuario concreto (para el aviso de prueba). */
async function suscripcionesDeUsuario(userId) {
  const [rows] = await query(
    `SELECT id, user_id, endpoint, p256dh, auth
       FROM push_subscriptions WHERE user_id = ?`,
    [userId]
  );
  return rows;
}

// ============================================================
// Envío
// ============================================================

/**
 * Urgencia del mensaje, y la diferencia entre sonar y no sonar en Android.
 *
 * `web-push` manda `normal` si no se le dice otra cosa, y con esa urgencia FCM
 * ACUMULA el aviso mientras el teléfono está en reposo (Doze) y lo suelta en
 * la siguiente ventana de mantenimiento, que puede tardar un buen rato. Ese es
 * el síntoma clásico de «el primer aviso llegó y los siguientes no»: el primero
 * pilló el móvil despierto y los demás se quedaron aparcados.
 *
 * `high` es lo que pide un aviso que exige atención de una persona — que es
 * justo lo que es esto — y despierta el dispositivo.
 */
const URGENCIA = 'high';

/**
 * Cuánto guarda el servicio de push un aviso que no ha podido entregar
 * (teléfono apagado, sin cobertura). Una hora: más allá, un aviso de servicio
 * ya no informa de nada y llegaría solo para desconcertar.
 */
const TTL_SEGUNDOS = 60 * 60;

/**
 * `topic` para el servicio de push, derivado del tag.
 *
 * Hace en el servidor lo mismo que el `tag` hace en la bandeja: si hay un
 * aviso del mismo suceso todavía sin entregar, este lo SUSTITUYE en vez de
 * encolarse detrás. Así el admin que enciende el móvil no se come tres avisos
 * seguidos de la misma asignación.
 *
 * El RFC lo limita a 32 caracteres base64url y un topic inválido hace que
 * `sendNotification` lance, así que el tag se sanea en vez de pasarse tal cual:
 * cada carácter que no encaje se sustituye por un guión y se recorta a 32. No
 * se descarta nada, solo se transforma; sin tag no hay topic y punto.
 */
function normalizarTopic(tag) {
  if (!tag) return undefined;
  const limpio = String(tag).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);
  return limpio || undefined;
}

/**
 * Manda `payload` a una lista de suscripciones.
 *
 * Una suscripción caducada devuelve 404 o 410: eso no es un fallo pasajero,
 * es el servicio de push diciendo que ese dispositivo ya no existe. Se borra
 * para que no siga acumulando intentos en cada aviso. Cualquier otro error se
 * registra y ya: sin reintentos, que un aviso tardío molesta más que ayuda.
 */
async function enviarA(suscripciones, payload) {
  const cuerpo  = JSON.stringify(payload);
  const opciones = {
    TTL:     TTL_SEGUNDOS,
    urgency: URGENCIA,
    topic:   normalizarTopic(payload?.tag),
  };
  let enviados = 0;
  let borrados = 0;
  let fallidos = 0;

  await Promise.all(suscripciones.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        cuerpo,
        opciones
      );
      enviados++;
      // Marca de vida: sirve para ver qué dispositivos siguen respondiendo y
      // cuáles llevan meses mudos. Es informativa, nunca corta el envío.
      try {
        await query('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?', [ahora(), s.id]);
      } catch { /* da igual: el aviso ya salió */ }
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        try {
          await query('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
          borrados++;
          logger.info(`Push: suscripción ${s.id} (usuario ${s.user_id}) caducada [${status}], eliminada`);
        } catch (errBorrado) {
          fallidos++;
          logger.warn(`Push: no se pudo borrar la suscripción caducada ${s.id}: ${errBorrado.message}`);
        }
      } else {
        fallidos++;
        logger.warn(
          `Push: envío fallido a suscripción ${s.id} (usuario ${s.user_id}): ` +
          `${status || 'sin estado'} ${err?.message || err}`
        );
      }
    }
  }));

  return { enviados, borrados, fallidos };
}

/**
 * Avisa a los administradores.
 *
 * @param {object}  aviso
 * @param {string}  aviso.titulo         Línea 1 de la notificación
 * @param {string}  aviso.cuerpo         Línea 2
 * @param {string} [aviso.url]           Ruta de la PWA que abre el aviso al tocarlo
 * @param {string} [aviso.tag]           Agrupador: un tag por asignación y evento,
 *                                       para que dos avisos distintos no se pisen
 *                                       y el mismo no se apile duplicado
 * @param {number} [aviso.excluirUserId] Usuario que NO debe recibirlo (el responsable)
 * @returns {Promise<{enviados:number, borrados:number, fallidos:number, omitido?:string}>}
 */
async function notificarAdmins({ titulo, cuerpo, url = '/', tag, excluirUserId = null } = {}) {
  if (!configurado) return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'sin-claves-vapid' };

  try {
    const subs = await suscripcionesDeAdmins(excluirUserId);
    if (!subs.length) return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'sin-suscripciones' };

    const resumen = await enviarA(subs, { titulo, cuerpo, url, tag });
    logger.info(
      `Push "${tag || titulo}": ${resumen.enviados} enviado(s), ` +
      `${resumen.fallidos} fallido(s), ${resumen.borrados} caducado(s)`
    );
    return resumen;
  } catch (err) {
    // Aquí acaba cualquier imprevisto (BD caída, tabla ausente…). Se registra
    // y se devuelve un resumen vacío: quien llamó sigue su camino.
    logger.error(`Push: fallo al notificar a administradores — ${err.message}`);
    return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'error' };
  }
}

/** Aviso de prueba al propio usuario, desde su perfil. */
async function notificarUsuario(userId, { titulo, cuerpo, url = '/', tag } = {}) {
  if (!configurado) return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'sin-claves-vapid' };
  try {
    const subs = await suscripcionesDeUsuario(userId);
    if (!subs.length) return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'sin-suscripciones' };
    return await enviarA(subs, { titulo, cuerpo, url, tag });
  } catch (err) {
    logger.error(`Push: fallo al notificar al usuario ${userId} — ${err.message}`);
    return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'error' };
  }
}

// ============================================================
// Alta y baja de suscripciones
// ============================================================

/**
 * Guarda (o refresca) la suscripción de un dispositivo.
 *
 * El endpoint es único: si el navegador ya estaba suscrito devuelve el mismo y
 * aquí solo se actualizan las claves y el dueño. Eso cubre el caso de dos
 * personas que comparten el ordenador de la oficina — la suscripción pasa a
 * ser de quien la activó el último, que es lo que espera quien pulsa el botón.
 */
async function guardarSuscripcion({ userId, subscription, userAgent }) {
  const endpoint = subscription?.endpoint;
  const p256dh   = subscription?.keys?.p256dh;
  const auth     = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Suscripción incompleta: faltan endpoint o claves');
  }

  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id    = VALUES(user_id),
       p256dh     = VALUES(p256dh),
       auth       = VALUES(auth),
       user_agent = VALUES(user_agent)`,
    [userId, endpoint, p256dh, auth, (userAgent || '').slice(0, 255) || null, ahora()]
  );
}

/** Baja de un dispositivo. Solo puede borrar el dueño de la suscripción. */
async function borrarSuscripcion({ userId, endpoint }) {
  const [res] = await query(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    [endpoint, userId]
  );
  return res.affectedRows > 0;
}

/** ¿Tiene este usuario registrado este endpoint concreto? */
async function tieneSuscripcion({ userId, endpoint }) {
  const [rows] = await query(
    'SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ? LIMIT 1',
    [endpoint, userId]
  );
  return rows.length > 0;
}

/** Nº de dispositivos suscritos por usuario, para ver quién tiene los avisos puestos. */
async function contarDispositivosPorUsuario() {
  const [rows] = await query(
    `SELECT user_id, COUNT(*) AS dispositivos
       FROM push_subscriptions GROUP BY user_id`
  );
  return rows;
}

module.exports = {
  estaConfigurado,
  clavePublica,
  notificarAdmins,
  notificarUsuario,
  guardarSuscripcion,
  borrarSuscripcion,
  tieneSuscripcion,
  contarDispositivosPorUsuario,
  // Expuestos para los tests
  suscripcionesDeAdmins,
  suscripcionesDeUsuario,
  enviarA,
  normalizarTopic,
};
