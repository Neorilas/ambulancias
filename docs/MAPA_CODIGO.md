# Mapa del código

> **Este fichero se lee ANTES de tocar nada y se actualiza DESPUÉS.**
> Todo cambio de lógica o de funcionalidad tiene que quedar reflejado aquí
> en el mismo commit que lo introduce. Un mapa desactualizado es peor que no
> tenerlo: manda a buscar al sitio equivocado y se confunde con la verdad.
> La regla, en `docs/README.md` y en `CLAUDE.md`.

Índice de «dónde está cada cosa y cómo se conecta». Se consulta **antes** de
buscar en el repo y se actualiza **con cada cambio** que mueva, cree, borre o
reconecte algo (ver §11). Si algo de aquí no coincide con el código, manda el
código: corrige el mapa.

Última revisión completa: 2026-09-20.

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

Dominio: **vehículos** (ambulancias) + **asignaciones libres** (1..N
responsables usan un vehículo entre dos fechas, con 0..N personal que va con
ellos; evidencia fotográfica al inicio y al fin). **Trabajos** (vehículo(s)+usuarios para un servicio) existe pero está
oculto por feature flags (§7).

---

## 2. Backend

### 2.1 Cadena de una petición

`server.js` → helmet/cors/compress/morgan/json → `/uploads` estático →
`routes/index.js` (aplica `apiLimiter`, monta `/auth /users /vehicles /trabajos
/asignaciones /admin /features /push /flota`) → `routes/*.routes.js` (middleware por ruta) →
`controllers/*.controller.js` → `config/database.js` (`query`) → MySQL.
Errores: `middleware/error.middleware.js` (5xx van a `error_logs`).
`/health` en `server.js` devuelve `commit` (`GIT_COMMIT`) y `appEnv`.

`server.js` además: espera la BD con reintentos, corre `config/migrations.js` al
arrancar, y lanza el cron `autoActivar` (al arrancar y cada 60 s): pasa a
`activo`/`activa` los trabajos/asignaciones programados cuya `fecha_inicio` ya
llegó. Los trabajos van de un `UPDATE` masivo; **las asignaciones no**: se
seleccionan primero y se actualizan una a una con el guard `estado =
'programada'`, porque de cada una hay que mandar un aviso push y hace falta
saber cuáles ha cambiado de verdad (§2.5).

### 2.2 Rutas → controlador (prefijo `/api/v1`)

El prefijo real es `/api/${API_VERSION || 'v1'}` (`server.js`), y el
frontend lo fija en `services/api.js` (`VITE_API_URL || '/api/v1'`). Las
tablas de abajo listan la ruta **sin** ese prefijo.

| Grupo | Fichero rutas | Controlador | Endpoints |
|---|---|---|---|
| `/auth` | `auth.routes.js` | `auth.controller.js` | POST login · POST refresh · POST logout · GET me |
| `/users` | `users.routes.js` | `users.controller.js` | GET/POST `/roles` · GET `/` · GET/PUT/DELETE `/:id` · POST `/` · POST `/:id/reset-password` |
| `/vehicles` | `vehicles.routes.js` | `vehicles.controller.js` | CRUD `/` `/:id` (GET `/:id` añade `asignaciones: {total, activa}`) · GET `/alertas` · GET `/tarjeta-transporte/proximas` · GET/POST `/:id/images` · GET `/:id/historial` · incidencias `/:id/incidencias` (+PATCH `/:vehicleId/incidencias/:incId`, POST `.../comentarios`) · revisiones `/:id/revisiones` (+PUT/DELETE `/:vehicleId/revisiones/:revId`) |
| `/asignaciones` | `asignaciones.routes.js` | `asignaciones.controller.js` | GET `/` · GET/PUT/DELETE `/:id` · POST `/` · POST `/:id/activar` · POST `/:id/finalizar` · POST `/:id/incidencias` · POST `/:id/evidencias` |
| `/trabajos` | `trabajos.routes.js` | `trabajos.controller.js` | GET `/mis-trabajos` · GET `/calendario` · GET `/` · CRUD `/:id` · POST `/:id/activar` · POST `/:id/finalize` · POST `/:id/evidencias` |
| `/admin` | `admin.routes.js` | `admin.controller.js` | GET `/stats` · GET `/audit` · GET `/audit/users` · GET `/errors` (solo superadmin) |
| `/features` | `features.routes.js` | `features.controller.js` | GET `/active` (todos) · GET `/` y PUT `/:key` (superadmin) |
| `/push` | `push.routes.js` | `push.controller.js` | GET `/vapid-public-key` · GET `/estado` · POST/DELETE `/subscribe` · POST `/test`. Todo el grupo exige `MANAGE_TRABAJOS` |
| `/flota` | `flota.routes.js` | `flota.controller.js` | GET `/ubicaciones` (mapa de flota). **Superadmin siempre; administradores solo con el flag `menu_flota`** (§2.6) |

Funciones internas útiles: `asignaciones.controller` → `getProgreso`,
`getAsignacionCompleta` (devuelve `responsables[]` y `personal[]`),
`rolEnAsignacion` (la regla de acceso de §6.1), `leerMiembros` (lee el body en
formato nuevo o viejo), `guardarMiembros`, `buscarSolapes`,
`crearIncidenciaDesdeAsignacion`, `ORDEN_LISTADO` (el `ORDER BY` del listado,
§8);
`vehicles.controller` → `canOperacionalAccess`, `getVehicleHistorial` (mezcla
trabajos + asignaciones), `fetchComentarios`; `trabajos.controller` →
`generateIdentificador`, `getTrabajoCompleto`.

### 2.3 Middleware (`backend/src/middleware/`)

