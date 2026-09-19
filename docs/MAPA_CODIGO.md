# Mapa del código

Índice de «dónde está cada cosa y cómo se conecta». Se consulta **antes** de
buscar en el repo y se actualiza **con cada cambio** que mueva, cree, borre o
reconecte algo (ver §11). Si algo de aquí no coincide con el código, manda el
código: corrige el mapa.

Última revisión completa: 2026-09-19.

---

## 1. Vista general

```
frontend (React+Vite PWA)  ──axios──>  backend (Express)  ──mysql2──>  MySQL 8
 vapss.net/app/                         api.vapss.net                   contenedor Docker
 pages → services → api.js              routes → middleware → controllers → query()
```

| Carpeta | Qué es |
|---|---|
| `backend/` | API Express (CommonJS). Entrada `server.js` |
| `frontend/` | SPA React 18 + Vite + Tailwind + PWA |
| `database/` | `schema.sql` (base), `seed.sql` (roles), `migration_v2..v16.sql` (referencia) |
| `docs/` | Documentación (§10) |
| `.github/workflows/` | CI/CD (§9) |
| `.claude/` | Comandos `/local`, `/verifica`, `/a-pro` y agente `probador-local` |
| `scripts/deploy.sh`, `docker-compose*.yml` | Despliegue y entorno local |

Dominio: **vehículos** (ambulancias) + **asignaciones libres** (un usuario
responsable usa un vehículo entre dos fechas; evidencia fotográfica al inicio y
al fin). **Trabajos** (vehículo(s)+usuarios para un servicio) existe pero está
oculto por feature flags (§7).

---

## 2. Backend

### 2.1 Cadena de una petición

`server.js` → helmet/cors/compress/morgan/json → `/uploads` estático →
`routes/index.js` (aplica `apiLimiter`, monta `/auth /users /vehicles /trabajos
/asignaciones /admin /features`) → `routes/*.routes.js` (middleware por ruta) →
`controllers/*.controller.js` → `config/database.js` (`query`) → MySQL.
Errores: `middleware/error.middleware.js` (5xx van a `error_logs`).
`/health` en `server.js` devuelve `commit` (`GIT_COMMIT`) y `appEnv`.

`server.js` además: espera la BD con reintentos, corre `config/migrations.js` al
arrancar, y lanza el cron `autoActivar` (al arrancar y cada 60 s): pasa a
`activo`/`activa` los trabajos/asignaciones programados cuya `fecha_inicio` ya
llegó.

### 2.2 Rutas → controlador (prefijo `/api`)

| Grupo | Fichero rutas | Controlador | Endpoints |
|---|---|---|---|
| `/auth` | `auth.routes.js` | `auth.controller.js` | POST login · POST refresh · POST logout · GET me |
| `/users` | `users.routes.js` | `users.controller.js` | GET/POST `/roles` · GET `/` · GET/PUT/DELETE `/:id` · POST `/` · POST `/:id/reset-password` |
| `/vehicles` | `vehicles.routes.js` | `vehicles.controller.js` | CRUD `/` `/:id` (GET `/:id` añade `asignaciones: {total, activa}`) · GET `/alertas` · GET `/tarjeta-transporte/proximas` · GET/POST `/:id/images` · GET `/:id/historial` · incidencias `/:id/incidencias` (+PATCH `/:vehicleId/incidencias/:incId`, POST `.../comentarios`) · revisiones `/:id/revisiones` (+PUT/DELETE `/:vehicleId/revisiones/:revId`) |
| `/asignaciones` | `asignaciones.routes.js` | `asignaciones.controller.js` | GET `/` · GET/PUT/DELETE `/:id` · POST `/` · POST `/:id/activar` · POST `/:id/finalizar` · POST `/:id/incidencias` · POST `/:id/evidencias` |
| `/trabajos` | `trabajos.routes.js` | `trabajos.controller.js` | GET `/mis-trabajos` · GET `/calendario` · GET `/` · CRUD `/:id` · POST `/:id/activar` · POST `/:id/finalize` · POST `/:id/evidencias` |
| `/admin` | `admin.routes.js` | `admin.controller.js` | GET `/stats` · GET `/audit` · GET `/audit/users` · GET `/errors` (solo superadmin) |
| `/features` | `features.routes.js` | `features.controller.js` | GET `/active` (todos) · GET `/` y PUT `/:key` (superadmin) |

