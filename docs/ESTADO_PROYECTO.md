# Estado del proyecto — Ambulancias (VAPSS)

> **Documento base.** Es la fuente de verdad sobre *dónde estamos* y *qué falta*.
> Alcance acordado: **solo Asignaciones + Vehículos** deben funcionar correctamente.
> Todo lo relativo a *Trabajos* está congelado y oculto por feature flags.
> Fecha de corte: **2026-08-25** · commit `acb1210` · rama `master` · árbol limpio.
> El plan de ejecución de todo lo pendiente vive en [PLAN_TRABAJO.md](PLAN_TRABAJO.md).

---

## 1. Resumen ejecutivo

El producto **funciona de punta a punta** en el camino que nos importa: un gestor crea una
asignación de vehículo a un técnico, el técnico inicia el servicio (queda sellada la hora real),
documenta el vehículo con fotos guiadas, reporta incidencias si las hay, y al terminar cierra el
servicio con las fotos de cierre y los kilómetros. Todo queda en el historial del vehículo.

Los 4 commits más recientes son exactamente ese flujo (`inicio_real_at` → wizard de inicio →
wizard de cierre → runner de migraciones). **Los tests pasan: 263 backend + 135 frontend.**

Lo que queda no es "construir el flujo" sino **endurecerlo**: tres bugs reales de resiliencia en
los wizards, una desincronización peligrosa entre `schema.sql` y las migraciones, y tres piezas
funcionales que el cliente pidió y siguen pendientes (checklist, km de inicio, historial del técnico).

| Bloque | Estado |
|---|---|
| Backend asignaciones (CRUD + activar/finalizar/evidencias/incidencias) | ✅ Completo y testeado |
| Backend vehículos (CRUD + imágenes + incidencias + revisiones + historial + alertas) | ✅ Completo y testeado |
| Wizard de inicio de servicio (4 secciones) | ⚠️ Funciona, **no es reanudable** |
| Wizard de cierre de servicio (4 secciones) | ⚠️ Funciona, **no es reanudable** |
| Panel de gestión de asignaciones (admin/gestor) | ✅ Completo |
| Checklist de revisión con checks OK-por-defecto | ❌ No existe (Q4 sin cerrar con cliente) |
| Km de inicio capturados por el técnico | ❌ No existe (asimetría con el cierre) |
| Historial de asignaciones para el propio técnico | ❌ No existe |
| `schema.sql` como instalador válido | 🔴 **Roto** para instalaciones nuevas |
| Documentación de API de `/asignaciones` | ❌ Ausente en `docs/API.md` |
| Tests de componente de los wizards | ❌ Ninguno |

> ⛔ **Fuera de alcance pero urgente:** `master` sigue conteniendo `deploy_helper.py` y
> `test_api.mjs` con credenciales reales en claro (root de Hetzner, admin y técnico de
> producción) en un repositorio **público**. La limpieza existe solo en la rama
> `claude/optimistic-kapitsa-d50f67`, **sin mergear**. Ver sección 10.

---

## 2. Arquitectura en 30 segundos

```
frontend (React 18 + Vite + Tailwind, PWA)   →  cPanel   (deploy-frontend.yml)
        │  axios → /api/v1
backend  (Node + Express CommonJS, mysql2 raw SQL)  →  Hetzner + Docker (deploy-backend.yml)
        │
MySQL 8  (volumen persistente; el deploy NUNCA toca MySQL)
```

- **Auth:** JWT HS256 (access 15 min) + refresh rotante 7 d, hash SHA-256 en BD.
- **Permisos:** tablas `permissions` / `role_permissions`; los permisos viajan **dentro del JWT**,
  así que no hay query extra por request. `superadmin` bypassa todo.
- **Feature flags:** tabla `app_features`; `FeaturesContext` en el frontend, toggles en `/admin`.
  La línea base "solo vehículos" (migración `v10_baseline_vehiculos`) apaga
  `menu_dashboard`, `menu_mis_trabajos`, `menu_trabajos`.
- **Migraciones:** runner idempotente en el arranque del backend
  ([migrations.js:68](backend/src/config/migrations.js:68)). **Un `.sql` en `/database` no se
  aplica solo** — hay que registrarlo en el array `MIGRATIONS`.
