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
ellos; evidencia fotográfica al inicio y al fin). **Trabajos** (v25): un
servicio con título, descripción, ubicación y fechas, 0..N vehículos —cada uno
con 1..N responsables que lo activan, documentan y cierran por su cuenta— y un
equipo de 0..N personas que ve la ficha. Listo pero oculto tras los flags
`menu_trabajos`/`menu_mis_trabajos` hasta que un superadmin los encienda (§6.2,
§7).

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
llegó. Los trabajos van de dos `UPDATE` masivos: primero sus filas de
`trabajo_vehiculos` (sin sellar `inicio_real_at`, que es la pulsación del
responsable) y después el propio trabajo, lo que cubre también los que no
tienen vehículos. **Las asignaciones no**: se
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
| `/asignaciones` | `asignaciones.routes.js` | `asignaciones.controller.js` | GET `/` · GET `/alarmas` (alarma sonora, `MANAGE_TRABAJOS`; va antes de `/:id`) · GET/PUT/DELETE `/:id` · POST `/` · POST `/:id/activar` · POST `/:id/llegada` · POST `/:id/finalizar` · POST `/:id/incidencias` · POST `/:id/evidencias` |
| `/trabajos` | `trabajos.routes.js` | `trabajos.controller.js` | GET `/mis-trabajos` · GET `/calendario` · GET `/` · CRUD `/:id` · POST `/:id/vehiculos/:vehicleId/activar` · POST `/:id/vehiculos/:vehicleId/finalize` · POST `/:id/evidencias` · POST `/:id/activar` y `/:id/finalize` (**solo trabajos sin vehículos**, `MANAGE_TRABAJOS`) |
| `/admin` | `admin.routes.js` | `admin.controller.js` | GET `/stats` · GET `/audit` · GET `/audit/users` · GET `/errors` (solo superadmin) |
| `/features` | `features.routes.js` | `features.controller.js` | GET `/active` (todos) · GET `/` y PUT `/:key` (superadmin) |
| `/push` | `push.routes.js` | `push.controller.js` | GET `/vapid-public-key` · POST `/estado` (el GET queda solo para PWAs sin actualizar; retirarlo más adelante) · POST/DELETE `/subscribe` · POST `/test`. Cualquier autenticado (hasta 2026-09-25 exigía `MANAGE_TRABAJOS`); cada endpoint solo toca las suscripciones del propio usuario |
| `/csp-report` | `index.js` (directo) | `csp.controller.js` | POST público: informes de la CSP del frontend (`report-uri` del `.htaccess`). Solo log (`CSP (report-only): …`), sin BD, URLs sin query, cada violación una vez por hora |
| `/flota` | `flota.routes.js` | `flota.controller.js` | GET `/ubicaciones` (mapa de flota). **Superadmin siempre; administradores solo con el flag `menu_flota`** (§2.6) |

Funciones internas útiles: `asignaciones.controller` → `getProgreso`,
`getAsignacionCompleta` (devuelve `responsables[]` y `personal[]`),
`rolEnAsignacion` (la regla de acceso de §6.1), `leerMiembros` (lee el body en
formato nuevo o viejo), `guardarMiembros`, `buscarSolapes`,
`crearIncidenciaDesdeAsignacion`, `ORDEN_LISTADO` (el `ORDER BY` del listado,
§8);
`vehicles.controller` → `canOperacionalAccess`, `getVehicleHistorial` (mezcla
trabajos + asignaciones), `fetchComentarios`; `trabajos.controller` →
`generateIdentificador`, `getTrabajoCompleto` (sin recortar),
`vistaParaUsuario` (el recorte por persona, §6.2), `leerVehiculos`,
`guardarResponsables`, `estadoTrabajoDesde` + `sincronizarEstadoTrabajo`,
`FILTRO_PROPIOS` (el «es mío» de los listados).

### 2.3 Middleware (`backend/src/middleware/`)

| Fichero | Aporta | Notas |
|---|---|---|
| `auth.middleware.js` | `authenticate` | Verifica JWT y **consulta permisos en BD en cada request** (no van en el token) |
| `roles.middleware.js` | `requireRole`, `requirePermission`, `requireSuperAdmin`, `requireAdmin`, `requireAdminOrGestor`, `requireAnyRole`, `hasRole`, `hasPermission`, `isSuperAdmin/isAdmin/isOperacional` | superadmin bypassa todo; 403 se audita como `access_denied` |
| `ownership.middleware.js` | `tieneElVehiculoAsignado`, `requireVehicleUploadAccess`, `requireTrabajoEvidenciaAccess`, `requireAsignacionEvidenciaAccess` | Quién puede subir fotos a qué. Solo cuentan los **responsables**: nunca el personal de una asignación ni el equipo de un trabajo. En trabajos se mira el estado de la fila `trabajo_vehiculos`, no el del trabajo. Van antes de `processAndSave`: un 403 no deja la foto huérfana en disco |
| `upload.middleware.js` | Multer (memoria) + Sharp | Límites en `constants.UPLOAD` |
| `rateLimiter.middleware.js` | `apiLimiter`, login, `uploadLimiter`, `pushLimiter`, `cspReportLimiter` | Límite **por usuario**, no por IP. `cspReportLimiter` es por IP, con cupo propio y **antes** de `apiLimiter`: los informes CSP llegan sin token y no pueden gastar el cupo anónimo de la IP (dejaría sin login a los técnicos de esa red) |
| `auditoria403.middleware.js` | `auditarAccesosDenegados` | Montado en `routes/index.js` tras `apiLimiter`: **todo** 403 a un usuario autenticado se audita como `access_denied` (con el `message` como `motivo`), también los que decide el controlador. `requirePermission`/`requireFeature` auditan con más detalle y marcan `req._accesoDenegadoAuditado` para no duplicar |
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
| `utils/jwt.utils.js` · `password.utils.js` (política de contraseña) · `response.utils.js` (`success`, errores) · `logger.utils.js` (winston) · `matricula.utils.js` · `km.utils.js` (`limpiarMilesKm`, espejo de `frontend/src/utils/kmUtils.js`) |
| `services/push.service.js` | Web Push (VAPID). Localiza a los admins, envía, borra la suscripción caducada (404/410). **Nunca lanza**: devuelve un resumen |
| `services/avisosAsignacion.service.js` | Los textos y tags de los avisos de una asignación. Lo usan el cron y el controlador, para que digan lo mismo |
| `services/vigilancia.service.js` | Los avisos que no dispara nadie: el cron mira el reloj y avisa de lo que NO ha pasado. `revisarAsignacionesSinIniciar` (marca y manda el push) y `listarAlarmasSinIniciar` (lo que la alarma sonora de la app tiene sonando) |
| `services/cartrack.service.js` | Posiciones del GPS de la flota (API de Cartrack). Caché compartida, **nunca lanza** (§2.6) |
| `utils/flota.utils.js` | El cruce GPS ↔ nuestros vehículos y el estado de cada uno (§2.6) |
| `scripts/` | `create-admin`, `create-user`, `reset-password`, `setup-db`, `seed-local`, `sonda-cartrack` (§2.6) |

### 2.5 Avisos push (Web Push / VAPID)

Para que el teléfono de quien gestiona la flota suene cuando pasa algo en una
asignación. Sin app nativa ni Firebase.