Funciones internas útiles: `asignaciones.controller` → `getProgreso`,
`getAsignacionCompleta`, `crearIncidenciaDesdeAsignacion`;
`vehicles.controller` → `canOperacionalAccess`, `getVehicleHistorial` (mezcla
trabajos + asignaciones), `fetchComentarios`; `trabajos.controller` →
`generateIdentificador`, `getTrabajoCompleto`.

### 2.3 Middleware (`backend/src/middleware/`)

| Fichero | Aporta | Notas |
|---|---|---|
| `auth.middleware.js` | `authenticate` | Verifica JWT y **consulta permisos en BD en cada request** (no van en el token) |
| `roles.middleware.js` | `requireRole`, `requirePermission`, `requireSuperAdmin`, `requireAdmin`, `requireAdminOrGestor`, `requireAnyRole`, `hasRole`, `hasPermission`, `isSuperAdmin/isAdmin/isOperacional` | superadmin bypassa todo; 403 se audita como `access_denied` |
| `ownership.middleware.js` | `tieneElVehiculoAsignado`, `requireVehicleUploadAccess`, `requireTrabajoEvidenciaAccess` | Quién puede subir fotos a qué |
| `upload.middleware.js` | Multer (memoria) + Sharp | Límites en `constants.UPLOAD` |
| `rateLimiter.middleware.js` | `apiLimiter`, login, `uploadLimiter` | Límite **por usuario**, no por IP |
| `validate.middleware.js` | wrapper de express-validator | |
| `error.middleware.js` | `notFound`, `errorHandler` | 5xx → `error_logs` |

### 2.4 Utils y config

| Fichero | Contenido |
|---|---|
| `config/constants.js` | `ROLES`, estados/tipos de trabajo, `IMAGEN_TIPOS*` (inicio/fin/general), `UPLOAD`, `PAGINATION`, `LOCKOUT`. **Espejo de** `frontend/src/utils/constants.js` |
| `config/database.js` | Pool mysql2, `query`, transacciones; sesión en UTC |
| `config/migrations.js` | Runner al arrancar. **Cada cambio de esquema se registra aquí** (§5) |
| `utils/fecha.utils.js` | Contrato de fechas: UTC en BD, hora española de cara al usuario. Nunca `NOW()`/`CURDATE()`. También sella `vehicle_images.created_at` al subir y al **rehacer** una foto |
| `utils/jwt.utils.js` · `password.utils.js` (política de contraseña) · `response.utils.js` (`success`, errores) · `logger.utils.js` (winston) · `matricula.utils.js` |
| `scripts/` | `create-admin`, `create-user`, `reset-password`, `setup-db`, `seed-local` |

Tests backend: `backend/src/__tests__/unit/{config,controllers,middleware,utils}`
(un `*.test.js` por fichero; espejo de la estructura). Helpers en
`__tests__/helpers/`. Gotcha: `clearAllMocks` no drena `mockResolvedValueOnce`,
usar `query.mockReset()`. `config/database.test.js` fija el contrato de fechas
(pool y sesión en UTC) y para eso hace `jest.unmock` del módulo, que `setup.js`
mockea para todos los demás.

---

## 3. Frontend

### 3.1 Arranque

`main.jsx` → `App.jsx` (providers: Auth, Notification, Features; `BrowserRouter`
con `basename` = `BASE_URL`) → `Layout` (Navbar + Sidebar + Toast +
InstallPWAButton + VehicleExpirationAlerts) → páginas. `SWUpdater` gestiona la
auto-actualización de la PWA. Config en `vite.config.js` (`VITE_BASE_PATH`,
`VITE_APP_ENV`, proxy de dev a `:3001`, plugin PWA).

### 3.2 Rutas (`App.jsx`) → página

| Ruta | Página | Roles | Feature flag |
|---|---|---|---|
| `/login` | `pages/Login.jsx` | público | — |
| `/` | redirige a `/mis-asignaciones` | | |
| `/mis-asignaciones` | `asignaciones/MisAsignaciones.jsx` | cualquiera | `menu_mis_asignaciones` |
| `/asignaciones` | `asignaciones/AsignacionList.jsx` | admin, gestor, super | `menu_asignaciones` |
| `/vehiculos` | `vehicles/VehicleList.jsx` | admin, gestor, super | `menu_vehiculos` |
| `/vehiculos/:id` y `/vehiculos/:id/historial` | `vehicles/VehicleHistory.jsx` (**el mismo componente**, con pestañas; desde el listado se llega pinchando la fila entera) | ídem | `menu_vehiculos` |
| `/usuarios` | `users/UserList.jsx` | admin, gestor, super | `menu_usuarios` |
| `/alertas` | `AlertsPage.jsx` | admin, super | `menu_alertas` |
| `/admin` | `AdminPanel.jsx` | solo super | — |
| `/dashboard` | `Dashboard.jsx` | admin, gestor, super | `menu_dashboard` (off) |
| `/mis-trabajos` | `MisTrabajos.jsx` | ídem | `menu_mis_trabajos` (off) |
| `/trabajos`, `/trabajos/:id` | `trabajos/TrabajoList.jsx`, `TrabajoDetail.jsx` | ídem | `menu_trabajos` (off) |