- **Cron:** cada 60 s auto-activa trabajos y asignaciones programadas cuya `fecha_inicio` ya pasó
  ([server.js:134](backend/server.js:134)).

---

## 3. Mapa del código relevante

### Asignaciones — backend

| Fichero | Qué hace |
|---|---|
| [asignaciones.routes.js](backend/src/routes/asignaciones.routes.js) | 9 endpoints + validación express-validator |
| [asignaciones.controller.js](backend/src/controllers/asignaciones.controller.js) | 556 líneas: CRUD, activar, finalizar, evidencias, incidencias |
| [constants.js](backend/src/config/constants.js) | `IMAGEN_TIPOS_INICIO` (7), `IMAGEN_TIPOS_FIN` (5), `IMAGEN_TIPOS_GENERAL` |

Endpoints:

| Método | Ruta | Quién |
|---|---|---|
| GET | `/asignaciones` | todos (operacionales filtrados a `user_id = yo`) |
| GET | `/asignaciones/:id` | responsable o `manage_trabajos` |
| POST | `/asignaciones` | `manage_trabajos` |
| PUT | `/asignaciones/:id` | `manage_trabajos` |
| DELETE | `/asignaciones/:id` | `manage_trabajos` (soft delete) |
| POST | `/asignaciones/:id/activar` | responsable o gestor — sella `inicio_real_at` (idempotente) |
| POST | `/asignaciones/:id/finalizar` | responsable o gestor — exige fotos inicio + fin completas |
| POST | `/asignaciones/:id/evidencias` | responsable o gestor — 1 foto (`tipo_imagen` + `momento`) |
| POST | `/asignaciones/:id/incidencias` | responsable **de esa** asignación o `manage_incidencias` |

### Asignaciones — frontend

| Fichero | Rol |
|---|---|
| [MisAsignaciones.jsx](frontend/src/pages/asignaciones/MisAsignaciones.jsx) | Home del técnico. Lista sus asignaciones no cerradas |
| [AsignacionDetalle.jsx](frontend/src/pages/asignaciones/AsignacionDetalle.jsx) | Panel lateral; orquesta inicio ↔ cierre y muestra evidencias |
| [InicioAsignacion.jsx](frontend/src/pages/asignaciones/InicioAsignacion.jsx) | Wizard de inicio (4 secciones) |
| [FinalizacionAsignacion.jsx](frontend/src/pages/asignaciones/FinalizacionAsignacion.jsx) | Wizard de cierre (4 secciones) |
| [AsignacionList.jsx](frontend/src/pages/asignaciones/AsignacionList.jsx) | Tabla admin/gestor con filtro por estado |
| [AsignacionForm.jsx](frontend/src/pages/asignaciones/AsignacionForm.jsx) | Alta/edición |
| [CameraCapture.jsx](frontend/src/components/camera/CameraCapture.jsx) | Cámara guiada a pantalla completa |

### Vehículos

| Fichero | Rol |
|---|---|
| [vehicles.controller.js](backend/src/controllers/vehicles.controller.js) | CRUD, imágenes, incidencias, revisiones, historial, alertas ITV/ITS/tarjeta |
| [VehicleList.jsx](frontend/src/pages/vehicles/VehicleList.jsx) | Listado + alta |
| [VehicleHistory.jsx](frontend/src/pages/vehicles/VehicleHistory.jsx) | 757 líneas — historial unificado: trabajos **y** asignaciones, fotos, incidencias, revisiones |
| [AlertsPage.jsx](frontend/src/pages/AlertsPage.jsx) | Caducidades (ITV / ITS / tarjeta de transporte, aviso 2 meses antes) |

---

## 4. Modelo de datos (lo que toca este alcance)

```
vehicles ──┬─< asignaciones_libres >── users        (vehicle_id, user_id, created_by)
           ├─< vehicle_images       (vehicle_id, trabajo_id?, asignacion_id?, tipo_imagen, momento)
           ├─< vehicle_incidencias  (vehicle_id, trabajo_id?, asignacion_id?, reported_by, responsable_user_id)
           └─< vehicle_revisiones   (itv / its / mantenimiento / …)
```