| Fichero | Aporta | Notas |
|---|---|---|
| `auth.middleware.js` | `authenticate` | Verifica JWT y **consulta permisos en BD en cada request** (no van en el token) |
| `roles.middleware.js` | `requireRole`, `requirePermission`, `requireSuperAdmin`, `requireAdmin`, `requireAdminOrGestor`, `requireAnyRole`, `hasRole`, `hasPermission`, `isSuperAdmin/isAdmin/isOperacional` | superadmin bypassa todo; 403 se audita como `access_denied` |
| `ownership.middleware.js` | `tieneElVehiculoAsignado`, `requireVehicleUploadAccess`, `requireTrabajoEvidenciaAccess`, `requireAsignacionEvidenciaAccess` | Quién puede subir fotos a qué. En asignaciones solo cuentan los **responsables**, nunca el personal. Van antes de `processAndSave`: un 403 no deja la foto huérfana en disco |
| `upload.middleware.js` | Multer (memoria) + Sharp | Límites en `constants.UPLOAD` |
| `rateLimiter.middleware.js` | `apiLimiter`, login, `uploadLimiter`, `pushLimiter` | Límite **por usuario**, no por IP |
| `features.middleware.js` | `requireFeature(key)`, `featureActiva(key)` | Feature flags como control de acceso REAL, no solo como menú. superadmin bypassa; un fallo de BD **deniega**; el 403 se audita como `access_denied` |
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
| `services/push.service.js` | Web Push (VAPID). Localiza a los admins, envía, borra la suscripción caducada (404/410). **Nunca lanza**: devuelve un resumen |
| `services/avisosAsignacion.service.js` | Los textos y tags de los avisos de una asignación. Lo usan el cron y el controlador, para que digan lo mismo |
| `services/vigilancia.service.js` | Los avisos que no dispara nadie: el cron mira el reloj y avisa de lo que NO ha pasado. Hoy solo `revisarAsignacionesSinIniciar` |
| `services/cartrack.service.js` | Posiciones del GPS de la flota (API de Cartrack). Caché compartida, **nunca lanza** (§2.6) |
| `utils/flota.utils.js` | El cruce GPS ↔ nuestros vehículos y el estado de cada uno (§2.6) |
| `scripts/` | `create-admin`, `create-user`, `reset-password`, `setup-db`, `seed-local`, `sonda-cartrack` (§2.6) |

### 2.5 Avisos push (Web Push / VAPID)

Para que el teléfono de quien gestiona la flota suene cuando pasa algo en una
asignación. Sin app nativa ni Firebase.

| Pieza | Dónde |
|---|---|
| Claves VAPID | Solo en el entorno (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). **Nunca en el repo, que es público.** Se pasan en `docker-compose.yml` desde el `.env` del servidor; `.env.example` las documenta. Vacías = push apagado y el resto de la app igual |
| Suscripciones | Tabla `push_subscriptions` (v17): **una fila por navegador**, no por usuario. `endpoint` es único |
| Destinatarios | Se calculan en CADA envío: permiso `manage_trabajos` o rol `administrador`/`superadmin`, usuario activo. El responsable de la asignación se excluye |
| Eventos | Asignación activada (cron o botón) · fotos de inicio completas · **asignación sin iniciar 30 min después de su hora** · asignación finalizada (vale también por «fotos de fin», que no se manda aparte) |
| Aviso de «sin iniciar» | El único que no lo dispara una petición sino el reloj: `vigilancia.service.js`, en el tick del cron. **Iniciada = `inicio_real_at`**, o sea el botón «Inicio de servicio»; el `estado` no sirve para esto, porque el cron pone en `activa` todo lo que llega a su hora y una activa con `inicio_real_at` a NULL es precisamente la que hay que vigilar: arrancó sola y nadie ha entrado. El umbral es `AVISO_SIN_INICIAR_MINUTOS` (30 por defecto; bajarlo por entorno es la forma de probarlo sin esperar media hora). Se manda **una vez por asignación**: el candado es la columna `aviso_sin_iniciar_at` (v19, renombrada desde la `aviso_fotos_pendientes_at` de la v18) |
| Service worker | `frontend/src/sw.js` (handlers `push` y `notificationclick`) |
| Entrega | Todo envío va con `urgency: 'high'` y `TTL` de 1 h. Con la urgencia `normal` que pone `web-push` por defecto, Android APARCA el aviso mientras el móvil está en reposo (Doze) y lo suelta en la siguiente ventana de mantenimiento: es el «el primero llegó y los demás no» |
| «Solo llegan al abrir la app» (Android) | **No es código**: el aviso sale bien del servidor y FCM lo acepta, pero en Android quien lo recibe y ejecuta `sw.js` es **Chrome**, no la WebAPK de VAPSS, que es solo un envoltorio. Si el sistema tiene a Chrome restringido de batería, en suspensión (Samsung), sin inicio automático (Xiaomi/Huawei) o detenido por haberlo deslizado de recientes, FCM no le entrega nada y todo lo pendiente cae de golpe al abrir la app (abrirla arranca Chrome). Quitar la restricción solo a VAPSS no sirve. Las instrucciones están en `AjustesAndroid` |
| `topic` | Derivado del tag (`normalizarTopic`, 32 caracteres base64url). Sustituye el aviso del mismo suceso que siga sin entregar, en vez de encolarlo detrás |
| Volumen y tono | **No se pueden fijar desde el código.** En Android los decide el canal de notificaciones del sistema y una web no puede crear canales. Con la PWA instalada (WebAPK) la app tiene su propia entrada en los ajustes del teléfono y ahí sí se elige tono e importancia. Las instrucciones están en la UI, en `AvisosPush` → `AjustesDelTelefono`, que enseña las de Android o las de iPhone según `esIOS()` porque los dos sistemas no dan las mismas palancas |
| iPhone | iOS 16.4+ y **solo con la PWA en la pantalla de inicio**. No hay tono propio para ninguna app web ni avisos «urgentes». Lo que sí importa tocar: quitar VAPSS del **Resumen programado** (retiene y agrupa) y de los modos de concentración. Volumen = el del timbre |
| Alta/baja | Sección «Avisos en este dispositivo» del perfil (`components/common/AvisosPush.jsx`) |

El aviso de prueba lleva **tag fijo** (`test-<userId>`), no uno por envío: con
un tag distinto cada vez las pruebas se apilan en la bandeja y Android deja de
alertar de las siguientes del montón.

