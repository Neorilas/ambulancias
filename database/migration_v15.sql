-- ============================================================
-- MIGRACIÓN v15: rematar el descruce alias / matrícula (IDEMPOTENTE)
-- ============================================================
-- NOTA: esto ya se aplica AUTOMÁTICAMENTE al arrancar el backend
-- (backend/src/config/migrations.js → 'v15_descruzar_vehiculos_restantes'),
-- marcado en la tabla schema_migrations. Este fichero queda como referencia
-- y como vía de aplicación manual.
--
-- Motivo: v14 tomó como candidatas TODAS las filas de `vehicles`, también las
-- borradas lógicamente. En producción eso dejó un vehículo vivo sin corregir:
--
--     id  matricula          alias      deleted_at
--     1   8588KCY__del_1     8588-KZY   2026-09-03 08:46:04
--     11  SVB-01             8588-KZY   NULL
--
-- Las dos filas aspiraban a la matrícula 8588KZY, v14 lo vio como duplicado y
-- no tocó ninguna. Pero la fila 1 está borrada: el borrado lógico le añade el
-- sufijo `__del_<id>` (ver deleteVehicle) justo para liberar la matrícula, así
-- que no debe competir por ella.
--
-- v15 repite el descruce restringido a las filas vivas. Las matrículas que
-- ocupan las filas borradas se siguen respetando para no violar uq_matricula.
-- Sobre una base donde v14 ya hizo bien el trabajo, es un no-op.
-- ============================================================

SET @re := '^([0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}|[A-Z]{1,2}[0-9]{4}[A-Z]{0,2})$';

-- 1. Revisión previa: filas VIVAS que siguen cruzadas.
SELECT id, matricula, alias
FROM vehicles
WHERE deleted_at IS NULL
  AND UPPER(REPLACE(REPLACE(alias,     ' ', ''), '-', '')) REGEXP @re
  AND UPPER(REPLACE(REPLACE(matricula, ' ', ''), '-', '')) NOT REGEXP @re;

-- 2. Guardar los valores originales de esas filas.
DROP TEMPORARY TABLE IF EXISTS `_v15_cruzados`;
CREATE TEMPORARY TABLE `_v15_cruzados` AS
SELECT id, matricula AS old_matricula, alias AS old_alias
FROM vehicles
WHERE deleted_at IS NULL
  AND UPPER(REPLACE(REPLACE(alias,     ' ', ''), '-', '')) REGEXP @re
  AND UPPER(REPLACE(REPLACE(matricula, ' ', ''), '-', '')) NOT REGEXP @re;

-- 3. Intercambio en dos pasadas: la primera libera el valor actual para no
--    violar la clave única `uq_matricula` mientras dos filas se cruzan.
UPDATE vehicles v JOIN `_v15_cruzados` t ON t.id = v.id
   SET v.matricula = CONCAT('__SWAP__', v.id);

UPDATE vehicles v JOIN `_v15_cruzados` t ON t.id = v.id
   SET v.matricula = UPPER(REPLACE(REPLACE(t.old_alias, ' ', ''), '-', '')),
       v.alias     = TRIM(t.old_matricula);

DROP TEMPORARY TABLE `_v15_cruzados`;

-- 4. Comprobación posterior: lo que salga aquí hay que corregirlo a mano
--    desde la ficha del vehículo (Vehículos → Editar).
SELECT id, matricula, alias
FROM vehicles
WHERE deleted_at IS NULL
  AND UPPER(REPLACE(REPLACE(matricula, ' ', ''), '-', '')) NOT REGEXP @re;