**`asignaciones_libres`** — estados `programada → activa → finalizada | cancelada`.
Campos clave: `fecha_inicio`, `fecha_fin` (previstas), **`inicio_real_at`** (hora real del botón),
`km_inicio`, `km_fin`, `motivo_fin`, `finalizado_por`, `finalizado_at`, `notas`, `deleted_at`.

**`vehicle_images.momento`** = `inicio` | `fin` | `general`.

- `inicio` (7, obligatorias): frontal, lateral_izquierdo, trasera, lateral_derecho,
  nivel_aceite, nivel_liquidos_general, cuentakilometros
- `fin` (5, obligatorias): frontal, lateral_izquierdo, trasera, lateral_derecho, cuentakilometros
- `general` (opcionales, **acumulables**): danos → fotos de incidencia

Regla del backend: `inicio`/`fin` son **únicas por (tipo, momento)** — volver a subir reemplaza y
borra el fichero anterior. `general` **se acumula** (no reemplaza). Esto importa para el bug #2.

---

## 5. El flujo de servicio tal y como está hoy

### Inicio — `InicioAsignacion.jsx`, `const SECCIONES = [...]`

1. **Inicio de servicio** — muestra vehículo + fin previsto; el botón llama a `/activar`, que sella
   `inicio_real_at = COALESCE(inicio_real_at, NOW())`. Idempotente: funciona aunque el cron ya haya
   puesto `estado='activa'`.
2. **Revisión mecánica** — aceite, líquidos (agrupados), cuadro de instrumentos.
3. **Estado exterior** — 4 caras, **orden libre**.
4. **Incidencias** — "No hay incidencias" / reportar: N fotos (`danos` + `general`) + observaciones
   → crea una fila real en `vehicle_incidencias` asignada al técnico responsable.

Al pulsar el botón final, **se suben todas las fotos de golpe** y se registra la incidencia.

### Cierre — `FinalizacionAsignacion.jsx`

1. **Estado exterior** — 4 caras, orden libre.
2. **Kilometraje** — foto del cuadro + `km_fin` (ambos exigidos por la UI).
3. **Motivo** — solo si `now < fecha_fin` (finalización anticipada).
4. **Confirmar** — sube fotos de `fin` y llama a `/finalizar`.

Si faltan fotos de inicio, el wizard de cierre se bloquea con un aviso en lugar de dejar continuar.

### Decisiones ya cerradas (2026-07-11, no reabrir sin el cliente)

- Refrigerante y frenos **no** se separan: siguen dentro de `nivel_liquidos_general`.
- El cuadro de instrumentos **sí** entra en las fotos de inicio.
- El cierre **mantiene** `km_fin` + foto del cuentakilómetros.
- Las incidencias del técnico crean **filas reales** en `vehicle_incidencias`.
- El orden de las fotos exteriores es **libre**.

---

## 6. Problemas detectados

Ordenados por lo que más duele. Los tres primeros son los que hay que arreglar antes de nada.

### 🔴 #1 — `schema.sql` no sirve para instalar el proyecto

`schema.sql` sólo crea: `users`, `roles`, `user_roles`, `login_attempts`, `refresh_tokens`,
`vehicles`, `trabajos`, `trabajo_vehiculos`, `trabajo_usuarios`, `vehicle_images`.

**No contiene** `asignaciones_libres`, `vehicle_incidencias`, `vehicle_revisiones`, `audit_logs`,
`error_logs`, `permissions`, `role_permissions`, `app_features`, ni la columna
`vehicle_images.momento`. Todo eso vive en `migration_v2..v8.sql`, que **nunca se registraron en el
runner** — el array `MIGRATIONS` empieza en `v9`.

Consecuencia: `node scripts/setup-db.js` sobre una BD limpia deja un esquema incompleto, y al
arrancar el backend **`v11` falla** (`vehicle_incidencias` no existe) y corta la cadena, así que
`v12` tampoco se aplica. Producción está bien sólo porque v2–v8 se aplicaron a mano en su día.

**Arreglo:** portar v2–v8 al array `MIGRATIONS` como entradas idempotentes (o consolidar
`schema.sql` a día de hoy). Verificable levantando MySQL en blanco.

### 🔴 #2 — Reintentar el wizard de inicio duplica incidencias y fotos