| Pieza | Dónde |
|---|---|
| Claves VAPID | Solo en el entorno (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). **Nunca en el repo, que es público.** Se pasan en `docker-compose.yml` desde el `.env` del servidor; `.env.example` las documenta. Vacías = push apagado y el resto de la app igual |
| Suscripciones | Tabla `push_subscriptions` (v17): **una fila por navegador**, no por usuario. `endpoint` es único. `guardarSuscripcion` **solo acepta endpoints de servicios de push conocidos** (`HOSTS_PUSH`: FCM, Mozilla, WNS, Apple; https y 443): el endpoint llega en el body y sin la lista `web-push` enviaría a cualquier host. Si un navegador nuevo da 400 al activar avisos, falta su host ahí. Tope de `MAX_DISPOSITIVOS` (10) por usuario: se descartan los más viejos, no se rechaza el alta. Un endpoint ya registrado **solo cambia de dueño si llegan las mismas claves** (el caso del ordenador compartido las repite); el propio dueño sí puede renovarlas. Cada envío lleva `timeout` de 10 s |
| Destinatarios | Se calculan en CADA envío. Avisos de gestión (`notificarAdmins`): permiso `manage_trabajos` o rol `administrador`/`superadmin`, usuario activo; el responsable de la asignación se excluye. Aviso de «nuevo servicio» (`notificarUsuarios`): los miembros concretos, sea cual sea su rol, usuario activo |
| Eventos | Asignación activada (cron o botón) · fotos de inicio completas · **asignación sin iniciar 30 min después de su hora** (además hace sonar la alarma de la app, abajo) · asignación finalizada (vale también por «fotos de fin», que no se manda aparte) · **nuevo servicio**, a los miembros (abajo) |
| Aviso de «nuevo servicio» | El único que va al TÉCNICO, no a gestión (desde 2026-09-25). `avisarAsignacionNueva` en `avisosAsignacion.service.js`, disparado sin await desde `createAsignacion` (a todo el equipo) y `updateAsignacion` (solo a quien **entra**: quien ya iba, aunque pase de personal a responsable, no se entera de nada nuevo; si solo sale gente o la edición la cancela, no suena). Dos envíos, uno por papel, porque el texto cambia («como responsable» / «con <responsables>») + la hora de inicio en hora española. Se excluye a quien asigna (el admin que se pone a sí mismo). Abre `/mis-asignaciones`: el `/asignaciones` de los demás avisos es de gestión y al técnico le rebotaría. Tag `asig-<id>-asignada`. Para que llegue, el técnico tiene que haber pulsado «Activar avisos» en su perfil: por eso `/push` ya no exige `MANAGE_TRABAJOS` |
| Aviso de «sin iniciar» | El único que no lo dispara una petición sino el reloj: `vigilancia.service.js`, en el tick del cron. **Iniciada = `inicio_real_at`**, o sea el botón «Inicio de servicio»; el `estado` no sirve para esto, porque el cron pone en `activa` todo lo que llega a su hora y una activa con `inicio_real_at` a NULL es precisamente la que hay que vigilar: arrancó sola y nadie ha entrado. El umbral es `AVISO_SIN_INICIAR_MINUTOS` (30 por defecto; el 2026-09-25 pasó unas horas a 15 y se volvió a 30 a petición del usuario; bajarlo por entorno es la forma de probarlo sin esperar). **En PRO sale del default de `docker-compose.yml`**, no del `.env` del servidor (comprobado 2026-09-25): cambiar el default basta. Se manda **una vez por asignación**: el candado es la columna `aviso_sin_iniciar_at` (v19, renombrada desde la `aviso_fotos_pendientes_at` de la v18) |
| Alarma sonora en la app | `components/common/AlarmaSinIniciar.jsx`, montado en `Layout`, solo con `MANAGE_TRABAJOS`. Existe porque el push suena UNA vez y con el tono del sistema, que no se puede elegir: con la app abierta (móvil en primer plano u ordenador de la oficina) esto hace sonar un **«ding-dong» suave con Web Audio: 3 campanadas en 6 s y silencio** (más una vibración corta en Android); el diálogo se queda en pantalla, callado, hasta «Enterado», y solo vuelve a sonar si aparece una alarma nueva. Antes era una sirena en bucle hasta «Enterado»; se cambió porque una ventana olvidada en segundo plano sonaba sin fin sin que nadie viera el botón. «Enterado» se propaga a las otras ventanas del mismo dispositivo (evento `storage`) y cierra la notificación del sistema de esas asignaciones. Pregunta a `GET /asignaciones/alarmas` cada 30 s, al volver a la pestaña y cuando el SW le reenvía un push (`postMessage` `AVISO_PUSH`). Usa **la misma marca** `aviso_sin_iniciar_at` que el push: suena lo que ya se avisó, y se apaga sola al pulsar el técnico «Inicio de servicio». «Enterado» es **por dispositivo** (localStorage, `utils/alarmaSinIniciar.js`), con clave `id@aviso_sin_iniciar_at` para que una asignación aplazada que vuelve a vencer suene de nuevo. Trampa: **autoplay** — el navegador no deja sonar nada sin un toque previo en la página; el contexto de audio se desbloquea con el primer `pointerdown`/`keydown` y, si la alarma salta antes, se pinta «Activar sonido». Con la app en segundo plano en el móvil no suena: ahí solo queda el push |
| Aplazar tras el aviso | `updateAsignacion` limpia `aviso_sin_iniciar_at` si cambia `fecha_inicio`, para que vuelva a avisar a la nueva hora. La asignación del SET va **la primera**: MySQL aplica el SET de izquierda a derecha y detrás de `fecha_inicio = …` compararía con el valor ya nuevo |
| Service worker | `frontend/src/sw.js` (handlers `push` y `notificationclick`; el `push` además avisa a las ventanas abiertas con `postMessage`) |
| Aviso urgente | Solo el de «sin iniciar» va con `prioridad: 'alta'` (`avisosAsignacion` → `notificarAdmins` → payload). El SW (`opcionesNotificacion` en `utils/swAvisos.js`) lo pinta distinto: «URGENTE» en el título, icono propio en la barra (`public/icons/badge-urgente-96x96.png`), vibración más larga y botón «Ver servicio». El sonido NO cambia: lo pone el sistema |
| Entrega | Todo envío va con `urgency: 'high'` y `TTL` de 1 h. Con la urgencia `normal` que pone `web-push` por defecto, Android APARCA el aviso mientras el móvil está en reposo (Doze) y lo suelta en la siguiente ventana de mantenimiento: es el «el primero llegó y los demás no» |
| «Solo llegan al abrir la app» (Android) | **No es código**: el aviso sale bien del servidor y FCM lo acepta, pero en Android quien lo recibe y ejecuta `sw.js` es **Chrome**, no la WebAPK de VAPSS, que es solo un envoltorio. Si el sistema tiene a Chrome restringido de batería, en suspensión (Samsung), sin inicio automático (Xiaomi/Huawei) o detenido por haberlo deslizado de recientes, FCM no le entrega nada y todo lo pendiente cae de golpe al abrir la app (abrirla arranca Chrome). Quitar la restricción solo a VAPSS no sirve. Las instrucciones están en `AjustesAndroid` |
| `topic` | Derivado del tag (`normalizarTopic`, 32 caracteres base64url). Sustituye el aviso del mismo suceso que siga sin entregar, en vez de encolarlo detrás |
| Volumen y tono | **No se pueden fijar desde el código.** En Android los decide el canal de notificaciones del sistema y una web no puede crear canales. Con la PWA instalada (WebAPK) la app tiene su propia entrada en los ajustes del teléfono y ahí sí se elige tono e importancia. Las instrucciones están en la UI, en `AvisosPush` → `AjustesDelTelefono`, que enseña las de Android o las de iPhone según `esIOS()` porque los dos sistemas no dan las mismas palancas |
| iPhone | iOS 16.4+ y **solo con la PWA en la pantalla de inicio**. No hay tono propio para ninguna app web ni avisos «urgentes». Lo que sí importa tocar: quitar VAPSS del **Resumen programado** (retiene y agrupa) y de los modos de concentración. Volumen = el del timbre |
| Alta/baja | Sección «Avisos en este dispositivo» del perfil (`components/common/AvisosPush.jsx`), **para todos** los usuarios. El texto de la cabecera cambia con `MANAGE_TRABAJOS` (gestión: todos los avisos; técnico: solo «nuevo servicio»). Suscribirse no da acceso a nada: qué le llega a cada uno lo decide `push.service` al enviar |

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

**Las cachés de Workbox se indexan por URL, no por usuario.** Por eso la regla
de `api-cache` va anclada al listado (`/vehicles` y `/trabajos/calendario`,
nunca las subrutas de un vehículo) y `utils/cachesSesion.js` borra `api-cache`
e `images-cache` al cerrar sesión (`AuthContext.logout` y `clearAuth` de
`api.js`). Una caché nueva con datos de la API o fotos se añade a esa lista.

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
| `/mis-trabajos` | `MisTrabajos.jsx` | **cualquiera** (el backend filtra) | `menu_mis_trabajos` (off) |
| `/trabajos` | `trabajos/TrabajoList.jsx` | admin, gestor, super | `menu_trabajos` (off) |
| `/trabajos/:id` | `trabajos/TrabajoDetail.jsx` | **cualquiera** (el backend da 403 o recorta) | `menu_trabajos` **o** `menu_mis_trabajos` |

Guardia: `components/common/ProtectedRoute.jsx` (`allowedRoles`,
`requiredFeature`, que acepta una lista: vale con uno encendido). **Espera a
que carguen los flags** antes de decidir: antes decidía con la lista vacía y
echaba a `/mis-asignaciones` a cualquiera que no fuera superadmin al recargar o
abrir un enlace a una pantalla con flag. El «cargando» de `FeaturesContext` se
deriva de si ya se cargó CON sesión (`cargadoConSesion`), no se guarda aparte:
entre el render en que llega la sesión y el efecto que lanza la carga hay un
render intermedio en que un `loading` guardado seguía en false. Menú: `components/Layout/Sidebar.jsx` (usa
`AuthContext` + `FeaturesContext`).

### 3.3 Página → servicios que usa → endpoint

