# Plan de trabajo — Asignaciones + Vehículos

> Compañero de [ESTADO_PROYECTO.md](ESTADO_PROYECTO.md), que describe *dónde estamos*.
> Este documento describe *qué hacemos ahora y en qué orden*.
> Base: commit `1ed6904` · rama `master` · 2026-08-25.

---

## Cómo leer este plan

Cada tarea lleva: **objetivo**, **ficheros**, **enfoque**, **riesgo** y **verificación**.
La verificación no es opcional: una tarea sin criterio de "hecho" comprobable no está hecha.

El orden importa. El bloque A arregla cosas que hoy pueden corromper datos o dejar una
instalación rota; hasta que no esté cerrado, cualquier cosa que construyamos encima hereda el
problema. Dentro de cada bloque, las tareas son independientes salvo donde se indique.

| | Bloque | Qué resuelve | Bloqueado por |
|---|---|---|---|
| 🔐 | **T0 — Seguridad** | Credenciales de producción expuestas | Decisión del propietario |
| 🔴 | **A — Integridad** | Instalación rota, duplicación de datos, pérdida de fotos | — |
| 🟠 | **B — Funcional** | Lo que el cliente pidió y falta | B4 espera al cliente |
| 🟡 | **C — Higiene** | Documentación, tests, deuda menor | — |

---

## T0 — Credenciales expuestas (bloqueante, y no es código)

Re-verificado hoy contra el remoto. **La situación no ha cambiado y sigue viva:**

- `Neorilas/ambulancias` es **`PUBLIC`**, rama por defecto `master`.
- `origin/master` contiene ahora mismo `deploy_helper.py` (host, usuario `root` y contraseña de
  root del servidor Hetzner de producción) y `test_api.mjs` (usuario y contraseña del admin y de
  un técnico de **producción**; la del admin era la misma cadena que la de root).
- El commit de limpieza `f88de9f` existe en el remoto, pero **solo en la rama
  `claude/optimistic-kapitsa-d50f67`, sin mergear**.

Lo que sí quedó descartado al re-verificar (dos correcciones al registro anterior):

- `accesos.html` y `copys.txt`: **0 commits**, nunca estuvieron rastreados. Limpios.
- `RAILWAY-DEPLOY.md`: sí estuvo commiteado (añadido en `3aa1a4b`, borrado en `63aa992`), pero la
  versión commiteada usa referencias de plantilla `${{...}}` y placeholders `<...>`, **no secretos
  reales**. El historial está limpio en ese fichero.
- Ningún `.env` real commiteado; `backend/.env.example` son placeholders;
  `frontend/.env.production` solo lleva una URL pública; los workflows usan `secrets.*`
  correctamente.

**La exposición son exactamente esos dos ficheros, y está activa en la rama por defecto.**

### Pasos

