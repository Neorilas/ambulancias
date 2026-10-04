'use strict';

/**
 * controllers/backups.controller.js
 * Descarga de los dumps de la BD desde el panel de superadmin.
 *
 * Los dumps los genera scripts/backup/backup-ambulancia.sh en el HOST
 * (/root/<stack>-backups/db) y docker-compose.yml monta esa carpeta, solo
 * lectura, en BACKUPS_DIR. El backend no genera nada: solo lista y sirve.
 *
 * Un dump lleva la BD entera: datos personales de la plantilla y los hashes
 * de las contraseñas. Por eso:
 *   - solo superadmin (admin.routes) y nunca viendo la app como otro;
 *   - pide otra vez la contraseña (POST, con su propio limitador): un token
 *     robado o un XSS no bastan para sacar la BD entera (SEC-18);
 *   - el nombre se valida contra un patrón cerrado, sin rutas;
 *   - cada descarga queda en audit_logs (`download_backup`) y avisa por push
 *     a todos los superadmin, para que nadie se entere días después;
 *   - `Cache-Control: no-store`: ni el navegador ni un proxy se lo guardan.
 */

const fs   = require('fs');
const path = require('path');
const { BACKUPS_DIR } = require('../config/constants');
const { success, error, notFound, forbidden } = require('../utils/response.utils');
const logger = require('../utils/logger.utils');
const { logAudit } = require('./admin.controller');
const { registrarErrorServidor } = require('../middleware/error.middleware');
const { query } = require('../config/database');
const { comparePassword } = require('../utils/password.utils');
const push = require('../services/push.service');

// Lo que escribe backup-ambulancia.sh: <stack>_AAAAMMDD_HHMMSS.sql.gz
const PATRON_DUMP = /^[a-z0-9-]+_\d{8}_\d{6}\.sql\.gz$/;

/** GET /admin/backups — los dumps disponibles, el más reciente primero. */
async function listBackups(req, res, next) {
  try {
    let nombres;
    try {
      nombres = await fs.promises.readdir(BACKUPS_DIR);
    } catch (err) {
      // Sin carpeta montada o sin permiso: no es un error de la API, es que
      // el backup no está instalado (o le faltan los permisos, docs/BACKUPS.md).
      logger.warn(`Backups: no se puede leer ${BACKUPS_DIR}: ${err.code || err.message}`);
      return success(res, { disponible: false, motivo: err.code || 'ERROR', backups: [] });
    }

    const backups = [];
    for (const nombre of nombres.filter(n => PATRON_DUMP.test(n))) {
      try {
        const st = await fs.promises.stat(path.join(BACKUPS_DIR, nombre));
        if (st.isFile()) backups.push({ nombre, tamano: st.size, fecha: st.mtime });
      } catch { /* borrado por la retención entre readdir y stat */ }
    }
    backups.sort((a, b) => b.fecha - a.fecha);
    return success(res, { disponible: true, backups });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/backups/:nombre/descarga  body: { password } — el fichero, como descarga.
 *
 * La contraseña incorrecta es un 403 y no un 401: la app trata el 401 como
 * sesión caducada (refresca o echa al login), y aquí la sesión es buena.
 */
async function downloadBackup(req, res, next) {
  try {
    // Viendo la app como otro no se es superadmin y el middleware ya lo para;
    // esto cubre impersonar a OTRO superadmin: la descarga, siempre en primera persona.
    if (req.user.impersonadoPor) {
      return forbidden(res, 'No se descargan backups viendo la app como otro usuario');
    }

    const { nombre } = req.params;
    if (!PATRON_DUMP.test(nombre)) return error(res, 'Nombre de backup no válido', 400);

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const [filas] = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const hash = filas[0]?.password_hash;
    if (!password || !hash || !(await comparePassword(password, hash))) {
      return forbidden(res, 'Contraseña incorrecta');
    }

    const ruta = path.join(BACKUPS_DIR, nombre);
    let st;
    try {
      st = await fs.promises.stat(ruta);
    } catch {
      return notFound(res, 'Backup');
    }
    if (!st.isFile()) return notFound(res, 'Backup');

    // Se abre ANTES de auditar y de mandar cabeceras: si no hay permiso de
    // lectura, que sea un error claro y no una descarga cortada.
    let fd;
    try {
      fd = await fs.promises.open(ruta, 'r');
    } catch (err) {
      logger.error(`Backups: no se puede abrir ${nombre}: ${err.code || err.message}`);
      registrarErrorServidor(req, err);
      return error(res, 'El servidor no puede leer ese backup (permisos). Ver docs/BACKUPS.md §9.', 500);
    }

    await logAudit({
      userId:     req.user.id,
      userInfo:   req.user.username,
      action:     'download_backup',
      entityType: 'backup',
      details:    { nombre, tamano: st.size },
      ip:         req.ip,
      userAgent:  req.headers['user-agent'],
    });

    // Sin await: el aviso no retrasa la descarga y push nunca lanza.
    push.notificarSuperadmins({
      titulo: 'Descarga de un backup de la BD',
      cuerpo: `${req.user.username} ha descargado ${nombre}. Si no has sido tú o no te suena, revisa la auditoría.`,
      url:    '/admin',
      tag:    `backup-${nombre}`,
    });

    res.set({
      'Content-Type':        'application/gzip',
      'Content-Length':      String(st.size),
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control':       'no-store',
    });
    const stream = fd.createReadStream();
    stream.on('error', (err) => {
      logger.error(`Backups: error leyendo ${nombre}: ${err.message}`);
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { listBackups, downloadBackup, PATRON_DUMP };