| Página / componente | Servicio (`frontend/src/services/`) | Backend |
|---|---|---|
| `MisAsignaciones`, `AsignacionList`, `AsignacionDetalle`, `AsignacionForm` | `asignaciones.service` (+ `vehicles`, `users` para selectores) | `/asignaciones` |
| `InicioAsignacion`, `FinalizacionAsignacion` (fotos con `CameraCapture`) | `asignaciones.service` → `activar`, `finalizar`, `uploadEvidencia` | `/asignaciones/:id/{activar,finalizar,evidencias}` |
| `AsignacionDetalle` → «Llegada al servicio» | `asignaciones.service.registrarLlegada` | `POST /asignaciones/:id/llegada` |
| `AsignacionDetalle` → registrar incidencia | `asignaciones.service.crearIncidencia` | `POST /asignaciones/:id/incidencias` |
| `VehicleList`, `VehicleForm` | `vehicles.service` | `/vehicles` |
| `VehicleHistory` (+ `ComentariosIncidencia`) | `vehicles.service` → `get`, `getHistory`, `update` (edición en línea del Resumen), incidencias, revisiones, imágenes | `/vehicles/:id/*` |
| `AlertsPage`, `VehicleExpirationAlerts` | `vehicles.service.listAlertas / listTarjetaTransporteProximas` + `utils/vehicleAlerts.js` | `/vehicles/alertas`, `/vehicles/tarjeta-transporte/proximas` |
| `UserList`, `UserForm`, `ResetPasswordModal` | `users.service` | `/users` |
| `MapaFlota` (+ `components/flota/MapaLeaflet`) | `flota.service` + `utils/flota.js` | `GET /flota/ubicaciones` |
| `AdminPanel` | `admin.service` + `features.service` | `/admin/*`, `/features` |
| `Login`, `AuthContext` | `auth.service` | `/auth/*` |
| `Perfil` → `AvisosPush` (todos; hasta 2026-09-25 solo `MANAGE_TRABAJOS`) | `push.service` + `utils/push.js` | `/push/*` |
| `FeaturesContext` | `features.service.getActive` | `GET /features/active` |
| `TrabajoList/Detail/Form`, `MisTrabajos`, `InicioTrabajo`, `Finalizacion`, `CalendarioTrab` | `trabajos.service` (+ `utils/trabajos.js`) | `/trabajos`. `InicioTrabajo`/`Finalizacion` operan sobre UN vehículo (`vehicleIdFilter`/`vehicleId`) y cierran con `finalizeVehiculo` |

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
| `utils/alarmaSinIniciar.js` | Qué alarmas de «sin iniciar» suenan en este dispositivo: lo atendido con «Enterado» (localStorage, se poda solo) y las etiquetas. El sonido está en el componente `AlarmaSinIniciar` (§2.5) |
| `utils/swAvisos.js` | Las dos decisiones del service worker que sí se pueden probar: leer el payload del push y componer la ruta del aviso. Está fuera de `sw.js` porque un SW no se monta en jsdom |
| `utils/trabajos.js` | Formulario de trabajo (`formularioInicial`, `validarTrabajo`, `payloadTrabajo`) y qué botones toca en cada vehículo (`accionesVehiculo`). Solo traduce `detalle`/`soy_responsable`/`mi_rol`, que calcula el backend |
| `components/common/ListaMiembros.jsx` | Selector de 1..N personas (con `UserCombobox`). Sacado de `AsignacionForm` para usarlo también en los responsables de cada vehículo de `TrabajoForm` |
| `utils/miembrosAsignacion.js` | Responsables/personal en pantalla: qué usuarios ofrecer en cada fila (nadie dos veces), estado inicial del formulario, texto del aviso de solape, `rolEnAsignacion` (espejo del backend, que es quien manda) |
| `utils/kmUtils.js` | `parseKm`: quita el "." solo cuando es de verdad separador de miles en español (`/^\d{1,3}(\.\d{3})+$/`, «45.000», «1.234.567») — sin esto `parseInt("45.000")` corta en el punto y guarda 45 en vez de 45000. **No** lo quita de un decimal mal tecleado («4.5», «45.5»): eso devuelve `null` (dato inválido), no un número distinto por accidente. Vacío/nulo es «sin lectura», no cero. No toca cómo se muestra después (eso es `toLocaleString()`). Espejo backend: `backend/src/utils/km.utils.js` (`limpiarMilesKm`, mismo criterio, usado como `customSanitizer` de express-validator) |
| `utils/imageCompress.js`, `imageUtils.js`, `matricula.js` | Compresión previa a subir, URL de imagen, normalización de matrícula |
| `context/AuthContext.jsx` | `useAuth`: usuario, roles, `hasPermission` |
| `context/FeaturesContext.jsx` | `useFeatures`: flags activos |
| `context/NotificationContext.jsx` | `useNotification`: toasts |
| `hooks/useDebounce.js`, `usePWAInstall.js` | |
| `utils/flota.js` | Cómo se pinta cada estado del mapa, los filtros y los textos de antigüedad del dato. **Espejo de** `backend/src/utils/flota.utils.js`: los estados los calcula el backend y aquí solo se traducen. Los colores son hex LITERALES porque los consume el SVG del marcador de Leaflet, fuera de React, y Tailwind purgaría una clase compuesta al vuelo |
| `components/camera/` | `CameraCapture` (orden forzado de fotos) + `PhotoSilhouette` + `useCameraStream` + la revisión de cada foto: `analizarFoto` (Blob → píxeles) y `detectorVehiculo` (carga de TensorFlow y del modelo). Ver §3.5 |
| `utils/calidadFoto.js`, `utils/encuadreVehiculo.js` | Lo que DECIDE si una foto merece aviso (borrosa, movida, oscura, quemada / ambulancia cortada, lejos o ausente). Puro, sin navegador, con tests. §3.5 |
| `components/flota/MapaLeaflet.jsx` | El mapa. **Leaflet a pelo, sin `react-leaflet`**: la 5.x exige React 19 y aquí vamos por el 18, así que habría que quedarse clavado en la 4.x hasta migrar React, y lo que necesita esta pantalla son tres llamadas. El mapa se crea UNA vez, los marcadores se reutilizan por clave (recrearlos cerraría el popup que el usuario tuviera abierto) y el encuadre automático se hace **solo la primera vez**: rehacerlo en cada refresco daría un salto cada 30 s. Teselas de OpenStreetMap, sin clave; la atribución no es opcional, es la condición de uso |
| `components/common/` | `Modal`, `ConfirmDialog`, `StatusBadge`, `LoadingSpinner`, `Toast`, `InstallPWAButton`, `SWUpdater`, `ProtectedRoute`, `ComentariosIncidencia`, `VehicleExpirationAlerts`, `AvisosPush`, `AlarmaSinIniciar` (§2.5) |
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

### 3.5 Revisión de las fotos de evidencia (calidad y encuadre)

Al hacer cada foto, `CameraCapture` la revisa en el propio móvil y, si algo no
cuadra, lo dice bajo la previsualización («La foto ha salido movida» + cómo
arreglarlo) con dos botones: **Repetir** (destacado) y **Usar igualmente**.

**Regla que no se negocia: nunca bloquea.** Lo pidió así el usuario y es lo
correcto: los umbrales son heurísticos y un falso positivo que impidiera
avanzar dejaría un servicio sin cerrar. Los botones están activos también
mientras se revisa; si el técnico pulsa antes de que acabe, sigue sin aviso.

| Pieza | Qué hace |
|---|---|
| `utils/calidadFoto.js` | Borrosa, movida, oscura, quemada, lisa (lente tapada). Umbrales en `UMBRALES`, perfil de luz por tipo en `PERFIL_POR_TIPO` |
| `utils/encuadreVehiculo.js` | Solo frontal/trasera/laterales: sin vehículo, girada (lateral de lado), cortada por la izquierda/derecha, demasiado cerca, lejos |
| `components/camera/analizarFoto.js` | Reduce la foto a 512 px de lado largo y llama a lo anterior. Dos tiempos: la calidad sale al momento (`onCalidad`), el encuadre cuando responde el detector |
| `components/camera/detectorVehiculo.js` | COCO-SSD sobre TensorFlow.js, con `import()` dinámico. Se precarga al abrir la cámara si hay alguna foto exterior. Cualquier fallo (sin WebGL, sin red) = sin aviso de encuadre, nunca un error |
| `public/modelos/coco-ssd-v1/` | El modelo (7 MB), servido desde nuestro hosting, no desde Google. Lo genera `scripts/cuantizar-modelo.js` |
| `scripts/calibrar-calidad-foto.mjs` | Banco de pruebas de los umbrales (escenas sintéticas degradadas). Correr antes y después de tocar `UMBRALES` |

**Los porqués y las trampas:**

- **La nitidez no es el laplaciano de siempre.** Se probó y daba «borrosa» a
  toda foto nocturna del cuentakilómetros (casi todo negro) y no veía las
  movidas. Ahora se mide la *anchura de los bordes* (salto máximo / contraste
  del borde), que no depende de la luz ni de cuánto ocupa el contenido.