1. Llevar la limpieza a `master` (merge de la rama, o rehacerla encima de master).
2. **Rotar** — esto es lo que de verdad cierra el incidente; limpiar el HEAD no borra el historial
   público, que lleva ~5 meses indexable:
   - contraseña de `root` en Hetzner,
   - contraseñas de `findelias` y `jlopez` en la app,
   - `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (invalida todos los refresh tokens vivos: los
     usuarios tendrán que volver a entrar — hacerlo en horario de poca actividad),
   - contraseña de MySQL.
3. SSH solo con clave: `PasswordAuthentication no`, `PermitRootLogin prohibit-password`.
4. Revisar `audit_logs` y `/var/log/auth.log` buscando accesos anómalos desde marzo.
5. Opcional pero recomendable: valorar reescribir el historial (`git filter-repo`) o pasar el repo
   a privado. Ninguna de las dos sustituye a la rotación.

> **Decisión tuya, no mía:** los pasos 2–5 tocan producción y accesos. Dime cuáles quieres que
> prepare (puedo dejar listo el paso 1 y los comandos del 3) y cuáles haces tú.

---

## Bloque A — Integridad

### A1 · Portar `migration_v2..v8` al runner

**Objetivo:** que una BD en blanco produzca el esquema real arrancando el backend, sin pasos
manuales.

**Ficheros:** [migrations.js](backend/src/config/migrations.js) (array `MIGRATIONS`, insertar
**antes** de `v9_app_features`), [migrations.test.js](backend/src/__tests__/unit/config/migrations.test.js).

**Enfoque** — una entrada por migración, en orden, con nombre nuevo y estable:

| Entrada | Contenido |
|---|---|
| `v2_incidencias_revisiones` | `CREATE TABLE IF NOT EXISTS vehicle_revisiones`, `vehicle_incidencias` |
| `v3_audit_error_logs` | `CREATE TABLE IF NOT EXISTS audit_logs`, `error_logs` |
| `v4_permisos` | `permissions`, `role_permissions` + `INSERT IGNORE` de los 6 permisos y su reparto por rol |
| `v5_trabajos_activado_por` | columna `trabajos.activado_por` + FK |
| `v6_asignaciones_libres` | `CREATE TABLE IF NOT EXISTS asignaciones_libres` + `vehicle_images.asignacion_id` e índice |
| `v7_tarjeta_transporte` | columna `vehicles.fecha_tarjeta_transporte` + índice |
| `v8_momento_fotos` | ampliar ENUM `vehicle_images.tipo_imagen`, añadir `momento`, índice |

**Dos trampas concretas:**

1. **`migration_v5.sql` no funciona en MySQL 8.** Usa `ADD COLUMN IF NOT EXISTS` y
   `ADD CONSTRAINT IF NOT EXISTS`, que son sintaxis de MariaDB. Hay que reescribirla con el helper
   `ensureColumn(...)` que ya existe en el runner, no copiar el SQL tal cual.
2. **`v4` re-siembra `role_permissions` con `INSERT IGNORE`.** Verificado: la aplicación solo
   **lee** esa tabla ([auth.controller.js:31](backend/src/controllers/auth.controller.js:31)), no
   hay ninguna UI que la escriba, así que no existe divergencia que pisar. Es seguro. *(Esto es lo
   que distingue este caso de `v10_baseline_vehiculos`, que sí pisaría toggles del panel.)*

En producción estas 7 entradas serán no-ops (las tablas ya existen) y quedarán registradas en
`schema_migrations`, que es exactamente lo que queremos: el ledger pasa a reflejar la realidad.

**Riesgo:** bajo si todo es idempotente. El runner corta la cadena al primer fallo y deja el
servidor en pie, así que un error se ve en logs sin tumbar la API.

**Verificación:**
- MySQL 8 en blanco → `setup-db.js` → arrancar backend → los logs listan v2…v12 aplicadas, sin
  ninguna `FALLIDA`, y `GET /asignaciones` responde 200.
- Segundo arranque: "esquema al día, nada que aplicar".
- Contra un dump de producción: 0 cambios de esquema, solo filas nuevas en `schema_migrations`.
- Ampliar `migrations.test.js` para cubrir las entradas nuevas.

---

### A2 · Envío idempotente del wizard de inicio

**Objetivo:** que reintentar tras un fallo de red no duplique nada.

**Ficheros:** [InicioAsignacion.jsx:109](frontend/src/pages/asignaciones/InicioAsignacion.jsx:109)
(`handleSubmit`).

**El problema exacto:** las fotos de `momento='inicio'` se reemplazan por `(tipo, momento)`, así
que reintentar es inocuo. Pero las de incidencia van con `momento='general'`, que **se acumula**, y
`crearIncidencia` crea una fila nueva cada vez. Un reintento deja fotos duplicadas y una incidencia
duplicada en el historial del vehículo.

**Enfoque:** que el envío sea reanudable en lugar de "todo o nada".

- Ir vaciando del estado lo ya confirmado por el servidor: cuando `uploadEvidencia` resuelve, sacar
  ese fichero de `fotos` / `incFotos`. Un reintento solo reenvía lo que falta.
- Guardar el id de la incidencia creada (p. ej. `incidenciaCreadaId` en un `useRef`) y saltarse
  `crearIncidencia` si ya existe.
- Al fallar, no perder el progreso: mostrar el error, dejar al usuario en la pantalla de confirmar
  y ofrecer "Reintentar" sobre lo que quede.

**Alternativa considerada y descartada:** clave de idempotencia en el backend. Es más robusto pero
toca esquema y endpoint; para un wizard de un solo usuario, resolverlo en cliente es proporcionado.
Si más adelante aparecen más flujos de subida, merecerá la pena reconsiderarlo.

**Verificación:** test de componente que hace fallar la 3ª subida, reintenta, y comprueba que
`crearIncidencia` se llamó **una sola vez** y que no se reenvían las fotos ya confirmadas.

---

### A3 · Wizards reanudables

**Objetivo:** que cerrar la app a mitad de la revisión no obligue a repetir las fotos.

**Ficheros:** [InicioAsignacion.jsx:45](frontend/src/pages/asignaciones/InicioAsignacion.jsx:45),
[FinalizacionAsignacion.jsx](frontend/src/pages/asignaciones/FinalizacionAsignacion.jsx) (mismo
patrón), y el paso de props desde
[AsignacionDetalle.jsx](frontend/src/pages/asignaciones/AsignacionDetalle.jsx).

**El problema:** `useState({})` arranca vacío y nunca se siembra desde `asignacion.evidencias`,
que ya viene en la respuesta de `GET /asignaciones/:id`. Las fotos viven como `File` en memoria
hasta el envío final. 6 de 7 fotos hechas + app cerrada = 6 fotos perdidas.

**Enfoque (dos capas, la primera es la importante):**

1. **Sembrar desde el servidor.** `AsignacionDetalle` ya tiene `asig.evidencias`. Inicializar el
   estado con lo ya subido (`{ [tipo]: { url } }` en vez de `File`), pintar la miniatura remota y
   contarla como completada en el gate de la sección. Barato y cubre el caso real: el técnico entró
   antes y subió parte.
2. **Subir en cuanto se captura**, en lugar de acumular hasta el final. Elimina la ventana de
   pérdida por completo y hace A2 casi trivial. Es el cambio más invasivo de los dos: hay que
   manejar estado por foto (pendiente / subiendo / subida / error) y qué pasa si el usuario
   retrocede de sección.

**Recomendación:** hacer (1) ya, y (2) solo si el equipo de campo sigue reportando pérdidas. (1)
resuelve la reanudación entre sesiones; (2) resuelve además el corte a mitad de envío, que A2 ya
mitiga.

**Ojo:** las miniaturas sembradas vienen del servidor (`getImageUrl`), no de `URL.createObjectURL`.
No pasarlas por el `revokeObjectURL` del cleanup o se romperán las imágenes.

**Verificación:** abrir una asignación con 3 de 7 fotos ya subidas → el wizard muestra 3/7 hechas
con sus miniaturas y solo pide las 4 restantes. Test de componente con `evidencias` precargadas.

---

## Bloque B — Funcional

### B1 · Capturar `km_inicio`

**Objetivo:** cerrar la asimetría — hoy se fotografía el cuadro al empezar pero nadie apunta el
número, así que el kilometraje del servicio no es calculable y la validación
`km_fin >= km_inicio` casi nunca se ejerce.

**Ficheros:** `InicioAsignacion.jsx` (sección `mecanica`, junto a la foto del cuentakilómetros),
`asignaciones.controller.js` + `asignaciones.routes.js` para admitir `km_inicio` desde el
responsable.

**Enfoque:** input numérico junto a la foto del cuadro, misma pareja foto+número que ya usa el
cierre. El backend hoy solo deja tocar `km_inicio` a `manage_trabajos` vía `PUT`; el responsable
necesita poder fijarlo. Lo más limpio es aceptarlo en `POST /:id/activar` (es el momento natural, y
el endpoint ya autoriza al responsable) o añadir un `PATCH /:id/km-inicio`. **Preferencia:
`activar`**, porque no añade superficie de API.

**Decisión pendiente:** ¿obligatorio u opcional? Obligatorio da datos consistentes; opcional no
frena al técnico si el cuadro no se lee. Propongo **obligatorio**, coherente con que en el cierre
ya lo es.

**Verificación:** iniciar un servicio → el km queda en BD → al cerrar, `km_fin` menor que
`km_inicio` se rechaza con 400.

---

### B2 · Exigir `km_fin` en el backend

**Objetivo:** que la regla no dependa de que el cliente sea nuestra UI.

**Ficheros:** [asignaciones.controller.js:383](backend/src/controllers/asignaciones.controller.js:383),
`asignaciones.routes.js`.

**Enfoque:** pasar `km_fin` de `optional()` a requerido en el validador y rechazar el cierre sin él.

**Riesgo — mirar antes de tocar:** si hay asignaciones históricas cerradas con `km_fin NULL`, esto
no las afecta (solo valida el cierre nuevo), pero conviene contarlas antes para saber qué esperar
en los informes. Consulta de lectura sobre producción, que es el acceso que tenemos.

**Verificación:** `POST /finalizar` sin `km_fin` → 400. Test de controlador.

---

### B3 · Historial de asignaciones del técnico

**Objetivo:** que un técnico pueda consultar lo que hizo y las fotos que subió.

**Ficheros:** [MisAsignaciones.jsx:23](frontend/src/pages/asignaciones/MisAsignaciones.jsx:23).

**El problema:** el filtro descarta `finalizada` y `cancelada` y no hay otra vista. Solo admin y
gestor ven ese histórico, y por el historial del vehículo.

**Enfoque:** dos pestañas — "Activas" (lo de hoy) e "Historial" (`estado=finalizada|cancelada`,
paginado, más recientes primero). El backend ya soporta `?estado=` y ya filtra por `user_id` para
operacionales, así que **no hace falta tocar backend**. `AsignacionDetalle` ya renderiza en modo
solo-lectura cuando está finalizada.

**Verificación:** entrar como técnico con asignaciones cerradas → aparecen en Historial, se abren
en solo lectura, se ven las fotos, y no hay botones de acción.

---

### B4 · Checklist de revisión — 🔒 bloqueado

**Objetivo:** checks marcados OK por defecto; desmarcar uno lo señala como incidencia; al final, un
cuadro de observaciones con todo lo desmarcado.

**Bloqueado por el cliente:** faltan los puntos concretos del checklist (pregunta abierta desde
2026-07-11, ver `FLUJO_SERVICIO.md` §4 Q4).

**Lo que sí se puede adelantar sin respuesta:** el esquema es genérico (`punto` como texto libre),
así que la BD no bloquea.

- Migración `v13_revision_items`: tabla `asignacion_revision_items`
  `(id, asignacion_id, momento ENUM('inicio','fin'), punto VARCHAR, estado ENUM('ok','incidencia'), observacion TEXT, created_at)`.
- `POST /asignaciones/:id/revision` — guardado en bloque, autorizado igual que `/evidencias`.
- Los puntos, en una constante compartida, para poder rellenarlos en cuanto lleguen.

**No adelantar el frontend** hasta tener la lista: el diseño de la pantalla depende de cuántos
puntos son y cómo se agrupan.

---

### B5 · Banner de "servicio en curso"

**Objetivo:** reforzar que cerrar la app no cierra el servicio (el dato ya es correcto en BD; es
un problema de percepción).

**Ficheros:** `MisAsignaciones.jsx`, o `Layout.jsx` si se quiere visible en toda la app.

**Enfoque:** banner persistente mientras el técnico tenga alguna asignación `activa`, con vehículo,
hora real de inicio y acceso directo al detalle. Barato y con impacto directo en el uso real.

---

## Bloque C — Higiene

### C1 · Documentar `/asignaciones` en `docs/API.md`
Los 9 endpoints, con permisos, cuerpos y errores. Hoy la superficie principal del producto no está
documentada en un fichero de 303 líneas que sí documenta el resto.

### C2 · Tests de componente de los wizards
`frontend/src/__tests__/component/pages/` está vacío. Cubrir: navegación entre secciones, gating
por fotos, reintento (A2), siembra desde evidencias (A3), rama de finalización anticipada. Los
servicios ya están cubiertos; lo que falta es la lógica de los wizards, que es donde vive el
producto.

### C3 · `notas` y `km_inicio` no se pueden vaciar
[asignaciones.controller.js:241](backend/src/controllers/asignaciones.controller.js:241): el patrón
`COALESCE(?, notas)` con `notas !== undefined ? notas : null` hace que mandar `null` para borrar no
haga nada. Distinguir "no enviado" de "enviado como null" construyendo el `SET` dinámicamente solo
con las claves presentes en `req.body`.

### C4 · `progreso` en el listado
`GET /asignaciones` no lo devuelve, así que la tarjeta no puede decir "faltan 2 fotos de inicio"
sin abrir el detalle. Un `LEFT JOIN` agregado sobre `vehicle_images` agrupando por
`(asignacion_id, momento)` evita el N+1.

---

## Orden de ejecución

```
T0 ─ seguridad ─ en paralelo, decisión tuya
     │