**Qué NO debe volver a sonar** (es lo que más fácil se rompe): un segundo
`POST /:id/activar` sobre algo ya activo, una foto de inicio rehecha con la
tanda ya completa, y una asignación que el cron intenta activar justo después
de que el responsable pulsara el botón. El aviso de «sin iniciar» es el más
expuesto de todos, porque el cron vuelve a mirar cada minuto: sin la marca en
BD sonaría sesenta veces por hora. Por eso las condiciones que lo evitan —que
no se haya avisado ya y que siga sin iniciarse— van **dentro del UPDATE** que
reclama la fila, no solo en el SELECT que la eligió: en el hueco entre uno y
otro cabe el botón que el responsable está pulsando en ese momento.

Tests backend: `backend/src/__tests__/unit/{config,controllers,middleware,services,utils}`
(un `*.test.js` por fichero; espejo de la estructura). Helpers en
`__tests__/helpers/`. Gotcha: `clearAllMocks` no drena `mockResolvedValueOnce`,
usar `query.mockReset()`. Otro gotcha, en `push.service.test.js`:
`jest.resetModules()` (necesario porque el módulo lee las claves VAPID al
importarse) **rehace también los mocks** de `config/database` y `web-push`, así
que hay que recapturarlos tras cada carga o las aserciones miran a un espía
huérfano. `config/database.test.js` fija el contrato de fechas
(pool y sesión en UTC) y para eso hace `jest.unmock` del módulo, que `setup.js`
mockea para todos los demás.

**Umbrales de cobertura** (`jest.config.js`): 85 % sentencias/líneas/funciones
y 80 % ramas, globales. Fallar el umbral **rompe el build**, así que un fichero
nuevo sin tests no se cuela. Quedan fuera del cómputo `routes/`, `logger.utils`
y `config/database`. Los tests de `vehicles.controller.listAlertasVehiculos`
congelan el reloj (`jest.setSystemTime`): el cálculo es de calendario y sin
fecha fija el resultado cambiaría cada día.

Como el umbral es **global**, un fichero grande sin tests puede tumbar el build
aunque no se haya tocado nada más: los porcentajes de todos los demás no lo
compensan. Si al añadir un servicio nuevo la cobertura cae de golpe, mirar
primero qué fichero entró, no qué test se rompió.


### 2.6 Mapa de flota (Cartrack)

Dónde está cada ambulancia según el GPS que llevan puesto, cruzado con lo que
el GPS no sabe: el alias, la ficha y quién la lleva hoy.

| Pieza | Dónde |
|---|---|
| Credenciales | `CARTRACK_USER` / `CARTRACK_KEY`, **solo en el entorno**. Nunca en el repo, que es público. Se pasan en `docker-compose.yml` desde el `.env` del servidor; `.env.example` las documenta. Vacías = mapa apagado y el resto de la app igual. Es una cuenta de **usuario estándar**, no de administrador: lo recomienda la propia documentación de Cartrack para integraciones |
| Región | `CARTRACK_BASE_URL`, por defecto `https://fleetapi-es.cartrack.com/rest`. **Con la URL de otro país las credenciales buenas dan 401**: es lo primero que mirar ante un 401 |
| Servicio | `services/cartrack.service.js`. Igual que `push.service`, **nunca lanza**: devuelve un resumen con `origen` (`api`/`cache`/`cache-vieja`/`ninguno`) y `error` |
| Cruce | `utils/flota.utils.js` → `cruzarFlota`. Por **matrícula normalizada** |
| Endpoint | `GET /api/v1/flota/ubicaciones`. Devuelve `{flota, resumen, fuente, minutosSinSenal}` |
| Quién lo ve | Superadmin siempre. Administradores **solo si `menu_flota` está encendido** en `/admin`. Gestores y personal de campo, nunca |
| Pantalla | `/flota` → `pages/flota/MapaFlota.jsx` + `components/flota/MapaLeaflet.jsx` |
| Sin tabla propia | **No se guarda ninguna posición.** Un rastro de dónde ha estado cada trabajador no es un dato cualquiera; si algún día hace falta histórico, es una decisión aparte con su migración y su política de retención |

**Por qué el acceso va más cerrado que el resto de la flota.** `/vehicles` lo
ven admin y gestor sin más; esto no, y es deliberado: enseña dónde está un
vehículo en tiempo casi real y, con él, la persona que lo conduce. Por defecto
es solo del superadmin, y **ampliarlo a los administradores es un acto
deliberado** — el toggle `menu_flota` en `/admin`, que queda registrado en
`audit_logs` como `toggle_feature`. La migración lo crea **apagado** por eso
mismo: que se abra al desplegar sería justo lo contrario de lo que se busca.

**Qué hace el flag, que no es lo que parece.** `menu_flota` NO sirve para
esconderle el mapa al superadmin: no puede, porque tanto `isFeatureEnabled`
(frontend) como `requireFeature` (backend) le dan paso siempre, igual que
`hasPermission`. Sirve para **abrírselo a los administradores**. Leído así, la
condición `isFeatureEnabled('menu_flota') && (isSuperAdmin() || isAdmin())` que
hay en el menú y en `ProtectedRoute` se entiende sola: «yo siempre, los admins
si está abierto».

**Y el flag se comprueba en el BACKEND, no solo en el menú.** Es la primera vez
que un feature flag hace de control de acceso: hasta ahora solo vivían en el
frontend, y para esconder pantallas de trabajos que nadie usa bastaba. Aquí no
—ocultar una entrada del menú no impide llamar a `GET /flota/ubicaciones` a
mano—, así que `requireFeature('menu_flota')` (`features.middleware.js`) lo
mira en `app_features` en cada petición. En cada petición y no en el token,
para que apagarlo surta efecto ya y no en el siguiente login de cada uno. Si la
consulta falla, **deniega**: ante la duda no se enseña dónde está la flota.

Para apagar el mapa del todo, incluido el superadmin, se vacía `CARTRACK_USER`
en el `.env` del servidor.

