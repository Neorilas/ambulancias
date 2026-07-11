# Flujo de servicio de la ambulancia (revisión inicio → jornada → cierre)

> Documento de diseño. Recoge la **idea** del flujo que queremos, la **compara con lo que ya existe** en el código y lo convierte en un **plan de implementación real** por fases.
> Autor de la idea: cliente/operativa. Fecha: 2026-07-11.

---

## 1. La idea (flujo objetivo)

### ➡️ Inicio de servicio
- Que aparezca la **ambulancia asignada**.
- Al pulsar **"Inicio de servicio"**, quede registrada **automáticamente la fecha y la hora** reales.
- Una vez hecho esto, pasar al siguiente paso.

### ➡️ Revisión mecánica básica
- Foto de la **varilla del aceite**.
- Foto del **nivel de agua / refrigerante**.
- Foto del **nivel del líquido de frenos**.
- Foto del **cuadro de instrumentos**.

### ➡️ Estado exterior del vehículo (fotos en cualquier orden)
- Foto **frontal**.
- Foto **trasera**.
- Foto **lateral derecha**.
- Foto **lateral izquierda**.

### ➡️ Incidencias o aspectos relevantes
- Posibilidad de añadir **una o varias fotos** de cualquier cosa relevante.
- Aquí **sí** existe la opción **"No hay incidencias" / "Continuar"** (no siempre hay algo que señalar).
- Mecánica de **checks**: cada punto de revisión está **marcado (OK) por defecto**; al **desmarcarlo** se señala como incidencia. Al final de la revisión aparece un cuadro de **"Observaciones"** con todas las entradas desmarcadas, para añadir información a cada incidencia.
- Objetivo: que **quede constancia visual** de que la revisión se hizo de verdad antes de arrancar.

### ➡️ Continuación del servicio
- Completada la revisión inicial y las fotos obligatorias, el técnico puede desplazarse al evento/servicio.
- La app permanece abierta y el servicio **sigue activo toda la jornada**.
- **No se puede cerrar el servicio simplemente cerrando la app.** El servicio queda "en curso" hasta completar los pasos finales.
- Solo cuando se completen todas las comprobaciones de cierre aparece **"Finalizar servicio"**.

### ➡️ Estado exterior del vehículo al finalizar (fotos en cualquier orden)
- Foto **frontal**.
- Foto **trasera**.
- Foto **lateral derecha**.
- Foto **lateral izquierda**.

### ➡️ Finalización del servicio.

---

## 2. Qué hay hoy en el código (estado real)

La funcionalidad ya existe como **"asignaciones libres"** (`asignaciones_libres`), independientes de los trabajos.

**Backend** — `backend/src/controllers/asignaciones.controller.js` + `routes/asignaciones.routes.js`:
- Estados: `programada → activa → finalizada / cancelada`.
- `POST /asignaciones/:id/activar` — pone `estado='activa'`. **No guarda una hora de inicio real**: la hora sale de `fecha_inicio` (programada). También hay auto-activación por cron al llegar `fecha_inicio`.
- `POST /asignaciones/:id/evidencias` — sube 1 foto (`tipo_imagen` + `momento` = `inicio`|`fin`).
- `POST /asignaciones/:id/finalizar` — exige km_fin, motivo si es anticipada, y **todas** las fotos de inicio y fin completas.
- `POST /asignaciones/:id/incidencias` — **solo admin/gestor** (`requirePermission(MANAGE_INCIDENCIAS)`). El técnico **no** puede registrar incidencias hoy.

**Fotos obligatorias hoy** (`backend/src/config/constants.js`, `frontend/src/utils/constants.js`):
- **Inicio (6):** frontal, lateral_izquierdo, trasera, lateral_derecho, **nivel_aceite**, **nivel_liquidos_general** (un solo tipo que agrupa refrigerante + frenos + otros).
- **Fin (5):** frontal, lateral_izquierdo, trasera, lateral_derecho, **cuentakilometros**.
- ENUM en BD `vehicle_images.tipo_imagen`: `frontal, lateral_izquierdo, lateral_derecho, trasera, niveles_liquidos, nivel_aceite, nivel_liquidos_general, cuentakilometros, danos`.