[InicioAsignacion.jsx:109](frontend/src/pages/asignaciones/InicioAsignacion.jsx:109) sube todo en
serie al final. Si falla la última subida (móvil, cobertura mala), se muestra el error y el usuario
reintenta con el mismo estado en memoria. Las fotos `inicio` son idempotentes (se reemplazan por
tipo), pero:

- las fotos de incidencia van con `momento='general'`, que **se acumula** → se duplican;
- `crearIncidencia` se vuelve a llamar → **fila duplicada** en `vehicle_incidencias`.

**Arreglo:** marcar qué se subió ya (o subir por foto y limpiar del estado lo confirmado), y crear
la incidencia una sola vez.

### 🟠 #3 — Los wizards no son reanudables

`const [fotos, setFotos] = useState({})`
([InicioAsignacion.jsx:45](frontend/src/pages/asignaciones/InicioAsignacion.jsx:45), y el
equivalente en el de cierre) arranca vacío y **no se siembra desde `asignacion.evidencias`**. Las
fotos viven como `File` en memoria hasta el envío final.

Si el técnico cierra la app con 6 de 7 fotos hechas, las pierde todas y la sección le vuelve a
exigir el total. En campo, con guantes y prisa, esto es el fallo que más se va a notar.

**Arreglo:** sembrar el estado con lo ya subido (mostrar la miniatura del servidor y contarla como
hecha) y/o subir cada foto en cuanto se captura.

### 🟠 #4 — Falta el km de inicio

El técnico fotografía el cuadro al empezar, pero **nadie teclea el número**. `km_inicio` sólo lo
puede rellenar el gestor, y es opcional. Al cerrar sí se piden los km. Resultado: la validación
`km_fin >= km_inicio` ([asignaciones.controller.js:354](backend/src/controllers/asignaciones.controller.js:354))
casi nunca se ejerce y el kilometraje recorrido en el servicio no es calculable.

### 🟡 #5 — `km_fin` es opcional en el backend

La UI lo exige, pero `POST /finalizar` acepta cerrar sin `km_fin`
([asignaciones.controller.js:383](backend/src/controllers/asignaciones.controller.js:383)).
Cualquier cliente que no sea nuestra UI puede dejar el registro cojo.

### 🟡 #6 — El técnico no ve su historial

[MisAsignaciones.jsx:23](frontend/src/pages/asignaciones/MisAsignaciones.jsx:23) filtra fuera
`finalizada` y `cancelada`, y no hay otra vista. Un técnico no puede consultar lo que hizo la
semana pasada ni las fotos que subió. Sólo admin/gestor lo ven, vía historial del vehículo.

### 🟡 #7 — `notas` no se puede vaciar

`UPDATE ... notas = COALESCE(?, notas)` con `notas !== undefined ? notas : null`
([asignaciones.controller.js:241](backend/src/controllers/asignaciones.controller.js:241)):
mandar `notas: null` para borrarlas no hace nada. Igual para `km_inicio`.

### 🟡 #8 — El listado no devuelve progreso

`GET /asignaciones` no incluye `progreso`, así que la tarjeta de "Mis asignaciones" no puede decir
"faltan 2 fotos de inicio" sin abrir el detalle. Es una llamada extra por tarjeta o un JOIN más.

### 🟡 #9 — Documentación y tests con huecos

- `docs/API.md` (303 líneas) **no menciona `/asignaciones`**. La superficie principal del producto
  no está documentada.
- `frontend/src/__tests__/component/pages/` está **vacío**: los dos wizards, que son el corazón del
  producto, no tienen ni un test de componente. Los servicios sí están cubiertos.

---

## 7. Qué hacer, por orden

**Bloque A — que no se rompa (antes de tocar nada más)**