A1 ─ migraciones ──────────────┐
A2 ─ idempotencia ─┐           │  (A1 es independiente de A2/A3)
A3 ─ reanudable ───┴─ mismo código, hacer juntas
     │
B1 ─ km_inicio ─┬─ B2 ─ km_fin obligatorio   (B2 después de B1: si no, se exige
B3 ─ historial ─┤                             un km_fin que no tiene contra qué validar)
B5 ─ banner ────┘
B4 ─ checklist ─── 🔒 espera al cliente
     │
C1..C4 ─ en cualquier momento; C2 conviene junto a A2/A3
```

**A2 y A3 tocan el mismo `handleSubmit`**: hacerlas en la misma pasada evita reescribir dos veces.

---

## Criterios de "hecho"

Una tarea está cerrada cuando:

1. `cd backend && npx jest --silent` en verde (hoy 263/263).
2. `cd frontend && npx vitest run` en verde (hoy 135/135).
3. Tiene test propio si toca lógica — no vale "se ve bien en pantalla".
4. Se ha probado el camino real en preview, no solo el test.
5. `ESTADO_PROYECTO.md` actualizado: el problema correspondiente tachado o reescrito.
6. Commit + push (ver [workflow del repo](ESTADO_PROYECTO.md#9-reglas-de-oro-de-este-repo)).

Para A1, además: **arranque contra una BD en blanco**. Es la única prueba que vale; que pasen los
tests unitarios no demuestra que el esquema se construya.

---

## Preguntas abiertas

| # | Pregunta | Bloquea |
|---|---|---|
| 1 | ¿Puntos concretos del checklist de revisión? | B4 entero |
| 2 | ¿`km_inicio` obligatorio u opcional? | B1 (propongo obligatorio) |
| 3 | ¿Qué secciones extra quiere el cliente en el wizard (material sanitario…)? | Nada hoy; `SECCIONES` ya está preparado |
| 4 | De T0, ¿qué pasos hago yo y cuáles haces tú? | T0 |