**Frontend** — `frontend/src/pages/asignaciones/`:
- `InicioAsignacion.jsx` — sube las 6 fotos de inicio. No pide km. No hay checklist ni incidencias.
- `FinalizacionAsignacion.jsx` — 5 fotos fin + km_fin + motivo (pasos: fotos → motivo → confirmar).
- `AsignacionDetalle.jsx` — orquesta ambos flujos, muestra progreso y evidencias. El bloque de incidencia solo aparece para admin/gestor.
- `CameraCapture.jsx` — cámara guiada (orden sugerido, pero el grid permite tocar cualquier foto → el "orden" no está forzado en la práctica).

---

## 3. Diferencias idea ↔ realidad (gap analysis)

| # | Idea | Estado hoy | Acción |
|---|------|-----------|--------|
| 1 | Botón "Inicio de servicio" que registra fecha/hora **real** | `activar` no guarda hora real; usa `fecha_inicio` programada | **Nuevo:** columna `inicio_real_at` + set en activar |
| 2 | Foto varilla aceite | ✅ `nivel_aceite` (inicio) | OK |
| 3 | Foto **refrigerante** separada | ❌ agrupada en `nivel_liquidos_general` | **Nuevo tipo** `nivel_refrigerante` |
| 4 | Foto **líquido de frenos** separada | ❌ agrupada | **Nuevo tipo** `nivel_frenos` |
| 5 | Foto **cuadro de instrumentos** en la revisión inicial | ❌ hoy `cuentakilometros` solo en fin | Añadir `cuentakilometros` a las fotos de **inicio** |
| 6 | 4 fotos exteriores en inicio (orden libre) | ✅ existen; orden no forzado | OK (confirmar que se quiere orden libre) |
| 7 | Bloque incidencias por el **técnico** (varias fotos + "No hay incidencias") | ❌ solo admin/gestor | **Nuevo:** permitir al responsable subir fotos `general`/`danos` y observaciones |
| 8 | Checklist con checks OK-por-defecto → desmarcar = incidencia → cuadro observaciones | ❌ no existe | **Nuevo:** modelo de checklist de revisión |
| 9 | Servicio "en curso" persistente; no se cierra al cerrar la app | ✅ el estado vive en BD (cerrar la app no finaliza nada) | OK a nivel de datos; reforzar UX de "servicio activo" |
| 10 | "Finalizar servicio" solo tras completar el cierre | ✅ parcialmente (exige fotos inicio+fin) | Ajustar a los nuevos pasos |
| 11 | Fotos exteriores al finalizar | ✅ (hoy fin incluye además cuentakilometros + km_fin) | Confirmar si se mantiene km/cuadro en el cierre |

---

## 4. Decisiones (cerradas 2026-07-11)

1. **Líquidos separados:** ❌ **NO.** Se mantiene `nivel_liquidos_general` como una sola foto (agrupa refrigerante + frenos). No se amplía el ENUM.
2. **Cuadro de instrumentos en inicio:** ✅ Sí (la idea lo pide en la revisión mecánica). Se añade `cuentakilometros` al set de fotos de inicio **junto con el wizard (Fase 3)** para no romper asignaciones en curso.
3. **Cierre:** ✅ Se **mantiene** km_fin + foto del cuentakilómetros al finalizar (registro de kilometraje). Solo se reorganiza la UI; el cierre no pierde datos.
4. **Checklist:** puntos concretos **pendientes** de que el cliente los liste. El esquema es genérico (`punto` texto libre), así que no bloquea la BD; sí bloquea el frontend del paso de revisión.
5. **Incidencias del técnico:** ✅ Crean **filas reales** en `vehicle_incidencias`, igual que las de admin/gestor. Entran en el historial del vehículo.
6. **Orden de fotos:** libre ("indistintamente") para las exteriores.