- **Movida se detecta por dos vías.** Los bordes gruesos se ensanchan en la
  dirección del movimiento, pero los trazos *finos* (dígitos, agujas del
  cuadro) no: dejan una estela de bordes nítidos. Para esos está la
  «estela» (autocorrelación negativa de la derivada, en 4 direcciones). Un
  damero nítido de la carrocería también da estela a medio periodo; se
  descuenta porque vuelve a correlar en positivo al periodo entero.
- **Cuentakilómetros de noche.** El perfil `cuadro` no mira el brillo medio
  (lo normal es que casi todo esté negro), solo que haya *algo* encendido
  (percentil 99,5). Con poca luz, el consejo de «movida» es apoyar el móvil.
- **El modelo NO va todo a uint8.** Cuantizado entero (4,3 MB) se degrada
  mucho (correlación 0,58 con el original) porque MobileNet lleva la
  normalización fundida en las convoluciones. Va en float16 salvo las capas de
  clasificación (uint8): 7 MB, correlación 0,9994. Detalle en el script.
- **Qué sabe el detector y qué no.** Sabe si hay un coche/camión/autobús (una
  ambulancia sale como «truck» o «car») y su recuadro. No sabe si es ESTA
  ambulancia ni si es el lateral izquierdo o el derecho; no se intenta.
- **Calibración.** Umbrales ajustados con escenas sintéticas, verificados con
  6 fotos de ambulancias de Wikimedia degradadas a propósito y **revisados con
  254 fotos reales de PRO** (2026-09-24, mirándolas una a una). Lo que cambió
  por las reales:
  - *Oscura* es «no hay nada iluminado» (percentil 98), no «brillo medio
    bajo». Las exteriores de noche buenas tienen brillo medio 12-43 y con el
    criterio inicial daban aviso las 16.
  - *Cortada* solo por los lados. Arriba/abajo daban falsos avisos: el
    recuadro del detector llega al suelo y al techo aunque haya margen. De
    frente/detrás el margen es del 1 % (la foto es vertical y la furgoneta
    llena el ancho); en laterales, del 2 %.
  - *Girada*: 5 de 41 laterales de PRO están guardados de lado (móvil en
    horizontal con la rotación de pantalla bloqueada). Se detecta porque la
    ambulancia sale más alta que ancha, y el consejo habla del bloqueo de
    rotación; decir «cortada» ahí despistaba.
  - *Lisa*: foto sin ningún borde y con luz (el dedo tapando la lente; 3 en
    PRO).
  En PRO muchas fotos son de pruebas (suelo, salón, teclado, negro); ahí los
  avisos aciertan. El análisis no se guarda en BD (de momento solo avisa).
- **Empaquetado.** TensorFlow va en el chunk `deteccion` (`vite.config.js`),
  **excluido del precache** del PWA: si no, lo bajaría todo el que instala la
  app aunque nunca abra la cámara. Chunk y modelo los cachea `sw.js` para
  siempre en el primer uso (CacheFirst `deteccion-cache`). Por eso el modelo
  lleva versión en la carpeta: un modelo nuevo va en `coco-ssd-v2/` y se
  cambia la ruta en `detectorVehiculo.js`.

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
`trabajos.descripcion/ubicacion` + ciclo de vida en `trabajo_vehiculos` +
`trabajo_vehiculo_responsables` (v25), `asignaciones_libres.llegada_servicio_at` (v26), `schema_migrations` (control). Filas, no tablas: rol `superadmin` (v3),
permisos y su reparto (v4), flags (v9, v20), rol `tes_conductor` (v22),
email liberado en usuarios ya borrados (v24).

Relaciones clave:

```
users ─N:M─ roles (user_roles) ─N:M─ permissions (role_permissions)
vehicles 1─N asignaciones_libres (user_id = responsable PRINCIPAL, created_by = admin)
asignaciones_libres N:M users (asignacion_usuarios: rol responsable|personal, orden)
vehicles 1─N vehicle_images (asignacion_id | trabajo_id, tipo_imagen, momento inicio/fin/general)
vehicles 1─N vehicle_incidencias (trabajo_id?, reported_by) 1─N incidencia_comentarios
vehicles 1─N vehicle_revisiones
users    1─N push_subscriptions (una por navegador; endpoint único, ON DELETE CASCADE)
trabajos N:M vehicles (trabajo_vehiculos: estado, inicio_real_at, finalizado_at, km, motivo)
trabajo_vehiculos N:M users (trabajo_vehiculo_responsables: orden; 0 = responsable_user_id)
trabajos N:M users (trabajo_usuarios = el EQUIPO: ve la ficha, no la evidencia)
```

Estados: asignación `programada → activa → finalizada | cancelada`; trabajo
y cada `trabajo_vehiculos` `programado → activo → finalizado |
finalizado_anticipado` (el del trabajo se DERIVA de los de sus vehículos,
§6.2); incidencia
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

**Ojo:** `schema.sql` es solo la base (10 tablas de la v1); le faltan
`asignaciones_libres` y otras 12. La fuente real es `schema.sql` +
`migrations.js`, que reescribe también las v2–v8 antiguas con guardas.
`scripts/setup-db.js` hace las tres cosas (schema, seed y migraciones) y sale en
rojo si una migración falla; comprobado 2026-09-26 contra una base vacía: queda
idéntica a la local (23 tablas, 25 migraciones, 16 filas de `role_permissions`)
y una segunda pasada no aplica nada.

**`users.email` es `UNIQUE` (`uq_email`) y el borrado lógico se olvidaba de
liberarlo.** `deleteUser` sufija `username` y `dni` con `__del_<id>` para que
el `UNIQUE KEY` no bloquee un alta futura con los mismos datos, pero el email
se quedaba tal cual en la fila borrada — así que recrear un usuario con el
email de uno ya eliminado chocaba contra su propia fila muerta (`ER_DUP_ENTRY`,
409 «Ya existe un registro con ese valor en: uq_email»). Se corrigió sufijando
también el email al borrar, y la migración **v24** repara con el mismo criterio
los usuarios que ya estaban borrados antes del fix.

---

## 5. Cómo se añade un cambio de esquema

1. Añadir el bloque `vN_nombre` al array `MIGRATIONS` de
   `backend/src/config/migrations.js` (idempotente: `IF NOT EXISTS`,
   `ensureColumn`). **Sin registrarlo ahí, el `.sql` de `/database` no se
   ejecuta.**
2. Opcional: dejar copia en `database/migration_vN.sql`.
3. Test en `backend/src/__tests__/unit/config/migrations.test.js`.
4. Probar desde cero con `/verifica` (BD local vacía).

