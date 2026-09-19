-- ============================================================
-- MIGRACIÓN v16: pasar a UTC las horas que MySQL escribió en hora española
-- ============================================================
-- NOTA: esto ya se aplica AUTOMÁTICAMENTE al arrancar el backend
-- (backend/src/config/migrations.js → 'v16_horas_a_utc'), marcado en la tabla
-- schema_migrations. Este fichero queda como referencia y como vía de
-- aplicación manual.
--
-- EL PROBLEMA
-- El contenedor de MySQL corría con TZ=Europe/Madrid, así que NOW() y
-- CURRENT_TIMESTAMP devolvían la hora española. El backend, en cambio, declara
-- el pool con timezone '+00:00', es decir: lee toda fecha de la base de datos
-- como si fuera UTC. Resultado: cada instante escrito por el servidor salía por
-- pantalla una hora por delante en invierno y dos en verano. Se veía sobre todo
-- en la hora de "Inicio de servicio" y en la de finalización de una asignación,
-- mientras que fecha_inicio / fecha_fin (que las manda el navegador ya en UTC)
-- se mostraban bien. De ahí que fallara "a veces": dependía de quién escribía
-- el dato y de la época del año.
--
-- QUÉ SE CORRIGE
--   · Solo columnas DATETIME cuyo valor lo ponía el servidor.
--   · NO se tocan trabajos.fecha_inicio/fecha_fin ni las de asignaciones: esas
--     llegan del navegador ya en UTC y siempre estuvieron bien.
--   · NO hace falta tocar las columnas TIMESTAMP: MySQL las guarda por dentro
--     en UTC y se ven bien en cuanto la sesión va en UTC.
--
-- DESDE CUÁNDO
-- El corte es 2026-08-25 15:00:00, cuando el contenedor de producción se
-- recreó ya con TZ=Europe/Madrid (arrancó a las 15:09; el último registro
-- coherente con UTC es de ese día a las 13:54). Lo anterior ya está bien.
--
-- CONVERT_TZ necesita las tablas de zonas horarias cargadas en MySQL. Si
-- devuelve NULL, usa el runner del backend, que hace la conversión en Node.
-- ============================================================

-- OJO: corregir o no se decide COLUMNA A COLUMNA, no por fila. Una asignación
-- que se inició antes del corte (esa hora ya está bien) y se finalizó después
-- (esa está mal) solo debe mover la segunda: de ahí los CASE WHEN.

SET @corte = '2026-08-25 15:00:00';

UPDATE asignaciones_libres
   SET inicio_real_at = CASE WHEN inicio_real_at >= @corte
         THEN COALESCE(CONVERT_TZ(inicio_real_at, 'Europe/Madrid', 'UTC'), inicio_real_at)
         ELSE inicio_real_at END,
       finalizado_at  = CASE WHEN finalizado_at >= @corte
         THEN COALESCE(CONVERT_TZ(finalizado_at,  'Europe/Madrid', 'UTC'), finalizado_at)
         ELSE finalizado_at END
 WHERE inicio_real_at >= @corte OR finalizado_at >= @corte;

UPDATE audit_logs
   SET created_at = COALESCE(CONVERT_TZ(created_at, 'Europe/Madrid', 'UTC'), created_at)
 WHERE created_at >= @corte;

UPDATE error_logs
   SET created_at = COALESCE(CONVERT_TZ(created_at, 'Europe/Madrid', 'UTC'), created_at)
 WHERE created_at >= @corte;

UPDATE incidencia_comentarios
   SET created_at = COALESCE(CONVERT_TZ(created_at, 'Europe/Madrid', 'UTC'), created_at)
 WHERE created_at >= @corte;

-- updated_at entra en el SET aunque su rama ELSE lo deje igual: si se quedara
-- fuera, el ON UPDATE CURRENT_TIMESTAMP lo machacaría con la hora actual.
UPDATE vehicle_incidencias
   SET created_at  = CASE WHEN created_at >= @corte
         THEN COALESCE(CONVERT_TZ(created_at,  'Europe/Madrid', 'UTC'), created_at)
         ELSE created_at END,
       updated_at  = CASE WHEN updated_at >= @corte
         THEN COALESCE(CONVERT_TZ(updated_at,  'Europe/Madrid', 'UTC'), updated_at)
         ELSE updated_at END,
       resuelto_at = CASE WHEN resuelto_at >= @corte
         THEN COALESCE(CONVERT_TZ(resuelto_at, 'Europe/Madrid', 'UTC'), resuelto_at)
         ELSE resuelto_at END
 WHERE created_at >= @corte OR updated_at >= @corte OR resuelto_at >= @corte;

UPDATE vehicle_revisiones
   SET created_at = CASE WHEN created_at >= @corte
         THEN COALESCE(CONVERT_TZ(created_at, 'Europe/Madrid', 'UTC'), created_at)
         ELSE created_at END,
       updated_at = CASE WHEN updated_at >= @corte
         THEN COALESCE(CONVERT_TZ(updated_at, 'Europe/Madrid', 'UTC'), updated_at)
         ELSE updated_at END
 WHERE created_at >= @corte OR updated_at >= @corte;

INSERT IGNORE INTO schema_migrations (name) VALUES ('v16_horas_a_utc');
