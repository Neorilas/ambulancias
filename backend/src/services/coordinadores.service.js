/**
 * services/coordinadores.service.js
 * Los coordinadores de un trabajo (v35): 1..N, todos con las mismas funciones
 * (ven todas las ambulancias y cierran el trabajo). Mismo esquema que los
 * responsables de una asignación (v23): la lista vive en
 * `trabajo_coordinadores` y el primero (`orden` 0) se copia en
 * `trabajos.coordinador_user_id`, el coordinador PRINCIPAL.
 *
 * El principal se conserva porque «tiene coordinador» es lo que separa el
 * modelo nuevo del v25 (`esV25`, `motivoNoManual`, el cron de server.js) y
 * porque una PWA sin actualizar sigue mandando y leyendo el coordinador
 * suelto. **Quién coordina lo dice la lista, nunca la columna**: con varios,
 * mirar solo la columna dejaría fuera a todos menos al primero.
 *
 * Vive fuera de los controladores porque lo leen trabajos.controller (ficha,
 * listados, cierre), asignaciones.controller (la tarjeta del trabajo dentro
 * de la ambulancia) y estadoTrabajo.service (el «listo para cerrar»), y
 * meterlo en uno de los controladores crearía una dependencia circular.
 */

'use strict';

const { query } = require('../config/database');

/**
 * «Este usuario coordina el trabajo `t`». Un parámetro: el id del usuario.
 * La consulta que lo use tiene que llamar `t` a la tabla `trabajos`.
 */
const ES_COORDINADOR = `EXISTS (SELECT 1 FROM trabajo_coordinadores tco
                                 WHERE tco.trabajo_id = t.id AND tco.user_id = ?)`;

/** Nombres de los coordinadores de `t`, en su orden: «Ana Ruiz, Luis Gil». */
const NOMBRES_COORDINADORES = `(SELECT GROUP_CONCAT(CONCAT(cu.nombre, ' ', cu.apellidos)
                                         ORDER BY cn.orden SEPARATOR ', ')
                                  FROM trabajo_coordinadores cn JOIN users cu ON cu.id = cn.user_id
                                 WHERE cn.trabajo_id = t.id)`;

/**
 * Normaliza los coordinadores del body. Acepta el formato nuevo
 * (`coordinadores: [ids]`) y el viejo (`coordinador_user_id` suelto), que
 * sigue mandando una PWA sin actualizar.
 *
 * @returns {{coordinadores?: number[], soloPrincipal?: boolean, error?: string}}
 *   `coordinadores` undefined si no viene ninguno de los dos; `soloPrincipal`
 *   si vino el formato viejo (al editar, solo cambia el principal).
 */
function leerCoordinadores(body) {
  let lista = body.coordinadores;
  let soloPrincipal = false;
  if (lista === undefined || lista === null) {
    if (body.coordinador_user_id === undefined || body.coordinador_user_id === null) return {};
    lista = [body.coordinador_user_id];
    soloPrincipal = true;
  }
  const ids = (Array.isArray(lista) ? lista : [lista]).map(Number);
  if (ids.some(id => !Number.isInteger(id) || id < 1)) {
    return { error: 'Los coordinadores deben ser ids de usuario válidos' };
  }
  if (!ids.length) return { error: 'El trabajo necesita al menos un coordinador' };
  if (new Set(ids).size !== ids.length) {
    return { error: 'La misma persona no puede figurar dos veces como coordinador' };
  }
  return { coordinadores: ids, soloPrincipal };
}

/**
 * Formato viejo al editar (`coordinador_user_id` suelto): cambia SOLO el
 * principal y conserva a los demás. Si no, un formulario sin actualizar
 * borraría sin avisar a los coordinadores que no conoce.
 */
function cambiarPrincipal(actuales, nuevo) {
  return [nuevo, ...actuales.slice(1).filter(id => id !== nuevo)];
}

/** ¿Las dos listas de ids son la misma, en el mismo orden? (el orden decide el principal) */
function mismaLista(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Ids de los coordinadores de un trabajo, el principal primero. */
async function idsCoordinadores(trabajoId, db = query) {
  const [rows] = await db(
    'SELECT user_id FROM trabajo_coordinadores WHERE trabajo_id = ? ORDER BY orden',
    [trabajoId]
  );
  return rows.map(r => r.user_id);
}

/** Los coordinadores de un trabajo con su nombre, el principal primero. */
async function coordinadoresDe(trabajoId) {
  const [rows] = await query(
    `SELECT u.id, u.username, u.nombre, u.apellidos
     FROM trabajo_coordinadores tc
     JOIN users u ON u.id = tc.user_id
     WHERE tc.trabajo_id = ?
     ORDER BY tc.orden`,
    [trabajoId]
  );
  return rows;
}

/**
 * Reescribe los coordinadores de un trabajo y sincroniza el principal. Dentro
 * de la transacción de quien llama: la lista y la columna cambian juntas.
 */
async function guardarCoordinadores(conn, trabajoId, ids) {
  await conn.execute('DELETE FROM trabajo_coordinadores WHERE trabajo_id = ?', [trabajoId]);
  await conn.execute(
    `INSERT INTO trabajo_coordinadores (trabajo_id, user_id, orden)
     VALUES ${ids.map(() => '(?, ?, ?)').join(', ')}`,
    ids.flatMap((id, i) => [trabajoId, id, i])
  );
  await conn.execute('UPDATE trabajos SET coordinador_user_id = ? WHERE id = ?', [ids[0], trabajoId]);
}

module.exports = {
  ES_COORDINADOR,
  NOMBRES_COORDINADORES,
  leerCoordinadores,
  cambiarPrincipal,
  mismaLista,
  idsCoordinadores,
  coordinadoresDe,
  guardarCoordinadores,
};