Última migración: **v26_llegada_servicio_at**. (En alguna BD local puede
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

**«Inicio de servicio» no antes de media hora de la hora prevista, para
nadie** (gestión incluida): un servicio de las 8:00 se inicia desde las 7:30.
`activarAsignacion` devuelve 400 con la hora desde la que se puede
(`diaYHoraEnEspana`, en hora española). El porqué: `inicio_real_at` es la
evidencia de cuándo empezó el servicio, y pulsarlo la noche antes la falseaba.
El corte es `INICIO_ANTICIPADO_MAX_MINUTOS` (backend `config/constants.js`,
espejo en `frontend/utils/constants.js`); en pantalla lo aplican
`inicioServicioPermitidoDesde`/`esProntoParaIniciar` (`dateUtils`) con
`useAhora`, que refresca cada 30 s para que el botón se habilite solo:
`InicioAsignacion` deshabilita el botón y explica desde cuándo, y los
«Activar» de `MisAsignaciones` y `AsignacionList` pasan a «Desde dd/MM HH:mm».
Trampas: (1) solo se mira mientras `inicio_real_at` es NULL, para que repetir
la pulsación siga siendo idempotente; (2) **no** se mira el estado: el cron
pasa a `activa` a la hora prevista, así que una `activa` sin hora real ya está
dentro de la ventana, y una que gestión puso `activa` a mano por `PUT` antes de
tiempo sigue sin poder sellarse antes de la media hora; (3) `uploadEvidencia`
no exige la ventana — el asistente no deja llegar a las fotos sin pasar por el
botón, pero la API a pelo sí. Los trabajos (feature oculta) conservan su
propia regla de 24 h en `activarTrabajo`.

**«Llegada al servicio» (v26).** Entre el inicio (recoger la ambulancia y
fotografiarla) y el trabajo en el sitio va el desplazamiento; la llegada es la
hora real a la que empieza el servicio en el punto establecido. En
`AsignacionDetalle`, con las fotos de inicio completas y sin llegada aparece
la tarjeta «¿Has llegado al servicio?» (`faltaLlegada`) **junto a** «Finalizar
servicio», no en su lugar. `registrarLlegada` pide responsable o `manage_trabajos` (el
personal no), `estado = 'activa'` con `inicio_real_at`, y la tanda de inicio
completa (`getProgreso`); si ya hay hora devuelve 200 sin tocar nada, antes de
mirar el estado, para que un reintento no dé error. El `UPDATE` lleva
`llegada_servicio_at IS NULL` y solo audita (`arrive_asignacion`) si afectó a
la fila: dos toques cruzados sellan y auditan una vez. **Es OPCIONAL, por
decisión del usuario (2026-09-25): ni la pantalla ni `finalizarAsignacion` la
exigen**, porque quien olvide pulsarla tiene que poder cerrar el servicio igual.
No convertirla en obligatoria sin preguntar. Una asignación sin llegada
(olvido, o anterior a v26) tiene NULL («no consta») y se pinta con `—`.

**Fotos de inicio subidas tarde (2026-09-25).** Olvidar las fotos de inicio
no deja el servicio atascado: se pueden subir hasta que se finaliza
(`uploadEvidencia` solo corta en `finalizada`), y `finalizarAsignacion` exige
la tanda completa. La contrapartida es que una foto «de inicio» subida al
final del turno ya no enseña la ambulancia al recogerla. Por eso, cuando llega
más de `FOTOS_INICIO_TARDE_MINUTOS` (30, backend `config/constants.js`)
después de `inicio_real_at`, **se marca para gestión, sin bloquear nada**:
- `getAsignacionCompleta` → `marcarFotosInicioTarde`: cada evidencia de inicio
  lleva `retraso_min` y `tardia`, y la asignación `fotos_inicio_tarde`
  (`{fotos, max_retraso_min, umbral_min}` o null).
- `listAsignaciones` → columna `fotos_inicio_tarde` (recuento, subconsulta).
- `AsignacionDetalle`: aviso sobre la tanda de inicio y la marca `+1h 35min`
  en cada miniatura tardía. `AsignacionList`: badge «Fotos inicio tarde».
  **Solo `manage_trabajos`**: el técnico no lo ve.
- **Se calcula al leer, no se guarda**: sale de dos horas que ya están en BD.
  Vale para las asignaciones antiguas sin migración, y un cambio del umbral
  afecta también al pasado. Rehacer una foto vuelve a sellar su `created_at`,
  y es lo correcto porque la imagen que se conserva es la tardía.
- Sin `inicio_real_at` (nadie pulsó «Inicio de servicio») no hay referencia y
  no se marca. Una foto subida antes del botón sale con retraso negativo y
  tampoco se marca.
- **Trampa del corte:** en la ficha es «más de N min» en milisegundos, y en el
  listado `created_at > inicio_real_at + INTERVAL N MINUTE`. Tienen que decir
  lo mismo; comparar minutos redondeados dejaba discrepar la ficha y la lista
  con una foto subida a los 30 min y 20 s.
- El frontend no tiene espejo de la constante: pinta el `umbral_min` que le
  llega. El `title` del badge del listado no lleva la cifra por eso mismo.

**Editar una asignación (`programada` o `activa`) permite cambiar también los
responsables**, no solo fechas/notas: `PUT /asignaciones/:id` ya aceptaba
`responsables`/`personal` sin condición (mismo `requirePermission(MANAGE_TRABAJOS)`
que crear/borrar). **Vale también con el servicio en curso y las fotos de
inicio ya subidas**: cambiar quién va no toca la evidencia — las fotos cuelgan
de `asignacion_id`, no de quien las subió, así que el nuevo responsable sigue
desde donde está (fotos de fin y cierre). Solo el vehículo queda bloqueado
(abajo). Se edita desde el «Editar» del listado (`AsignacionList`) **y** desde
la cabecera de `AsignacionDetalle` (solo `manage_trabajos`, no en
finalizada/cancelada); los dos abren el mismo `AsignacionForm`, que en una
`activa` avisa de lo anterior.

**Trampa de las notas:** el `UPDATE` de `updateAsignacion` usa `COALESCE(?, col)`
para «lo que no venga se conserva», y el formulario manda `notas: null` cuando
se vacían — así que borrar las notas no las borraba nunca. Las notas van aparte
con `IF(?, ?, notas)`: bandera «vienen notas» (`notas !== undefined`) y valor
recortado (vacío → `NULL`). El resto de campos sigue con `COALESCE`; si otro
campo necesita poder vaciarse, hay que sacarlo igual.

**El vehículo, en cambio, solo se puede reasignar si la asignación sigue
`programada` y no tiene ni una foto subida.** La trampa: `getProgreso`
(§2.2) cuenta las evidencias por `asignacion_id`, no por vehículo, así que si
se permitiera reasignar con fotos ya subidas, las del vehículo anterior
seguirían dando por completada la tanda del nuevo sin haberlo fotografiado
nunca — se podría cerrar el servicio sin evidencia real, que es justo lo que
el producto existe para garantizar. Y no basta con mirar el estado: nada
impide subir la foto de "inicio" con la asignación todavía `programada` (ni
`uploadEvidencia` ni el aviso "Subir ahora" del detalle exigen `activa`), así
que el candado comprueba **las dos cosas** — `updateAsignacion` corta el
cambio de `vehicle_id` si `estado !== 'programada'` o si ya hay
`evidencias`/`incidencias`. Se incluyen las incidencias porque
`crearIncidenciaDesdeAsignacion` tiene la misma trampa: graba
`vehicle_id = asig.vehicle_id` sin exigir `activa` y sin volver a tocarlo si
luego se reasigna el vehículo — es el mismo bug que las fotos, pero en
`vehicle_incidencias`. `AsignacionForm` repite la misma comprobación
(`motivoVehiculoBloqueado`) solo para no hacer el viaje al servidor; quien
manda es el backend.

**El kilometraje no retrocede al cerrar un servicio.** `finalizarAsignacion`
rechaza (400) un `km_fin` menor que `vehicles.kilometros_actuales` del momento
— no solo menor que `km_inicio` de la propia asignación, que puede haberse
quedado atrás si otra asignación avanzó el contador mientras esta seguía
abierta. Tanto `getAsignacionCompleta` (`GET /:id`, detalle) como
`listAsignaciones` (`GET /`, listados — incluido el Dashboard, que abre
`FinalizacionAsignacion` directamente con la fila del listado) traen ese dato
como `vehiculo_km_actual`; si solo uno de los dos lo trajera, el aviso previo
del wizard fallaría en silencio según desde dónde se entrara — el backend
seguiría protegido igual, pero el técnico se llevaría un 400 sorpresa al
confirmar, ya con las fotos subidas. Bajarlo a propósito (corregir una lectura
mal anotada) solo se puede desde la ficha del vehículo — `VehicleForm` o el
Resumen de `VehicleHistory` — que **sí** dejan escribir cualquier valor porque
las edita quien ya tiene `manage_trabajos` (admin/gestor/superadmin, por
`requireAdminOrGestor` en `vehicles.routes`); ambos avisan con un
`ConfirmDialog` antes de guardar si el valor escrito es menor que el actual,
para que bajarlo sea una decisión y no un despiste. El guard
`kilometros_actuales < ?` que ya llevaba el `UPDATE` de vehículo (§ arriba)
sigue ahí como red de seguridad para la carrera entre la validación y el
`UPDATE`, no como la regla en sí — ver el comentario en
`asignaciones.controller.finalizarAsignacion`.

**Trampa en `VehicleHistory`: confirmar la bajada de km desde «Guardar y
continuar» pierde el destino si se lee mal el estado.** Cambiar de pestaña con
ediciones sin guardar abre el aviso «Cambios sin guardar»; si eso incluye
bajar el km, `guardar()` no guarda — abre su propio `ConfirmDialog` y hay que
esperar a que se confirme. La trampa es CÓMO se entera quien llamó a
`guardar()` de que se quedó a la espera: leer `edicion.confirmKm` justo
después del `await` no sirve, porque `edicion` es la foto del render de ANTES
de ese `setConfirmKm` — React no la actualiza a mitad del mismo evento, así
que esa lectura siempre ve `null` y el código de abajo trataba la espera como
un fallo, limpiaba el destino pendiente y el "Guardar y continuar" se quedaba
callado sobre a dónde iba. Se arregla haciendo que `guardar()` devuelva un
sentinel (`PENDIENTE_CONFIRMACION_KM`, no `false`) que sí viaja por el
`await` correctamente, y separando el `ConfirmDialog` del km del modal de
«Cambios sin guardar» (se ocultan mutuamente por condición, no se apilan) para
que confirmar el km complete el cambio de pestaña que quedó a medias.

**Ventana estrecha sin cerrar, a propósito:** el candado se evalúa contra el
`asig` leído al principio de `updateAsignacion`, fuera de la transacción del
`UPDATE`. Si entre esa lectura y el `UPDATE` alguien sube una evidencia o una
incidencia por otra petición, el cambio de vehículo la pasaría por alto. Exige
que dos peticiones distintas lleguen casi al mismo milisegundo sobre la misma
asignación programada — a diferencia del aviso de «sin iniciar» (§2.5), que
sí necesita el guard dentro del `UPDATE` porque el cron reintenta cada minuto
y la ventana se abre sesenta veces por hora. Aquí no hay reintento: se ha
aceptado el riesgo en vez de meter un `SELECT ... FOR UPDATE` dentro de la
transacción. Si se quiere cerrar del todo, es ahí donde iría.

### 6.2 Quién hace qué en un trabajo (v25)

| Acción | Responsable de un vehículo | Equipo (`trabajo_usuarios`) | Gestión |
|---|---|---|---|
| Ver la ficha (título, descripción, ubicación, fechas, qué vehículos van y quién los lleva) | sí | sí | sí (`view_all_trabajos` o `manage_trabajos`) |
| Ver km, progreso y fotos de un vehículo | **solo del suyo** | no | todos |
| Activar / fotos / cerrar un vehículo | **solo el suyo** | no | cualquiera |
| Activar / cerrar un trabajo SIN vehículos | no | no | sí (`manage_trabajos`) |
| Crear / editar / borrar | no | no | sí (admin o gestor) |

El recorte lo hace el backend en `vistaParaUsuario`: cada vehículo sale con
`soy_responsable` y `detalle`, y el trabajo con `mi_rol`. El frontend
(`utils/trabajos.js`) solo lo convierte en botones. Un responsable **no tiene
por qué** estar también en el equipo: los listados (`FILTRO_PROPIOS`) y el 403
miran las dos cosas.

**Ciclo de vida por vehículo.** Antes `finalizeTrabajo` comprobaba las fotos
solo de los vehículos de quien llamaba, pero cerraba el trabajo ENTERO: con
dos vehículos y dos responsables, el primero en cerrar el suyo lo daba por
finalizado aunque el otro no tuviera ni una foto. Ahora cada fila
`trabajo_vehiculos` tiene su estado, y `trabajos.estado` se recalcula tras cada
cambio (`sincronizarEstadoTrabajo`): todos cerrados → finalizado (anticipado si
alguno lo fue); alguno empezado o cerrado → activo; ninguno → programado. Se
guarda en vez de calcularse al leer para que listado y calendario sigan
filtrando por una columna. **No se escribe a mano**: `PUT /trabajos/:id` ya no
acepta `estado`.

Activar un vehículo es idempotente y sella `inicio_real_at` con la primera
pulsación, como «Inicio de servicio» en asignaciones: vale también si el cron
ya lo pasó a `activo`. Quien no gestiona solo puede adelantarse 24 h. Cerrarlo
exige las fotos de inicio y de fin **de ese vehículo**, km finales que no bajen
ni de los de inicio ni del cuentakilómetros actual (mismo criterio que
asignaciones, §6.1) y motivo si es antes de `fecha_fin`. Igual que en
asignaciones, cerrar **no** exige haberlo activado antes. Un vehículo cerrado
ya no admite fotos, aunque el trabajo siga abierto por otro.

**Editar no borra y reinserta los vehículos**: se compara con lo que hay.
Borrar la fila se llevaría su estado, su hora real y sus responsables. Quitar un
vehículo que ya ha empezado o tiene fotos da 400 (su evidencia se quedaría
colgando de un trabajo que ya no lo lleva); el formulario lo marca como
bloqueado. El km de inicio solo se reescribe mientras el vehículo sigue
`programado`.

**Los responsables SÍ se pueden cambiar con el vehículo ya en servicio**
(decisión del 2026-09-25, igual que en asignaciones, §6.1): es el relevo de
conductor a mitad de servicio. Por eso `guardarResponsables` corre en todo
`PUT` sin mirar el estado de la fila y `TrabajoForm` no bloquea la lista de
responsables aunque bloquee vehículo y km. No es un olvido: la revisión de
código lo señaló como inconsistencia y se decidió dejarlo así. La evidencia ya
subida no cambia de dueño (`vehicle_images.uploaded_by` sigue siendo quien la
subió); solo cambia quién puede seguir operando el vehículo.

**Trabajo sin vehículos** (p. ej. una cobertura sin ambulancia): no hay fila de
la que colgar el ciclo, así que lo activa y lo cierra gestión con
`/:id/activar` y `/:id/finalize`, que con vehículos devuelven 400.

**Quién ve la lista cambió de criterio.** Antes el recorte colgaba de
`isOperacional`, y un usuario **sin ningún rol** —la mayoría de la plantilla—
no era «operacional» y veía todos los trabajos. Ahora sin `view_all_trabajos`
ni `manage_trabajos` solo se ven los propios. **La flota igual (2026-09-26):**
`vehicles.controller` recorta listado, ficha e imágenes con `veFlota`
(`manage_vehicles`, `manage_trabajos` o `view_all_trabajos`); antes colgaba de
`isOperacional` y el mismo usuario sin rol veía toda la flota y sus fotos.
**Regla: un recorte de visibilidad se escribe como lista blanca de permisos,
nunca como «si es operacional, recorta».** `POST /vehicles/:id/images` con
`trabajo_id` exige además ser responsable del vehículo en ese trabajo (o
gestionar vehículos/trabajos). `/vehicles` para operacionales y
`tieneElVehiculoAsignado` pasan a mirar también a los responsables y el estado
de la fila, no el equipo ni el estado del trabajo.

Trampa de las fechas: el backend guarda `fecha_inicio`/`fecha_fin` tal cual
llegan y MySQL rechaza (500) un ISO con milisegundos y `Z`. El frontend manda
`YYYY-MM-DDTHH:mm` (`toUtcIso`) y funciona; un cliente que mande
`toISOString()` entero no. Ya pasaba antes de v25.

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
asignaciones. Trabajos ya está hecho (v25, §6.2); la retirada del personal
queda como tarea aparte, a propósito, para no mezclarla con este cambio.

**Encender Trabajos es un acto deliberado**, igual que `menu_flota`: la
migración no toca los flags. Tras desplegar, un superadmin enciende
`menu_trabajos` (lista de gestión) y `menu_mis_trabajos` (lo que ve el personal
de campo, que ahora sí aparece en su menú). Mientras estén apagados, el
backend responde igual: los flags de Trabajos son de menú, no de acceso.

**`menu_flota` es la excepción a todo lo anterior y conviene no copiarla sin
pensar.** Los demás flags solo deciden si una pantalla aparece en el menú, y
viven únicamente en el frontend. Ese no **amplía quién puede entrar** (de solo
superadmin a también administradores) y por eso se comprueba además en el
backend con `requireFeature` (§2.3 y §2.6). Un flag que decide quién ve qué y
solo actúa en el navegador no es un control de acceso.

## 8. Flujos transversales (qué tocar si cambias…)

| Si cambias… | Toca |
|---|---|
| Un tipo de foto obligatoria | `backend/config/constants.js` **y** `frontend/utils/constants.js`; `CameraCapture`; `asignaciones.controller` (`getProgreso`, `finalizarAsignacion`); posiblemente ENUM `vehicle_images.tipo_imagen` (migración); `PERFIL_POR_TIPO` (`calidadFoto.js`) si necesita otro criterio de luz y `TIPOS_CON_ENCUADRE` (`encuadreVehiculo.js`) si es una vista exterior de la ambulancia |
| Cuándo avisa la revisión de una foto | `UMBRALES` en `utils/calidadFoto.js` / `UMBRALES_ENCUADRE` en `utils/encuadreVehiculo.js` → pasar `scripts/calibrar-calidad-foto.mjs` antes y después → tests. Texto y botones del aviso: `RevisionFoto` en `CameraCapture`. Nunca convertirlo en bloqueo (§3.5) |
| Un campo de asignación | migración → `asignaciones.controller` (`getAsignacionCompleta`, create/update; en el `UPDATE`, `COALESCE` impide vaciar el campo — si debe poder vaciarse, va como `notas`, §6.1) → `asignaciones.routes` (validadores) → `AsignacionForm`/`AsignacionDetalle` → tests |
| Quién va en una asignación (responsables / personal) | migración v23 → `asignaciones.controller` (`leerMiembros`, `guardarMiembros`, `rolEnAsignacion`, `buscarSolapes`, filtro del listado) + `asignaciones.routes` (validadores `responsables`/`personal`, `user_id` opcional por compatibilidad) + `ownership.middleware` + nombres en `vehicles.controller` (ficha e historial), `flota.controller`, `vigilancia.service` y `avisosAsignacion.service` → `AsignacionForm` (`ListaMiembros`), `AsignacionDetalle`, `MisAsignaciones`, `AsignacionList`, `VehicleHistory` + `utils/miembrosAsignacion.js` → `scripts/seed-local.js` si siembra asignaciones. Reglas en §6.1 |
| El orden del listado de asignaciones | `ORDEN_LISTADO` en `asignaciones.controller` (es un `ORDER BY` de SQL, **no** un `sort` en el navegador: `AsignacionList` pagina de 20 en 20 y ordenar solo la página que ha llegado daría un orden distinto en cada página). Hoy: cerradas (finalizada/cancelada) al final; las `activa` encabezan las abiertas; el resto por `fecha_inicio` ASC, la más próxima a activarse arriba; entre las cerradas, la que se cerró más tarde primero (`COALESCE(finalizado_at, fecha_fin)` — una cancelada no tiene `finalizado_at`). **El criterio de las `activa` parece redundante y no lo es**: `activarAsignacion` no mira el reloj, así que quien pulsa «Inicio de servicio» antes de hora deja una `activa` con `fecha_inicio` futura, y sin él el servicio EN CURSO se hunde bajo los que no han empezado. `al.id` cierra el orden para que la paginación no repita ni pierda filas. Quien consume ese orden sin tocarlo: `AsignacionList`, y `MisAsignaciones` y `Dashboard`, que piden 50 y descartan las cerradas en el cliente (por eso mandarlas al final les llena la ventana de filas útiles) |
| Un campo de vehículo | migración → `vehicles.controller` → `vehicles.routes` (validadores) → **dos formularios**: `VehicleForm` (modal del listado) y la edición en línea del Resumen en `VehicleHistory` (`CAMPOS_FICHA` + `formDesdeVehiculo`, que deciden si hay cambios sin guardar; el km en blanco **se omite del payload**, mandarlo como 0 borraba el cuentakilómetros) → `VehicleList` → `vehicleAlerts.js` si es fecha de caducidad |
| El mínimo de km al cerrar un servicio | `asignaciones.controller.finalizarAsignacion` (compara con `vehiculo_km_actual`, añadido a `getAsignacionCompleta`) → `FinalizacionAsignacion.jsx` (min del input y aviso en el paso de kilometraje) → `utils/kmUtils.js` (`parseKm`, usado también en `VehicleForm`/`VehicleHistory` al editar el vehículo). Bajarlo a propósito: solo desde la ficha del vehículo, con `ConfirmDialog`. Detalle y porqué en §6.1 |
| El material utilizado al cerrar un servicio | `asignaciones.controller.finalizarAsignacion` (es quien lo exige) + `asignaciones.routes` (solo acota el tamaño) → paso `material` de `FinalizacionAsignacion` (el **primero** del cierre, antes de las fotos de fin; por eso el botón izquierdo de cada paso es `BotonVolver`: «Cancelar» en el paso 0, «Atrás» en el resto) → dónde se lee: `AsignacionDetalle` y el grupo de la asignación en `getVehicleHistorial` → `VehicleHistory`. La columna es NULL-able a propósito (§4) |
| Un campo de trabajo | migración → `trabajos.controller` (`createTrabajo`/`updateTrabajo`; `getTrabajoCompleto` lo trae con `t.*`) → `trabajos.routes` (`validarCamposTrabajo`) → `utils/trabajos.js` (`formularioInicial`, `payloadTrabajo`) → `TrabajoForm`/`TrabajoDetail` → ¿lo ve el equipo? (`vistaParaUsuario` recorta por vehículo, no por campo del trabajo) |
| Responsables de un vehículo en un trabajo | v25 → `trabajos.controller` (`leerVehiculos`, `guardarResponsables`, `vistaParaUsuario`, `cargarVehiculoDelTrabajo`, `FILTRO_PROPIOS`) + `ownership.middleware` + `vehicles.controller` (`canOperacionalAccess`, listado de operacionales) → `TrabajoForm` (`ListaMiembros`) + `utils/trabajos.js`. Reglas en §6.2 |
| El ciclo de vida por vehículo de un trabajo | `trabajos.controller` (`activarVehiculo`, `finalizeVehiculo`, `estadoTrabajoDesde`, `sincronizarEstadoTrabajo`, candado de `uploadEvidencia`) + cron de `server.js` → `TrabajoDetail` (`VehiculoTrabajo`), `InicioTrabajo`, `Finalizacion`, `MisTrabajos` (`mis_vehiculos_pendientes`), `Dashboard` |
| Incidencias / comentarios | `vehicles.controller` (`createIncidencia`, `addIncidenciaComentario`, `updateIncidencia`) + `asignaciones.controller.crearIncidenciaDesdeAsignacion` → `ComentariosIncidencia`, `VehicleHistory`, `AsignacionDetalle` |
| Historial del vehículo | `vehicles.controller.getVehicleHistorial` → `VehicleHistory` (+ test `VehicleHistory.test.jsx`) |
| El aviso de «cambios sin guardar» | `VehicleHistory`: cubre las pestañas, «Volver» y `beforeunload` (recarga/cierre). **No** cubre el menú lateral ni el botón atrás: haría falta `useBlocker`, y eso pide migrar a `createBrowserRouter` |
| Las horas reales de un servicio | Tres sellos, todos con `ahora()`: `inicio_real_at` (`activarAsignacion`, botón «Inicio de servicio», no el cron), `llegada_servicio_at` (v26, `registrarLlegada`, botón «Llegada al servicio») y `finalizado_at` (`finalizarAsignacion`). `getAsignacionCompleta` los devuelve con `al.*`; el listado (`listAsignaciones`) trae inicio y llegada, no el fin. En `AsignacionDetalle` van bajo las previstas: «Inicio/Fin real de servicio» en pareja y debajo «Llegada al servicio» con lo que tardó desde el inicio (`duration`); `—` si falta una, y nada si faltan inicio y fin. `MisAsignaciones` pinta la llegada en la tarjeta. Reglas de la llegada en §6.1 |
| La hora de una foto de evidencia | La pone `ahora()` al subir/rehacer en `asignaciones.controller`, `trabajos.controller` y `vehicles.controller`; se pinta en `AsignacionDetalle` (tanda + hora por miniatura), `VehicleHistory` (día+hora y badge de momento) y `TrabajoDetail` |
| Alertas de caducidad | `vehicles.controller.listAlertasVehiculos` + `utils/vehicleAlerts.js` → `AlertsPage`, `VehicleExpirationAlerts` |
| Permisos de un endpoint | `routes/*.routes.js` (middleware) + tabla `role_permissions` + `ownership.middleware` si depende de asignación + **clasificarlo en `ACCESO` de `backend/src/__tests__/integration/autorizacion-rutas.test.js`** (`denegada` / `propia` / `controlador` / `abierta`). Una ruta nueva sin clasificar tumba los tests, y con ellos el deploy del backend. `propia` exige que TODAS sus consultas lleven el id del usuario: es el test que habría pillado SEC-10 |
| Un rol nuevo **de campo** (sale de servicio con la ambulancia) | Migración que lo da de alta + `ROLES` en `backend/config/constants.js` **y** `frontend/utils/constants.js` + `tieneRolDeCampo` (`roles.middleware.js`) + `isOperacional` (`AuthContext.jsx`) + `ROL_LABELS` y color en `RolBadge`. Crearlo solo desde `/usuarios` deja un rol que el código no reconoce: 403 al subir la evidencia de su propia asignación (§6) |
| Menú / nueva pantalla | `App.jsx` (ruta + `requiredFeature`) + `Sidebar.jsx` + feature en `migrations.js` |
| Fechas/horas | `fecha.utils.js` (back) y `dateUtils.js` (front); nunca `NOW()` en SQL. **Fechas de entrada por la API:** el frontend manda UTC sin zona (`toUtcIso`, `YYYY-MM-DDTHH:mm`), pero `isISO8601` acepta también una ISO con `Z` o `+02:00`, que MySQL rechaza en una DATETIME (500 «Incorrect datetime value»). Por eso los `fecha_inicio`/`fecha_fin` de `asignaciones.routes` y `trabajos.routes` pasan por `customSanitizer(fechaApiAMysql)`: con zona → UTC sin zona; sin zona → intacto. Un campo de fecha nuevo en una ruta necesita lo mismo. **Para comparar o pasar como parámetro, `instanteUtc`, nunca `new Date(texto)`**: el backend de producción corre con `TZ=Europe/Madrid` (`docker-compose.yml`) y `new Date('2026-09-25T08:00')` lo lee como hora española, 1-2 h desplazado. Pasaba en `buscarSolapes` (desde `createAsignacion`, con los textos del body) y en `updateTrabajo` al cambiar una sola fecha (texto del body contra `Date` de BD). Un `Date` de mysql2 no tiene el problema. Los tests fijan `process.env.TZ = 'Europe/Madrid'` para reproducirlo |
| Auditoría | `audit_logs` vía el helper que usan los controladores; visible en `AdminPanel`. **Una acción nueva necesita su entrada en `ACTION_LABEL` de `AdminPanel.jsx`**: sin ella sale en crudo (`update_asignacion`) y no aparece en el filtro «Acción», que se construye con ese mismo diccionario. `update_asignacion` guarda `details.cambios` (`{campo: {antes, despues}}`, de `cambiosAsignacion`) y solo se registra si algo cambió |
| Login / sesión | `auth.controller`, `jwt.utils`, `password.utils`, `rateLimiter`, `AuthContext`, `services/api.js` |
| Cron de activación | `server.js` (`autoActivar`). Las asignaciones se activan **una a una** para poder avisar de cada una. En el mismo tick, después de activar, corre `vigilancia.revisarAsignacionesSinIniciar()` — ese orden es a propósito: son las mismas filas, y así el aviso mira el estado ya actualizado y no el del minuto anterior |
| Cuándo una foto de inicio cuenta como «subida tarde» | `FOTOS_INICIO_TARDE_MINUTOS` en backend `config/constants.js` (sin espejo en el frontend: le llega `umbral_min`). Lógica en `asignaciones.controller` (`marcarFotosInicioTarde` para la ficha **y** la subconsulta de `listAsignaciones`, con el mismo corte) → `AsignacionDetalle` (aviso + marca por miniatura) y `AsignacionList` (badge), solo para gestión. §6.1 |
| Cuánto antes se puede pulsar «Inicio de servicio» | `INICIO_ANTICIPADO_MAX_MINUTOS` en backend `config/constants.js` **y** su espejo en `frontend/utils/constants.js` (§6.1). Si solo cambia uno, la pantalla y la API discrepan |
| El margen antes de avisar de una asignación sin iniciar | `AVISO_SIN_INICIAR_MINUTOS` en `config/constants.js` (leíble por entorno) + `docker-compose.yml` + `.env.example`. La lógica no cambia: solo el corte. Vale a la vez para el push y para la alarma sonora de la app |
| La alarma sonora (sirena, cadencia, quién la oye) | `components/common/AlarmaSinIniciar.jsx` (sonido, sondeo, UI) + `utils/alarmaSinIniciar.js` («Enterado») + `vigilancia.listarAlarmasSinIniciar` (qué suena) + ruta `GET /asignaciones/alarmas` (quién) + el `postMessage` de `sw.js`. §2.5 |
| Un aviso push (texto, tag, a quién) | `services/avisosAsignacion.service.js` (texto y tag) + `services/push.service.js` (destinatarios y envío) + `frontend/src/sw.js` (cómo se pinta). Si el aviso va a técnicos: `notificarUsuarios` y url `/mis-asignaciones`, nunca `/asignaciones` |
| A quién avisa el «nuevo servicio» | `asignaciones.controller` (`createAsignacion`: todo el equipo; `updateAsignacion`: solo los que entran) → `avisarAsignacionNueva` (reparto por papel y exclusión de quien asigna) |
| Cuándo suena un aviso | `asignaciones.controller` (`activarAsignacion`, `uploadEvidencia`, `finalizarAsignacion`), el cron de `server.js` y `vigilancia.service.js`. Cada punto compara el estado **antes y después**: sin eso se avisa dos veces del mismo suceso. Los que salen del cron necesitan además una marca en BD, porque el «antes» se lo encuentran igual cada minuto |
| Que un aviso suene más fuerte | **No es código.** Lo decide el sistema operativo: en Android el canal de notificaciones de la PWA instalada, en iPhone los ajustes de la app y el «Resumen programado». Lo único que sí está en el código es la ENTREGA (`urgency`/`TTL` en `push.service.js`) y el texto de ayuda en `AvisosPush` |
| Algo del mapa de flota | `services/cartrack.service` (lo que se lee de Cartrack) → `utils/flota.utils` (el cruce y el estado) → `flota.controller` (lo que se junta con nuestra BD) → `frontend/utils/flota.js` (nombres y colores) → `MapaFlota` / `MapaLeaflet`. **Antes de tocar nada, correr `scripts/sonda-cartrack.js`**: dice qué manda la API hoy, que no es lo que dice su documentación (§2.6) |
| Quién puede ver el mapa de flota | `routes/flota.routes.js` (el que manda: rol **y** flag) **y** `App.jsx` + `Sidebar.jsx` + el botón «Ver en el mapa» de `VehicleHistory` (comodidad). Superadmin siempre, administradores con `menu_flota` puesto — leer §2.6 antes de ampliarlo a nadie más |
| Un feature flag que decida ACCESO y no solo menú | No basta con `requiredFeature` en `ProtectedRoute`: hay que añadir `requireFeature(key)` en las rutas del backend, o el endpoint queda abierto a quien sepa la URL (§2.3) |
| El service worker | `frontend/src/sw.js` + `vite.config.js` (`injectManifest`) + `utils/swAvisos.js` + el bloque `FilesMatch` de `public/.htaccess` (gana el ÚLTIMO que encaja) |
| Un origen externo nuevo en el frontend (API, CDN, fuentes, teselas) | La CSP de `frontend/public/.htaccess` (§9). En `Report-Only` solo sale un aviso en el log; cuando sea obligatoria, sin añadirlo ahí no carga |

## 9. Entornos y despliegue

`develop → PRE`, `master → PRODUCCIÓN`. Workflows:
`.github/workflows/deploy-backend.yml` (empaqueta `backend database
docker-compose.yml`, sube por SSH a Hetzner, `docker compose`, comprueba
`/health`; **antes, el job `comprobar`: `npm test` + `npm audit --omit=dev
--audit-level=high`, y si falla no se despliega** — hasta 2026-09-26 el backend
llegaba a producción sin pasar un test en CI) y `deploy-frontend.yml` (job
`build`: tests + el mismo `npm audit` + build; job `publicar`:
subida por FTPS al hosting de `vapss.net/app[-pre]/`).
**La subida la hace `frontend/scripts/publicador/publicar-ftp.mjs`, no FTP-Deploy-Action**
(desde 2026-09-26): `FTP_HOST` es una IP y el certificado del FTP es el de
Hostalia (`*.servicio-online.net`), así que la acción solo funcionaba sin
verificar el certificado. El script valida la cadena y el nombre contra
`FTP_TLS_NOMBRE` (en el propio workflow). **Si un día el deploy del frontend
falla con «altnames»**, Hostalia ha cambiado de certificado: mirar el nuevo con
`openssl s_client -starttls ftp -connect <ip>:21` y actualizar
`FTP_TLS_NOMBRE` aquí y en `emergency-delete-mu-plugin.yml`. Sube `index.html`
y `sw.js` los últimos y no resube lo de `assets/` y `modelos/` que ya esté con
el mismo tamaño (**un modelo nuevo, siempre en carpeta nueva**: en `modelos/` no hay hash). Su única dependencia, `basic-ftp`, va fijada con lockfile en esa carpeta y se instala con `npm ci --ignore-scripts`. `emergency-delete-mu-plugin.yml` (WordPress) ya solo corre a
mano: antes se disparaba con cualquier push a master que lo tocara.
**El `.htaccess` de la PWA lleva las cabeceras de seguridad** (nosniff,
X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS) y la **CSP en modo
`Report-Only`**: sus avisos salen en el log del backend. Pasarla a obligatoria
es cambiar el nombre de la cabecera cuando deje de haber avisos; cualquier
origen externo nuevo (una API, un CDN, otras teselas) hay que añadirlo ahí
antes, o la CSP obligatoria lo bloqueará. Los marcadores `__API_ORIGIN__` y
`__API_URL__` los rellena el plugin `htaccess-con-base` de `vite.config.js`.
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

Última revisión: **2026-09-24** (Trabajos multi-vehículo, v25: §1, §2.1,
§2.2, §2.3, §3.2–3.4, §4, §5, §6.2 nueva, §7 y §8 — ciclo de vida por
vehículo, varios responsables, visibilidad del equipo, rutas abiertas al
personal de campo y `ProtectedRoute` esperando a los flags).

Antes, **2026-09-22** (§6.1 y §8: el km al cerrar un servicio no
puede bajar del actual del vehículo — se rechaza en `finalizarAsignacion`,
también desde el Dashboard (`listAsignaciones` trae `vehiculo_km_actual`
igual que el detalle); bajarlo a propósito solo desde la ficha del vehículo,
con aviso. `utils/kmUtils.js` (§3.4, con espejo backend `km.utils.js`): el
"." de los miles se quita antes de parsear kilómetros en los tres sitios
donde se escriben a mano, pero solo cuando de verdad tiene forma de miles —
un decimal mal tecleado («4.5») no se cuela como otro número. Y la trampa del
sentinel en `VehicleHistory` al confirmar una bajada de km desde «Guardar y
continuar» (§6.1): leer el estado del aviso justo tras un `await` no sirve,
React no lo ha actualizado todavía).

Antes, **2026-09-22** (§6.1: editar una asignación ya permite
cambiar vehículo y responsables desde el formulario, no solo fechas/notas; y
orden del listado de asignaciones: §8, por qué el `ORDER BY` va en SQL y no
en el navegador).

Antes, **2026-09-20** (mapa de flota con Cartrack: §2.6, las tres
trampas que destapó la sonda de fase 0, y el flag `menu_flota` que lo abre a
los administradores — el primero que hace de control de acceso también en el
backend).