**La trampa gorda: `registration` NO es la matrícula.** Cartrack devuelve ahí
el nombre del vehículo con la matrícula pegada detrás — `UVI-3-7740MZB`,
`VIR-01-7950KGG`, `VAL- 2066JSC` (con guion Y espacio). Normalizando el texto
entero sale `UVI37740MZB`, que no cruza con el `7740MZB` de nuestra ficha: la
sonda cruzó **0 de 10** vehículos por esto exactamente. Lo resuelve
`matricula.utils.extraerMatricula`, que busca la matrícula dentro del texto
(entero → por trozos de derecha a izquierda → pegada al final). No tiene espejo
en el frontend: el navegador nunca ve el texto crudo de Cartrack.

**Otras dos que costaron lo mismo de encontrar:** `driver` es un OBJETO
(`{driver_id, first_name, last_name, …}`), no una cadena — devolverlo tal cual
metía el objeto entero en el campo y React revienta al pintarlo; y el
`odometer` viene en **metros** salvo que se pida `odometer_in_km=true`, que el
servicio ya manda. La red de seguridad que divide por mil corta en un millón y
no más abajo porque 235.400 es un kilometraje de lo más normal en una
ambulancia y dividirlo daría 235 km.

**La caché es lo que mantiene el consumo bajo control.** Cartrack limita
`/vehicles/status` a 60 llamadas/min y el límite es de la CUENTA, no de cada
usuario: si cada admin con el mapa abierto disparara la suya, varias pestañas
refrescando cada 30 s se irían acercando al tope. Con la caché compartida de
30 s son ~2 llamadas/min haya quien haya mirando, más el *single-flight* para
que tres pestañas que abren el mapa a la vez no hagan tres llamadas. Cuando
Cartrack falla se sigue sirviendo la última foto conocida hasta 10 minutos
(`origen: 'cache-vieja'`), porque un corte de medio minuto no debería vaciar el
mapa; pasados esos 10 minutos ya no es «la última posición», es historia. En el
navegador, el refresco de 30 s **se pausa con la pestaña oculta**: si no, un
portátil con el mapa abierto de fondo gastaría cupo toda la noche para nadie.

**Fase 0: `scripts/sonda-cartrack.js`.** Llama a la API de verdad, imprime los
nombres de campo reales y cuenta cuántas matrículas cruzan con la tabla
`vehicles`. Es lo que destapó las tres trampas de arriba, y es lo primero que
hay que correr si el mapa empieza a salir vacío o si Cartrack cambia algo:

    cd backend && node scripts/sonda-cartrack.js       # + --crudo vuelca la 1ª fila

**Los estados y sus colores** los decide el backend (`estadoDeGps`) y el
frontend solo los pinta: `movimiento` (verde) · `parado_contacto` (ámbar) ·
`apagado` (gris) · `sin_senal` (rojo, más de 30 min sin dar señal) · `sin_gps`.
El orden de las preguntas importa: primero si el dato sirve y solo después qué
dice, porque un vehículo que lleva dos horas mudo puede tener guardado
`speed: 90` de cuando se le fue la cobertura, y pintarlo «en movimiento» sería
mentir con datos ciertos. Por lo mismo el umbral de movimiento es 3 km/h y no
0: un GPS parado oscila él solo, y con el corte en cero media flota aparecía
moviéndose de madrugada en su propio aparcamiento.

**Una matrícula repetida no se vincula.** Si la misma matrícula normalizada
sale dos veces (en nuestra tabla o en Cartrack), no se enlaza ninguna y se
marca `ambigua`: elegir al azar pintaría el vehículo A con la posición del B, y
eso es peor que no pintar nada porque parece un dato bueno. Los dos casos de
fallo del cruce —nuestro sin GPS y GPS sin vehículo nuestro— salen en el filtro
«Sin vincular» y en el resumen del pie: se cuentan, no se esconden.

---

## 3. Frontend

### 3.1 Arranque

`main.jsx` → `App.jsx` (providers: Auth, Notification, Features; `BrowserRouter`
con `basename` = `BASE_URL`) → `Layout` (Navbar + Sidebar + Toast +
InstallPWAButton + VehicleExpirationAlerts) → páginas. `SWUpdater` gestiona la
auto-actualización de la PWA. Config en `vite.config.js` (`VITE_BASE_PATH`,
`VITE_APP_ENV`, proxy de dev a `:3001`, plugin PWA).

**El service worker lo escribimos nosotros**: `src/sw.js`, con
`strategies: 'injectManifest'`. Antes lo generaba el plugin (`generateSW`) y se
cambió porque los handlers `push`/`notificationclick` no se pueden declarar en
configuración. El precio es que `skipWaiting` + `clientsClaim` (que ponía
`registerType: 'autoUpdate'`), el fallback de navegación a `index.html`,
`cleanupOutdatedCaches` y las dos reglas de `runtimeCaching` **ahora son código
de `sw.js`**: si se tocan sin cuidado, la PWA deja de actualizarse sola o deja
de funcionar sin cobertura.

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
| `/perfil` | `Perfil.jsx` | cualquiera | — |
| `/flota` | `flota/MapaFlota.jsx` | **super siempre; admin con el flag** | `menu_flota` (apagada; §2.6) |
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
| `MapaFlota` (+ `components/flota/MapaLeaflet`) | `flota.service` + `utils/flota.js` | `GET /flota/ubicaciones` |
| `AdminPanel` | `admin.service` + `features.service` | `/admin/*`, `/features` |
| `Login`, `AuthContext` | `auth.service` | `/auth/*` |
| `Perfil` → `AvisosPush` (solo con `MANAGE_TRABAJOS`) | `push.service` + `utils/push.js` | `/push/*` |
| `FeaturesContext` | `features.service.getActive` | `GET /features/active` |
| `TrabajoList/Detail/Form`, `MisTrabajos`, `InicioTrabajo`, `Finalizacion`, `CalendarioTrab` | `trabajos.service` | `/trabajos` |

`services/api.js`: instancia axios, adjunta el token, refresca en 401 y
reintenta. Todos los servicios cuelgan de ella.

### 3.4 Utils, contextos, hooks