Guardia: `components/common/ProtectedRoute.jsx` (`allowedRoles`,
`requiredFeature`). Menú: `components/Layout/Sidebar.jsx` (usa
`AuthContext` + `FeaturesContext`).

### 3.3 Página → servicios que usa → endpoint

| Página / componente | Servicio (`frontend/src/services/`) | Backend |
|---|---|---|
| `MisAsignaciones`, `AsignacionList`, `AsignacionDetalle`, `AsignacionForm` | `asignaciones.service` (+ `vehicles`, `users` para selectores) | `/asignaciones` |
| `InicioAsignacion`, `FinalizacionAsignacion` (fotos con `CameraCapture`) | `asignaciones.service` → `activar`, `finalizar`, `uploadEvidencia` | `/asignaciones/:id/{activar,finalizar,evidencias}` |
| `AsignacionDetalle` → registrar incidencia | `asignaciones.service.crearIncidencia` | `POST /asignaciones/:id/incidencias` |
| `VehicleList`, `VehicleForm` | `vehicles.service` | `/vehicles` |
| `VehicleHistory` (+ `ComentariosIncidencia`) | `vehicles.service` → `get`, `getHistory`, `update` (edición en línea del Resumen), incidencias, revisiones, imágenes | `/vehicles/:id/*` |
| `AlertsPage`, `VehicleExpirationAlerts` | `vehicles.service.listAlertas / listTarjetaTransporteProximas` + `utils/vehicleAlerts.js` | `/vehicles/alertas`, `/vehicles/tarjeta-transporte/proximas` |
| `UserList`, `UserForm`, `ResetPasswordModal` | `users.service` | `/users` |
| `AdminPanel` | `admin.service` + `features.service` | `/admin/*`, `/features` |
| `Login`, `AuthContext` | `auth.service` | `/auth/*` |
| `FeaturesContext` | `features.service.getActive` | `GET /features/active` |
| `TrabajoList/Detail/Form`, `MisTrabajos`, `InicioTrabajo`, `Finalizacion`, `CalendarioTrab` | `trabajos.service` | `/trabajos` |

`services/api.js`: instancia axios, adjunta el token, refresca en 401 y
reintenta. Todos los servicios cuelgan de ella.

### 3.4 Utils, contextos, hooks

| Fichero | Contenido |
|---|---|
| `utils/constants.js` | `ROLES`, `PERMISSIONS`, estados/colores/etiquetas, definición de cada tipo de foto (`IMAGEN_TIPOS_INICIO/FIN/GENERAL`, labels, instrucciones). **Espejo de** `backend/src/config/constants.js` |
| `utils/dateUtils.js` | Formato/zonas: `formatDateTime`, `formatDateTimeShort`, `formatHora`, `toUtcIso`, `toInputDatetime`, `diaEnEspana`, `formatFechaSola`… |
| `utils/vehicleAlerts.js` | Umbrales 60/45/30/15 días, ITV/ITS, descartes en `sessionStorage` |
| `utils/sessionStorage.js` | Almacenamiento con prefijo `vapss:<env>:` |
| `utils/imageCompress.js`, `imageUtils.js`, `matricula.js` | Compresión previa a subir, URL de imagen, normalización de matrícula |
| `context/AuthContext.jsx` | `useAuth`: usuario, roles, `hasPermission` |
| `context/FeaturesContext.jsx` | `useFeatures`: flags activos |
| `context/NotificationContext.jsx` | `useNotification`: toasts |
| `hooks/useDebounce.js`, `usePWAInstall.js` | |
| `components/camera/` | `CameraCapture` (orden forzado de fotos) + `PhotoSilhouette` + `useCameraStream` |
| `components/common/` | `Modal`, `ConfirmDialog`, `StatusBadge`, `LoadingSpinner`, `Toast`, `InstallPWAButton`, `SWUpdater`, `ProtectedRoute`, `ComentariosIncidencia`, `VehicleExpirationAlerts` |
| `index.css`, `tailwind.config.js` | Estilos. Tailwind **purga** `@layer components` no usadas en `src` |

