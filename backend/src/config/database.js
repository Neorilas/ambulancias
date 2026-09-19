/**
 * config/database.js
 * Pool de conexiones MySQL con mysql2/promise
 */

'use strict';

const mysql  = require('mysql2/promise');
const logger = require('../utils/logger.utils');

// mysql2 solo acepta URI como string directo, no como campo {uri:...} en un objeto.
// Parseamos la URL manualmente para poder añadir opciones de pool.
function buildPoolConfig() {
  const base = {
    waitForConnections:    true,
    connectionLimit:       parseInt(process.env.DB_POOL_MAX || '10'),
    queueLimit:            0,
    enableKeepAlive:       true,
    keepAliveInitialDelay: 0,
    // mysql2 interpreta y serializa todas las fechas como UTC. Es la mitad del
    // contrato: la otra mitad es fijar la zona de la SESIÓN (ver más abajo),
    // porque si no CURRENT_TIMESTAMP escribiría la hora local del servidor
    // MySQL y se leería como si fuera UTC. Ver utils/fecha.utils.js.
    timezone:              '+00:00',
    charset:               'utf8mb4',
  };

  const rawUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      // Solo usar la URL si el hostname es un valor real (no una referencia sin resolver)
      if (u.hostname && !u.hostname.includes('{{')) {
        return {
          ...base,
          host:     u.hostname,
          port:     parseInt(u.port) || 3306,
          user:     decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
          database: u.pathname.replace(/^\//, ''),
        };
      }
    } catch (_) {
      // URL inválida (referencias sin resolver) → caer a variables individuales
    }
  }

  return {
    ...base,
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME     || 'ambulancia_db',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
  };
}

function buildPoolConfigWithLog() {
  const cfg = buildPoolConfig();
  logger.info(`DB config → host=${cfg.host} port=${cfg.port} db=${cfg.database} user=${cfg.user}`);
  return cfg;
}

const pool = mysql.createPool(buildPoolConfigWithLog());

// Cada conexión nueva del pool arranca en UTC, pase lo que pase con la zona
// horaria del contenedor de MySQL. mysql2 encola esta sentencia en la conexión
// antes de entregarla, así que se aplica antes que cualquier query de negocio.
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) logger.error(`No se pudo fijar time_zone=UTC en la conexión: ${err.message}`);
  });
});

/**
 * Verifica la conexión al arrancar el servidor
 */
async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    // Todo el contrato de fechas se apoya en que la sesión va en UTC. Si el SET
    // de arriba no hubiera entrado, las horas volverían a guardarse desplazadas
    // y en silencio, así que al menos que se vea en el log del arranque.
    const [[tz]] = await conn.query('SELECT @@session.time_zone AS zona');
    if (tz.zona !== '+00:00') {
      logger.error(
        `La sesión de MySQL no está en UTC (time_zone = ${tz.zona}). ` +
        'Las fechas que escriba el servidor saldrán desplazadas: revisa ' +
        'config/database.js y --default-time-zone del contenedor.'
      );
    }
  } finally {
    conn.release();
  }
}

/**
 * Ejecuta una query con parámetros
 * @param {string} sql
 * @param {Array}  params
 * @returns {Promise<[Array, Array]>}
 */
async function query(sql, params = []) {
  try {
    // pool.query() en lugar de pool.execute() para compatibilidad con
    // LIMIT ? / OFFSET ? en MySQL prepared statements via mysql2
    const [rows, fields] = await pool.query(sql, params);
    return [rows, fields];
  } catch (err) {
    logger.error(`DB Error → ${sql.substring(0, 120)}`, { params, message: err.message });
    throw err;
  }
}

/**
 * Ejecuta múltiples queries dentro de una transacción
 * @param {Function} callback - async (connection) => { ... }
 */
async function transaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transaction, testConnection };
