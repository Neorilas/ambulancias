/**
 * utils/contextoPeticion.utils.js
 * Datos de la petición en curso accesibles sin pasar `req` de mano en mano.
 *
 * Existe por la impersonación: `logAudit` lo llaman ~30 sitios con
 * `userId: req.user.id` y ninguno sabe si detrás hay un superadmin viendo la
 * app como ese usuario. auth.middleware abre el contexto con `impersonadoPor`
 * y logAudit lo lee, así cada acción queda atribuida a los dos sin tocar los
 * controladores (ni acordarse en los que se escriban mañana).
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const contexto = new AsyncLocalStorage();

/** Ejecuta `fn` con `datos` como contexto de la petición. */
function conContexto(datos, fn) {
  return contexto.run(datos, fn);
}

/** El contexto de la petición en curso, o `undefined` fuera de una. */
function contextoActual() {
  return contexto.getStore();
}

module.exports = { conContexto, contextoActual };