| Fichero | Contenido |
|---|---|
| `utils/constants.js` | `ROLES`, `PERMISSIONS`, estados/colores/etiquetas, definición de cada tipo de foto (`IMAGEN_TIPOS_INICIO/FIN/GENERAL`, labels, instrucciones). **Espejo de** `backend/src/config/constants.js` |
| `utils/dateUtils.js` | Formato/zonas: `formatDateTime`, `formatDateTimeShort`, `formatHora`, `toUtcIso`, `toInputDatetime`, `diaEnEspana`, `formatFechaSola`… |
| `utils/vehicleAlerts.js` | Umbrales 60/45/30/15 días, ITV/ITS, descartes en `sessionStorage`. `thresholdFor` **exige un número**: en JS `null <= 15` es cierto, así que un `dias_restantes` nulo pintaba una alerta fantasma de «quedan 15 días» sobre un documento sin fecha. `withThresholds` filtra esas entradas |
| `utils/sessionStorage.js` | Almacenamiento con prefijo `vapss:<env>:` |
| `utils/push.js` | Lo que se le pregunta al NAVEGADOR: si admite push, si está instalada, si es iOS, permiso, suscribir/desuscribir |
| `utils/swAvisos.js` | Las dos decisiones del service worker que sí se pueden probar: leer el payload del push y componer la ruta del aviso. Está fuera de `sw.js` porque un SW no se monta en jsdom |
| `utils/miembrosAsignacion.js` | Responsables/personal en pantalla: qué usuarios ofrecer en cada fila (nadie dos veces), estado inicial del formulario, texto del aviso de solape, `rolEnAsignacion` (espejo del backend, que es quien manda) |
| `utils/imageCompress.js`, `imageUtils.js`, `matricula.js` | Compresión previa a subir, URL de imagen, normalización de matrícula |
| `context/AuthContext.jsx` | `useAuth`: usuario, roles, `hasPermission` |
| `context/FeaturesContext.jsx` | `useFeatures`: flags activos |
| `context/NotificationContext.jsx` | `useNotification`: toasts |
| `hooks/useDebounce.js`, `usePWAInstall.js` | |
| `utils/flota.js` | Cómo se pinta cada estado del mapa, los filtros y los textos de antigüedad del dato. **Espejo de** `backend/src/utils/flota.utils.js`: los estados los calcula el backend y aquí solo se traducen. Los colores son hex LITERALES porque los consume el SVG del marcador de Leaflet, fuera de React, y Tailwind purgaría una clase compuesta al vuelo |
| `components/camera/` | `CameraCapture` (orden forzado de fotos) + `PhotoSilhouette` + `useCameraStream` |
| `components/flota/MapaLeaflet.jsx` | El mapa. **Leaflet a pelo, sin `react-leaflet`**: la 5.x exige React 19 y aquí vamos por el 18, así que habría que quedarse clavado en la 4.x hasta migrar React, y lo que necesita esta pantalla son tres llamadas. El mapa se crea UNA vez, los marcadores se reutilizan por clave (recrearlos cerraría el popup que el usuario tuviera abierto) y el encuadre automático se hace **solo la primera vez**: rehacerlo en cada refresco daría un salto cada 30 s. Teselas de OpenStreetMap, sin clave; la atribución no es opcional, es la condición de uso |
| `components/common/` | `Modal`, `ConfirmDialog`, `StatusBadge`, `LoadingSpinner`, `Toast`, `InstallPWAButton`, `SWUpdater`, `ProtectedRoute`, `ComentariosIncidencia`, `VehicleExpirationAlerts`, `AvisosPush` |
| `components/common/AvisosPush.jsx` | Además del alta/baja, el bloque plegable «¿Suena demasiado flojo o llega tarde?»: `AjustesDelTelefono` elige entre `AjustesIPhone` y `AjustesAndroid` según `esIOS()`. Son instrucciones del SISTEMA OPERATIVO, no ajustes de la app — están aquí porque el volumen y el tono no se pueden tocar desde el código (§2.5) |
| `index.css`, `tailwind.config.js` | Estilos. Tailwind **purga** `@layer components` no usadas en `src` |

Tests frontend: `frontend/src/__tests__/{unit,component}` (servicios, utils,
contextos, hooks, `VehicleHistory`). Vitest.

**Umbrales de cobertura** (`vitest.config.js`): 85 % sentencias/líneas/funciones
y 75 % ramas. `pages/`, `components/`, `App.jsx`, `main.jsx` y `sw.js` están
**excluidos del cómputo**: lo que se mide es la lógica (servicios, utils,
contextos, hooks), no el render. Por eso un fichero de lógica sin tests hunde el
porcentaje de golpe — fue lo que pasó con `vehicleAlerts.js`.

Gotcha en `sessionStorage.test.js`: el módulo lee `VITE_APP_ENV` y ejecuta la
migración de claves antiguas **al importarse**, así que cada caso necesita
`vi.resetModules()` + `vi.stubEnv()` y un `import()` dinámico; con un import
estático arriba todos los tests compartirían el primer entorno cargado.

---

## 4. Base de datos

Tablas (dónde se crean): `schema.sql` → `users, roles, user_roles,
login_attempts, refresh_tokens, vehicles, trabajos, trabajo_vehiculos,
trabajo_usuarios, vehicle_images` + vistas `v_users_roles`, `v_trabajos_activos`
+ eventos de limpieza. Migraciones → `vehicle_revisiones`,
`vehicle_incidencias` (v2), `audit_logs`, `error_logs` (v3), `permissions`,
`role_permissions` (v4), `asignaciones_libres` (v6), `app_features` (v9),
`incidencia_comentarios` (v13), `push_subscriptions` (v17),
`asignaciones_libres.aviso_sin_iniciar_at` (v18 + v19),
`asignaciones_libres.material_usado` (v21), `asignacion_usuarios` (v23),
`schema_migrations` (control). Filas, no tablas: rol `superadmin` (v3),
permisos y su reparto (v4), flags (v9, v20), rol `tes_conductor` (v22).

Relaciones clave:

```
users ─N:M─ roles (user_roles) ─N:M─ permissions (role_permissions)
vehicles 1─N asignaciones_libres (user_id = responsable PRINCIPAL, created_by = admin)
asignaciones_libres N:M users (asignacion_usuarios: rol responsable|personal, orden)
vehicles 1─N vehicle_images (asignacion_id | trabajo_id, tipo_imagen, momento inicio/fin/general)
vehicles 1─N vehicle_incidencias (trabajo_id?, reported_by) 1─N incidencia_comentarios
vehicles 1─N vehicle_revisiones
users    1─N push_subscriptions (una por navegador; endpoint único, ON DELETE CASCADE)
trabajos N:M vehicles (trabajo_vehiculos) · trabajos N:M users (trabajo_usuarios)
```

Estados: asignación `programada → activa → finalizada | cancelada`; trabajo
`programado → activo → finalizado | finalizado_anticipado`; incidencia
`pendiente → en_revision → resuelto`. Borrado lógico con `deleted_at`.
`vehicles.alias` es el titular visible; `matricula` es única.

**`asignacion_usuarios` (v23) es quién va en la asignación**; `user_id` se
conserva como responsable principal (el `orden` 0) y lo mantiene
`guardarMiembros` en la misma transacción. Se conserva porque el frontend se
sube a mano y durante un rato un frontend viejo habla con el backend nuevo
mandando `user_id` suelto en TODO PUT (`leerMiembros` lo acepta; al crear es el
único responsable y al editar **solo cambia el principal**: los demás
responsables y el personal se conservan, o un formulario viejo recortaría la
lista sin avisar), y porque flota, historial y
avisos lo usan de respaldo. La PK `(asignacion_id, user_id)` impide que la
misma persona figure dos veces, también como responsable y personal a la vez.
**Trampa:** una fila de `asignaciones_libres` insertada a mano, sin sus
miembros, solo la ve su `user_id` (el listado y `ownership` lo aceptan de
respaldo). Le pasó a `scripts/seed-local.js`, que corre después de las
migraciones y por tanto no recibe el relleno de v23: ahora lo repite él.

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

Última migración: **v23_asignacion_usuarios**. (En alguna BD local puede
aparecer un `v23_vehiculo_cartrack_id`: es de un trabajo descartado, está muerto
y no existe en el código.)

---

## 6. Roles y permisos

Roles: `superadmin > administrador > gestor > tecnico / enfermero / medico /
tes_conductor` (tabla `user_roles`, N:M). Permisos en BD (`permissions`, `role_permissions`):
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

**Un rol se puede crear desde la app (`POST /users/roles`), pero eso solo
escribe la fila.** Para el código ese rol no lleva vehículo: no entra en
`tieneRolDeCampo` y su portador se come un 403 al subir la evidencia de su
propia asignación (`ownership.middleware`). Un rol **de campo** de verdad se
da de alta por migración —así se llama igual en local, PRE y producción— y se
añade a `ROLES` (back y front), a `tieneRolDeCampo` y al `isOperacional` del
frontend. Así nació `tes_conductor` (v22), sin ningún permiso: como
tecnico/enfermero/medico, queda acotado a **Mis Asignaciones**.

En pantalla el nombre de BD no se pinta tal cual: `ROL_LABELS`/`labelRol()`
(`frontend/utils/constants.js`) lo traducen («TES Conductor»), con respaldo al
nombre crudo para los roles creados a mano. Lo usan `RolBadge` y `UserForm`.

### 6.1 Quién hace qué en una asignación

| Acción | Responsable | Personal | Gestión (`manage_trabajos`) |
|---|---|---|---|
| Verla (Mis asignaciones, detalle) | sí | **sí** | sí |
| Activar / fotos de inicio / finalizar | sí (cualquiera de ellos) | **no** | sí |
| Subir evidencias (`ownership` incluido) | sí | **no** | sí |
| Registrar incidencia desde la asignación | sí (la incidencia queda a su nombre) | **no** | sí (`manage_incidencias`; atribuye al principal o a quien elija) |

La regla vive en `rolEnAsignacion` (backend); el frontend solo esconde
botones (`mi_rol` en el listado, `rolEnAsignacion` del util en el detalle).
Que una persona se solape en fechas con otra asignación abierta **no se
bloquea**: create/update devuelven `solapes` y el formulario pinta un aviso.

## 7. Feature flags

Tabla `app_features` (v9), gestionada desde `/admin` por superadmin.
Backend: `features.controller.js`. Frontend: `FeaturesContext` +
`requiredFeature` en `ProtectedRoute` + `Sidebar`. Claves: `menu_dashboard`,
`menu_mis_trabajos`, `menu_trabajos` (apagadas: línea base «solo vehículos»);
`menu_mis_asignaciones`, `menu_asignaciones`, `menu_vehiculos`,
`menu_usuarios`, `menu_alertas` (encendidas); `menu_flota` (apagada, v20).

**PENDIENTE — quitar el `personal` de las asignaciones cuando se active
Trabajos.** El personal en asignaciones libres (rol `personal` de
`asignacion_usuarios`, su bloque en `AsignacionForm`, la etiqueta en
`MisAsignaciones`, el aviso en `AsignacionDetalle`) es provisional. El modelo
bueno es Trabajo → vehículo(s) → personal: el responsable de cada vehículo
activa el trabajo y evidencia el estado del vehículo, y todo el personal ve los
detalles del trabajo. Al encender `menu_trabajos`, el personal se retira de las
asignaciones.

**`menu_flota` es la excepción a todo lo anterior y conviene no copiarla sin
pensar.** Los demás flags solo deciden si una pantalla aparece en el menú, y
viven únicamente en el frontend. Ese no **amplía quién puede entrar** (de solo
superadmin a también administradores) y por eso se comprueba además en el
backend con `requireFeature` (§2.3 y §2.6). Un flag que decide quién ve qué y
solo actúa en el navegador no es un control de acceso.

## 8. Flujos transversales (qué tocar si cambias…)