### Estado de implementación
- ✅ **Fase 1-2 (parcial, este commit):** columna `inicio_real_at` + registro de hora real al activar; el **responsable** puede registrar incidencias en su propia asignación.
- ⏳ **Pendiente:** wizard de inicio por pasos, añadir `cuentakilometros` al set de inicio, checklist de revisión (necesita los puntos de Q4).

---

## 5. Plan de implementación (por fases)

### Fase 0 — Cerrar decisiones (sección 4)
Sin esto no se toca esquema. Bloqueante para Fase 1.

### Fase 1 — Datos / Backend (migración v12)
- **`asignaciones_libres`**: añadir `inicio_real_at DATETIME NULL` (hora real de "Inicio de servicio").
- **`vehicle_images.tipo_imagen` ENUM**: añadir `nivel_refrigerante`, `nivel_frenos` (si se aprueban 3/4).
- **Checklist de revisión** (si se aprueba): nueva tabla `asignacion_revision_items`
  `(id, asignacion_id, momento ENUM('inicio','fin'), punto VARCHAR, estado ENUM('ok','incidencia'), observacion TEXT, created_at)`.
- Actualizar `constants.js` (backend): `IMAGEN_TIPOS_INICIO`, nuevos tipos, `IMAGEN_TIPOS` ENUM.

### Fase 2 — Backend endpoints
- `activarAsignacion` → set `inicio_real_at = NOW()` la primera vez.
- Nuevo `POST /asignaciones/:id/revision` — guarda los checks/observaciones (bulk).
- Permitir al **responsable** subir fotos `general`/`danos` de incidencia en su asignación (relajar permiso o endpoint específico), y opcionalmente crear filas en `vehicle_incidencias`.
- Ajustar validación de `finalizar` a los nuevos requisitos de fotos.
- Tests: actualizar `asignaciones.controller.test.js` y `constants.test.js` (recordar gotcha `query.mockReset()` con once-queue).

### Fase 3 — Frontend (flujo por pasos)
Convertir `InicioAsignacion.jsx` en un **wizard** con los pasos de la idea:
1. **Inicio de servicio** — muestra ambulancia + botón que llama a `activar` (registra hora) y avanza.
2. **Revisión mecánica** — aceite, refrigerante, frenos, cuadro (cada uno con su check OK-por-defecto).
3. **Estado exterior** — 4 fotos, orden libre.
4. **Incidencias / observaciones** — subir N fotos libres + botón "No hay incidencias / Continuar"; cuadro de observaciones con los checks desmarcados.
- Reforzar UX de **"servicio en curso"** (banner persistente en Mis Asignaciones mientras `estado='activa'`).
- Cierre: `FinalizacionAsignacion.jsx` ajustado a lo decidido en Q3 (fotos exteriores ± km/cuadro).
- Componentes nuevos: `ChecklistRevision.jsx`, paso de incidencias en el wizard.

### Fase 4 — QA y despliegue
- Probar en preview el wizard completo (inicio → jornada → fin).
- Migración v12 aplicada en Docker (volúmenes persistentes; ver notas de despliegue).
- Commit + push.

---

## 6. Ficheros que se tocarán (referencia)

- `database/migration_v12.sql` (nuevo)
- `backend/src/config/constants.js`
- `backend/src/controllers/asignaciones.controller.js`
- `backend/src/routes/asignaciones.routes.js`
- `frontend/src/utils/constants.js`
- `frontend/src/pages/asignaciones/InicioAsignacion.jsx`
- `frontend/src/pages/asignaciones/FinalizacionAsignacion.jsx`
- `frontend/src/pages/asignaciones/AsignacionDetalle.jsx`
- `frontend/src/pages/asignaciones/MisAsignaciones.jsx`
- Tests: `backend/.../asignaciones.controller.test.js`, `frontend/.../constants.test.js`
