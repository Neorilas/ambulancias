/**
 * config/database.js
 * Pool de conexiones MySQL con mysql2/promise
 */

'use strict';

const mysql  = require('mysql2/promise');
const logger = require('../utils/logger.utils');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT      || '3306'),
  database:           process.env.DB_NAME     || 'ambulancia_db',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_MAX || '10'),
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
  timezone:           '+00:00', // UTC en DB, conversión en app
  charset:            'utf8mb4',
});

/**
 * Verifica la conexión al arrancar el servidor
 */
async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
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