| Si cambias… | Toca |
|---|---|
| Un tipo de foto obligatoria | `backend/config/constants.js` **y** `frontend/utils/constants.js`; `CameraCapture`; `asignaciones.controller` (`getProgreso`, `finalizarAsignacion`); posiblemente ENUM `vehicle_images.tipo_imagen` (migración) |
| Un campo de asignación | migración → `asignaciones.controller` (`getAsignacionCompleta`, create/update) → `asignaciones.routes` (validadores) → `AsignacionForm`/`AsignacionDetalle` → tests |
| Quién va en una asignación (responsables / personal) | migración v23 → `asignaciones.controller` (`leerMiembros`, `guardarMiembros`, `rolEnAsignacion`, `buscarSolapes`, filtro del listado) + `asignaciones.routes` (validadores `responsables`/`personal`, `user_id` opcional por compatibilidad) + `ownership.middleware` + nombres en `vehicles.controller` (ficha e historial), `flota.controller`, `vigilancia.service` y `avisosAsignacion.service` → `AsignacionForm` (`ListaMiembros`), `AsignacionDetalle`, `MisAsignaciones`, `AsignacionList`, `VehicleHistory` + `utils/miembrosAsignacion.js` → `scripts/seed-local.js` si siembra asignaciones. Reglas en §6.1 |
| El orden del listado de asignaciones | `ORDEN_LISTADO` en `asignaciones.controller` (es un `ORDER BY` de SQL, **no** un `sort` en el navegador: `AsignacionList` pagina de 20 en 20 y ordenar solo la página que ha llegado daría un orden distinto en cada página). Hoy: cerradas (finalizada/cancelada) al final; el resto por `fecha_inicio` ASC, la más próxima a activarse arriba. Las `activa` no necesitan caso aparte —el cron las activa al llegar su `fecha_inicio`, así que su fecha ya es pasado y suben solas—, y `al.id` cierra el orden para que la paginación no repita ni pierda filas. `MisAsignaciones` no ordena: pinta lo que llega y descarta las cerradas |
| Un campo de vehículo | migración → `vehicles.controller` → `vehicles.routes` (validadores) → **dos formularios**: `VehicleForm` (modal del listado) y la edición en línea del Resumen en `VehicleHistory` (`CAMPOS_FICHA` + `formDesdeVehiculo`, que deciden si hay cambios sin guardar; el km en blanco **se omite del payload**, mandarlo como 0 borraba el cuentakilómetros) → `VehicleList` → `vehicleAlerts.js` si es fecha de caducidad |
| El material utilizado al cerrar un servicio | `asignaciones.controller.finalizarAsignacion` (es quien lo exige) + `asignaciones.routes` (solo acota el tamaño) → paso `material` de `FinalizacionAsignacion` (el **primero** del cierre, antes de las fotos de fin; por eso el botón izquierdo de cada paso es `BotonVolver`: «Cancelar» en el paso 0, «Atrás» en el resto) → dónde se lee: `AsignacionDetalle` y el grupo de la asignación en `getVehicleHistorial` → `VehicleHistory`. La columna es NULL-able a propósito (§4) |
| Incidencias / comentarios | `vehicles.controller` (`createIncidencia`, `addIncidenciaComentario`, `updateIncidencia`) + `asignaciones.controller.crearIncidenciaDesdeAsignacion` → `ComentariosIncidencia`, `VehicleHistory`, `AsignacionDetalle` |
| Historial del vehículo | `vehicles.controller.getVehicleHistorial` → `VehicleHistory` (+ test `VehicleHistory.test.jsx`) |
| El aviso de «cambios sin guardar» | `VehicleHistory`: cubre las pestañas, «Volver» y `beforeunload` (recarga/cierre). **No** cubre el menú lateral ni el botón atrás: haría falta `useBlocker`, y eso pide migrar a `createBrowserRouter` |
| Las horas reales de un servicio | `inicio_real_at` lo sella `activarAsignacion` (botón del técnico, no el cron) y `finalizado_at` lo sella `finalizarAsignacion`, los dos con `ahora()`. `getAsignacionCompleta` los devuelve con `al.*`; el listado (`listAsignaciones`) solo trae `inicio_real_at`. Se pintan en pareja bajo las previstas en `AsignacionDetalle` («Inicio/Fin real de servicio», `—` si falta una; la fila no sale si faltan las dos). Antes el fin real no se mostraba aunque estuviera en BD y el admin lo sacaba de la hora de las fotos de fin |
| La hora de una foto de evidencia | La pone `ahora()` al subir/rehacer en `asignaciones.controller`, `trabajos.controller` y `vehicles.controller`; se pinta en `AsignacionDetalle` (tanda + hora por miniatura), `VehicleHistory` (día+hora y badge de momento) y `TrabajoDetail` |
| Alertas de caducidad | `vehicles.controller.listAlertasVehiculos` + `utils/vehicleAlerts.js` → `AlertsPage`, `VehicleExpirationAlerts` |
| Permisos de un endpoint | `routes/*.routes.js` (middleware) + tabla `role_permissions` + `ownership.middleware` si depende de asignación |
| Un rol nuevo **de campo** (sale de servicio con la ambulancia) | Migración que lo da de alta + `ROLES` en `backend/config/constants.js` **y** `frontend/utils/constants.js` + `tieneRolDeCampo` (`roles.middleware.js`) + `isOperacional` (`AuthContext.jsx`) + `ROL_LABELS` y color en `RolBadge`. Crearlo solo desde `/usuarios` deja un rol que el código no reconoce: 403 al subir la evidencia de su propia asignación (§6) |
| Menú / nueva pantalla | `App.jsx` (ruta + `requiredFeature`) + `Sidebar.jsx` + feature en `migrations.js` |
| Fechas/horas | `fecha.utils.js` (back) y `dateUtils.js` (front); nunca `NOW()` en SQL |
| Auditoría | `audit_logs` vía el helper que usan los controladores; visible en `AdminPanel` |
| Login / sesión | `auth.controller`, `jwt.utils`, `password.utils`, `rateLimiter`, `AuthContext`, `services/api.js` |
| Cron de activación | `server.js` (`autoActivar`). Las asignaciones se activan **una a una** para poder avisar de cada una. En el mismo tick, después de activar, corre `vigilancia.revisarAsignacionesSinIniciar()` — ese orden es a propósito: son las mismas filas, y así el aviso mira el estado ya actualizado y no el del minuto anterior |
| El margen antes de avisar de una asignación sin iniciar | `AVISO_SIN_INICIAR_MINUTOS` en `config/constants.js` (leíble por entorno) + `docker-compose.yml` + `.env.example`. La lógica no cambia: solo el corte |
| Un aviso push (texto, tag, a quién) | `services/avisosAsignacion.service.js` (texto y tag) + `services/push.service.js` (destinatarios y envío) + `frontend/src/sw.js` (cómo se pinta) |
| Cuándo suena un aviso | `asignaciones.controller` (`activarAsignacion`, `uploadEvidencia`, `finalizarAsignacion`), el cron de `server.js` y `vigilancia.service.js`. Cada punto compara el estado **antes y después**: sin eso se avisa dos veces del mismo suceso. Los que salen del cron necesitan además una marca en BD, porque el «antes» se lo encuentran igual cada minuto |
| Que un aviso suene más fuerte | **No es código.** Lo decide el sistema operativo: en Android el canal de notificaciones de la PWA instalada, en iPhone los ajustes de la app y el «Resumen programado». Lo único que sí está en el código es la ENTREGA (`urgency`/`TTL` en `push.service.js`) y el texto de ayuda en `AvisosPush` |
| Algo del mapa de flota | `services/cartrack.service` (lo que se lee de Cartrack) → `utils/flota.utils` (el cruce y el estado) → `flota.controller` (lo que se junta con nuestra BD) → `frontend/utils/flota.js` (nombres y colores) → `MapaFlota` / `MapaLeaflet`. **Antes de tocar nada, correr `scripts/sonda-cartrack.js`**: dice qué manda la API hoy, que no es lo que dice su documentación (§2.6) |
| Quién puede ver el mapa de flota | `routes/flota.routes.js` (el que manda: rol **y** flag) **y** `App.jsx` + `Sidebar.jsx` + el botón «Ver en el mapa» de `VehicleHistory` (comodidad). Superadmin siempre, administradores con `menu_flota` puesto — leer §2.6 antes de ampliarlo a nadie más |
| Un feature flag que decida ACCESO y no solo menú | No basta con `requiredFeature` en `ProtectedRoute`: hay que añadir `requireFeature(key)` en las rutas del backend, o el endpoint queda abierto a quien sepa la URL (§2.3) |
| El service worker | `frontend/src/sw.js` + `vite.config.js` (`injectManifest`) + `utils/swAvisos.js` + el bloque `FilesMatch` de `public/.htaccess` (gana el ÚLTIMO que encaja) |

