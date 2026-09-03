-- ============================================================
-- MIGRACIÓN v14: deshacer el cruce alias / matrícula (IDEMPOTENTE)
-- ============================================================
-- NOTA: esto ya se aplica AUTOMÁTICAMENTE al arrancar el backend
-- (backend/src/config/migrations.js → 'v14_normalizar_alias_matricula'),
-- marcado en la tabla schema_migrations. Este fichero queda como referencia
-- y como vía de aplicación manual.
--
-- Motivo: al dar de alta la flota se escribió el nombre de la ambulancia en
-- el campo `matricula` y la matrícula en el campo `alias`, porque el nombre
-- es lo que el personal reconoce y la interfaz daba protagonismo a la
-- matrícula. Se corrige el dato y, en el mismo cambio, la interfaz pasa a
-- mostrar el nombre como titular.
--
-- Criterio de seguridad: solo se intercambia una fila cuando NO hay
-- ambigüedad, es decir cuando `alias` tiene forma de matrícula española y
-- `matricula` no la tiene. Si las dos la tienen, o ninguna, la fila se deja
-- intacta para revisarla a mano.
--
-- La versión del runner hace además dos cosas que aquí no se replican:
-- descarta las filas cuya matrícula normalizada colisionaría con la de otro
-- vehículo, y deja en el log los que quedan con matrícula no reconocible.
-- Se puede ejecutar varias veces sin efecto adverso.
--
-- CORREGIDA POR v15. Este criterio toma como candidatas todas las filas,
-- también las borradas lógicamente, y eso dejó en producción un vehículo vivo
-- sin descruzar porque su matrícula objetivo chocaba con la de una fila
-- borrada. Ver database/migration_v15.sql.
-- ============================================================

-- Forma de matrícula española: 1234BCD (actual) o M1234AB (anterior),
-- ignorando espacios y guiones.
SET @re := '^([0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}|[A-Z]{1,2}[0-9]{4}[A-Z]{0,2})$';

-- 1. Revisión previa: qué filas se van a tocar.
SELECT id, matricula, alias
FROM vehicles
WHERE UPPER(REPLACE(REPLACE(alias,     ' ', ''), '-', '')) REGEXP @re
  AND UPPER(REPLACE(REPLACE(matricula, ' ', ''), '-', '')) NOT REGEXP @re;

-- 2. Guardar los valores originales de esas filas.
DROP TEMPORARY TABLE IF EXISTS `_v14_cruzados`;
CREATE TEMPORARY TABLE `_v14_cruzados` AS
SELECT id, matricula AS old_matricula, alias AS old_alias
FROM vehicles
WHERE UPPER(REPLACE(REPLACE(alias,     ' ', ''), '-', '')) REGEXP @re
  AND UPPER(REPLACE(REPLACE(matricula, ' ', ''), '-', '')) NOT REGEXP @re;

-- 3. Intercambio en dos pasadas: la primera libera el valor actual para no
--    violar la clave única `uq_matricula` mientras dos filas se cruzan.
UPDATE vehicles v JOIN `_v14_cruzados` t ON t.id = v.id
   SET v.matricula = CONCAT('__V14__', v.id);

UPDATE vehicles v JOIN `_v14_cruzados` t ON t.id = v.id
   SET v.matricula = UPPER(REPLACE(REPLACE(t.old_alias, ' ', ''), '-', '')),
       v.alias     = TRIM(t.old_matricula);

DROP TEMPORARY TABLE `_v14_cruzados`;

-- 4. Comprobación posterior: lo que salga aquí hay que corregirlo a mano
--    desde la ficha del vehículo (Vehículos → Editar).
SELECT id, matricula, alias
FROM vehicles
WHERE UPPER(REPLACE(REPLACE(matricula, ' ', ''), '-', '')) NOT REGEXP @re;