Tests frontend: `frontend/src/__tests__/{unit,component}` (servicios, utils,
contextos, hooks, `VehicleHistory`). Vitest.

---

## 4. Base de datos

Tablas (dónde se crean): `schema.sql` → `users, roles, user_roles,
login_attempts, refresh_tokens, vehicles, trabajos, trabajo_vehiculos,
trabajo_usuarios, vehicle_images` + vistas `v_users_roles`, `v_trabajos_activos`
+ eventos de limpieza. Migraciones → `vehicle_revisiones`,
`vehicle_incidencias` (v2), `audit_logs`, `error_logs` (v3), `permissions`,
`role_permissions` (v4), `asignaciones_libres` (v6), `app_features` (v9),
`incidencia_comentarios` (v13), `schema_migrations` (control).

Relaciones clave:

```
users ─N:M─ roles (user_roles) ─N:M─ permissions (role_permissions)
vehicles 1─N asignaciones_libres (user_id = responsable, created_by = admin)
vehicles 1─N vehicle_images (asignacion_id | trabajo_id, tipo_imagen, momento inicio/fin/general)
vehicles 1─N vehicle_incidencias (trabajo_id?, reported_by) 1─N incidencia_comentarios
vehicles 1─N vehicle_revisiones
trabajos N:M vehicles (trabajo_vehiculos) · trabajos N:M users (trabajo_usuarios)
```

Estados: asignación `programada → activa → finalizada | cancelada`; trabajo
`programado → activo → finalizado | finalizado_anticipado`; incidencia
`pendiente → en_revision → resuelto`. Borrado lógico con `deleted_at`.
`vehicles.alias` es el titular visible; `matricula` es única.

**Ojo:** `schema.sql` está desincronizado (le faltan `asignaciones_libres` y
otras). La fuente real es `schema.sql` + `migrations.js`.

---

## 5. Cómo se añade un cambio de esquema

1. Añadir el bloque `vN_nombre` al array `MIGRATIONS` de
   `backend/src/config/migrations.js` (idempotente: `IF NOT EXISTS`,
   `ensureColumn`). **Sin registrarlo ahí, el `.sql` de `/database` no se
   ejecuta.**
2. Opcional: dejar copia en `database/migration_vN.sql`.
3. Test en `backend/src/__tests__/unit/config/migrations.test.js`.
4. Probar desde cero con `/verifica` (BD local vacía).

Última migración: **v16_horas_a_utc**.

---

## 6. Roles y permisos

Roles: `superadmin > administrador > gestor > tecnico / enfermero / medico`
(tabla `user_roles`, N:M). Permisos en BD (`permissions`, `role_permissions`):
`manage_vehicles, manage_users, manage_trabajos, view_all_trabajos,
manage_incidencias, access_admin`. Backend: `requirePermission(...)` /
`requireRole`. Frontend: `hasPermission(...)` y `allowedRoles` en
`ProtectedRoute`. El usuario normal queda acotado a **Mis Asignaciones**.

**Los roles no son excluyentes.** Un administrador o un gestor pueden llevar
además `tecnico` porque también salen de servicio. Por eso `isOperacional()`
(back y front) significa «personal de campo **sin mando**» y devuelve `false`
en cuanto hay un rol de gestión: es el predicado que *recorta* lo que se ve
(flota y trabajos), y ese recorte dejaba al administrador sin un solo vehículo
que asignar. Para preguntar por el rol a secas, `hasRole(user, ROLES.TECNICO)`.

## 7. Feature flags

Tabla `app_features` (v9), gestionada desde `/admin` por superadmin.
Backend: `features.controller.js`. Frontend: `FeaturesContext` +
`requiredFeature` en `ProtectedRoute` + `Sidebar`. Claves: `menu_dashboard`,
`menu_mis_trabajos`, `menu_trabajos` (apagadas: línea base «solo vehículos»);
`menu_mis_asignaciones`, `menu_asignaciones`, `menu_vehiculos`,
`menu_usuarios`, `menu_alertas` (encendidas).

## 8. Flujos transversales (qué tocar si cambias…)