## 9. Entornos y despliegue

`develop → PRE`, `master → PRODUCCIÓN`. Workflows:
`.github/workflows/deploy-backend.yml` (empaqueta `backend database
docker-compose.yml`, sube por SSH a Hetzner, `docker compose`, comprueba
`/health`) y `deploy-frontend.yml` (job `build`: tests + build; job `publicar`:
subida por FTP al hosting de `vapss.net/app[-pre]/`).
**El despliegue a PRE está detrás de la variable de repositorio `PRE_ACTIVO`**:
si no vale `true`, el job `destino` marca `activo=false` y los jobs de deploy se
saltan con un aviso en el resumen del run, en vez de morir en rojo por el
entorno que falta. `master` no la mira. Detalle en `docs/ENTORNOS.md` §2. Los avisos push necesitan claves VAPID **en el `.env` de cada servidor**, que
no está en el repo y no lo toca el workflow: se generan con `npx web-push
generate-vapid-keys`, se pegan en el `.env` del entorno y se reinicia el
backend. Si se pierde la privada, todas las suscripciones dejan de valer y cada
admin tiene que volver a pulsar «Activar avisos».
El mapa de flota necesita `CARTRACK_USER`/`CARTRACK_KEY` **en el `.env` de
cada servidor**, igual que las claves VAPID: no están en el repo y el workflow
no las toca. Sin ellas la pantalla se explica sola y el resto de la app
funciona igual. En local van en `backend/.env`, que está en `.gitignore`.
Local: `docker-compose.local.yml` (MySQL en **3307**),
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
| `docs/PLAN_NOTIFICACIONES_PUSH.md` | Plan de los avisos push (implementado; ver §2.5) |
| `docs/API.md`, `docs/README.md`, `docs/DEPLOY.md` | Legado; `DEPLOY.md` está obsoleto (nginx+PM2) |
| `docs/AUDITORIA_SEGURIDAD.md` | Informe de seguridad (no se commitea, repo público) |
| `docs/rediseno/estilo-v2.html` | Mockup del diseño v2 |

## 11. Mantenimiento de este mapa

La regla está en `docs/README.md` → «Regla de documentación»: **todo cambio de
lógica o de funcionalidad se documenta aquí, en el mismo commit que lo
introduce**. Se lee antes de tocar nada y se actualiza después.

Actualizar cuando se: añada/borre/mueva un fichero relevante; añada un endpoint,
ruta de frontend, tabla, migración, feature flag, permiso o rol; cambie qué
servicio usa una página; cambie una regla de negocio, un criterio de
autorización o un flujo de §8; o se tome una decisión de infraestructura o de
despliegue.

Y sobre todo, dejar escritos **los porqués y las trampas**: lo que no se deduce
leyendo el código es justo lo que hace falta dentro de seis meses. Un cambio que
arregla algo raro merece una línea diciendo qué era lo raro — por ejemplo, la
urgencia de los avisos push (§2.5) es una línea de código y un párrafo de
explicación, y el párrafo vale más.

Si el cambio da para más de un par de párrafos, va en su propio fichero de
`docs/` y aquí queda el enlace desde la sección que corresponda.

Al final de cada tarea, repasar las secciones afectadas y la fecha de
«última revisión».

Última revisión: **2026-09-22** (orden del listado de asignaciones: §8, por
qué el `ORDER BY` va en SQL y no en el navegador).

Antes, **2026-09-20** (mapa de flota con Cartrack: §2.6, las tres
trampas que destapó la sonda de fase 0, y el flag `menu_flota` que lo abre a
los administradores — el primero que hace de control de acceso también en el
backend).