1. Portar `migration_v2..v8` al runner `MIGRATIONS`; validar arranque contra MySQL en blanco. *(#1)*
2. Hacer idempotente el envío del wizard de inicio: no duplicar incidencia ni fotos `general`. *(#2)*
3. Sembrar los wizards con las evidencias ya subidas → flujo reanudable. *(#3)*

**Bloque B — completar lo que el cliente pidió**

4. Pedir `km_inicio` al técnico en la sección de mecánica, junto a la foto del cuadro. *(#4)*
5. Exigir `km_fin` también en el backend. *(#5)*
6. Vista "Historial" en Mis Asignaciones (pestaña o filtro de finalizadas). *(#6)*
7. **Checklist de revisión** con checks OK-por-defecto → desmarcar = incidencia → cuadro de
   observaciones. **Bloqueado**: falta que el cliente liste los puntos concretos.
   El esquema previsto ya está diseñado (`asignacion_revision_items`, `punto` como texto libre),
   así que la BD no bloquea; bloquea el frontend.
8. Banner persistente de "servicio en curso" mientras `estado='activa'`.

**Bloque C — higiene**

9. Documentar `/asignaciones` en `docs/API.md`.
10. Tests de componente de los dos wizards (navegación entre secciones, gating, reintento).
11. Arreglar `notas`/`km_inicio` no vaciables. *(#7)*
12. Añadir `progreso` al listado. *(#8)*

**Preguntas abiertas para el cliente**

- ¿Cuáles son exactamente los puntos del checklist de revisión? *(bloquea el punto 7)*
- ¿Qué secciones extra quiere en el wizard (material sanitario, etc.)? La arquitectura de
  `SECCIONES` ya está preparada: añadir una sección es añadir una entrada al array.

---

## 8. Cómo verificar y desplegar

```bash
cd backend && npx jest --silent
```

```bash
cd frontend && npx vitest run
```

Estado a fecha de corte: **263/263 backend, 135/135 frontend en verde**. Los rastros de
`useAuth debe usarse dentro de <AuthProvider>` en la salida de vitest son de un test que provoca
el error a propósito; no son fallos.

**Despliegue** (automático al hacer push a `master`):

- `backend/**` o `docker-compose.yml` → `deploy-backend.yml` → SSH a Hetzner, `docker compose build backend`,
  `up -d --no-deps backend`, health check. **MySQL no se toca nunca**: por eso el esquema sólo se
  actualiza a través del runner de migraciones al arrancar.
- `frontend/**` → `deploy-frontend.yml` → build + subida a cPanel.

---

## 9. Reglas de oro de este repo

1. **Una migración nueva no existe hasta que está en `MIGRATIONS`.** El `.sql` en `/database` es
   documentación; el deploy no ejecuta ficheros sueltos.
2. **No renombrar migraciones ya desplegadas.** En concreto `v10_baseline_vehiculos`: reaplicarla
   pisaría los feature flags que el superadmin haya cambiado desde `/admin`.
3. **Gotcha de tests:** `clearAllMocks()` no drena la cola de `mockResolvedValueOnce`. Usar
   `query.mockReset()` entre tests que encolan respuestas.
4. Las fotos de `momento='general'` **se acumulan**; las de `inicio`/`fin` **se reemplazan**.
5. Trabajos está congelado: no invertir ahí, y no encender `menu_trabajos` sin decisión explícita.

---

## 10. ⛔ Aviso de seguridad pendiente (fuera del alcance funcional)

No afecta a asignaciones ni a vehículos, pero condiciona todo lo demás y no debería quedar
enterrado en este documento.

El repositorio es **público**. A fecha de hoy, en `master` (`acb1210`):

- `deploy_helper.py` — host, usuario `root` y **contraseña de root** del servidor de producción
  Hetzner, en claro.
- `test_api.mjs` — usuario y contraseña del admin y de un técnico de **producción**, en claro.
  La contraseña del admin era la misma cadena que la de root del servidor.

Existe una limpieza (commit `f88de9f`) en la rama `claude/optimistic-kapitsa-d50f67`, pero **está
sin mergear**: la rama por defecto del repo público sigue expuesta ahora mismo, no solo el
historial.

Limpiar el HEAD no basta — el historial es público y lleva meses indexado. Estas credenciales
deben considerarse comprometidas. Pendiente por parte del propietario del proyecto:

1. Llevar la limpieza a `master`.
2. Rotar la contraseña de root de Hetzner y las de los usuarios de la app.
3. SSH solo con clave (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`).
4. Rotar los secretos JWT y la contraseña de MySQL.
5. Revisar `audit_logs` y `auth.log` en busca de accesos anómalos.