| Si cambias… | Toca |
|---|---|
| Un tipo de foto obligatoria | `backend/config/constants.js` **y** `frontend/utils/constants.js`; `CameraCapture`; `asignaciones.controller` (`getProgreso`, `finalizarAsignacion`); posiblemente ENUM `vehicle_images.tipo_imagen` (migración) |
| Un campo de asignación | migración → `asignaciones.controller` (`getAsignacionCompleta`, create/update) → `asignaciones.routes` (validadores) → `AsignacionForm`/`AsignacionDetalle` → tests |
| Un campo de vehículo | migración → `vehicles.controller` → `vehicles.routes` (validadores) → **dos formularios**: `VehicleForm` (modal del listado) y la edición en línea del Resumen en `VehicleHistory` (`CAMPOS_FICHA` + `formDesdeVehiculo`, que deciden si hay cambios sin guardar; el km en blanco **se omite del payload**, mandarlo como 0 borraba el cuentakilómetros) → `VehicleList` → `vehicleAlerts.js` si es fecha de caducidad |
| Incidencias / comentarios | `vehicles.controller` (`createIncidencia`, `addIncidenciaComentario`, `updateIncidencia`) + `asignaciones.controller.crearIncidenciaDesdeAsignacion` → `ComentariosIncidencia`, `VehicleHistory`, `AsignacionDetalle` |
| Historial del vehículo | `vehicles.controller.getVehicleHistorial` → `VehicleHistory` (+ test `VehicleHistory.test.jsx`) |
| El aviso de «cambios sin guardar» | `VehicleHistory`: cubre las pestañas, «Volver» y `beforeunload` (recarga/cierre). **No** cubre el menú lateral ni el botón atrás: haría falta `useBlocker`, y eso pide migrar a `createBrowserRouter` |
| La hora de una foto de evidencia | La pone `ahora()` al subir/rehacer en `asignaciones.controller`, `trabajos.controller` y `vehicles.controller`; se pinta en `AsignacionDetalle` (tanda + hora por miniatura), `VehicleHistory` (día+hora y badge de momento) y `TrabajoDetail` |
| Alertas de caducidad | `vehicles.controller.listAlertasVehiculos` + `utils/vehicleAlerts.js` → `AlertsPage`, `VehicleExpirationAlerts` |
| Permisos de un endpoint | `routes/*.routes.js` (middleware) + tabla `role_permissions` + `ownership.middleware` si depende de asignación |
| Menú / nueva pantalla | `App.jsx` (ruta + `requiredFeature`) + `Sidebar.jsx` + feature en `migrations.js` |
| Fechas/horas | `fecha.utils.js` (back) y `dateUtils.js` (front); nunca `NOW()` en SQL |
| Auditoría | `audit_logs` vía el helper que usan los controladores; visible en `AdminPanel` |
| Login / sesión | `auth.controller`, `jwt.utils`, `password.utils`, `rateLimiter`, `AuthContext`, `services/api.js` |
| Cron de activación | `server.js` (`autoActivar`) |

## 9. Entornos y despliegue

`develop → PRE`, `master → PRODUCCIÓN`. Workflows:
`.github/workflows/deploy-backend.yml` (empaqueta `backend database
docker-compose.yml`, sube por SSH a Hetzner, `docker compose`, comprueba
`/health`) y `deploy-frontend.yml` (tests + build + subida al hosting de
`vapss.net/app[-pre]/`). Local: `docker-compose.local.yml` (MySQL en **3307**),
`npm run local:db`, `seed:local`, y los comandos `/local`, `/verifica`,
`/a-pro`. Detalle en `docs/ENTORNOS.md` y `docs/LOCAL.md`.

## 10. Documentación existente

| Doc | Para qué |
|---|---|
| `docs/MAPA_CODIGO.md` | Este fichero |
| `docs/ESTADO_PROYECTO.md` | Alcance actual y problemas conocidos |
| `docs/PLAN_TRABAJO.md` | Plan por bloques con verificación |
| `docs/ENTORNOS.md`, `docs/LOCAL.md` | Despliegue y entorno local |
| `docs/FLUJO_SERVICIO.md` | Rediseño inicio → jornada → cierre |
| `docs/API.md`, `docs/README.md`, `docs/DEPLOY.md` | Legado; `DEPLOY.md` está obsoleto (nginx+PM2) |
| `docs/AUDITORIA_SEGURIDAD.md` | Informe de seguridad (no se commitea, repo público) |
| `docs/rediseno/estilo-v2.html` | Mockup del diseño v2 |

## 11. Mantenimiento de este mapa

Actualizar **en el mismo commit** que el cambio cuando se: añada/borre/mueva un
fichero relevante; añada un endpoint, ruta de frontend, tabla, migración,
feature flag, permiso o rol; cambie qué servicio usa una página; o cambie un
flujo de §8. Al final de cada tarea, repasar las secciones afectadas y la fecha
de «última revisión».
