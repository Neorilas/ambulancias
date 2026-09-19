# Entorno local

Sirve para probar un cambio **antes** de que salga a ningún sitio. Mientras PRE
no esté montado (ver [ENTORNOS.md](ENTORNOS.md) §5), este es el único entorno
donde se puede ejecutar la aplicación entera de verdad.

## El flujo

```
cambio en local  ──>  /verifica  ──>  /a-pro  ──>  producción
```

| | |
|---|---|
| `/local` | levanta el entorno (BD, backend, frontend, datos de prueba) |
| `/verifica` | tests de los dos lados, migraciones desde cero si toca el esquema, revisión del diff y prueba funcional con el agente `probador-local` |
| `/a-pro` | commit en `develop`, **confirmación explícita**, merge a `master`, y comprobación de que el deploy ha llegado de verdad |

Nada sale a producción sin pasar `/verifica`. El paso a `master` se confirma
siempre a mano, porque el Environment `produccion` no tiene aprobación
configurada y el push despliega en el acto.

No sustituye a PRE: aquí no se prueban ni el hosting, ni el service worker
servido por Apache, ni Caddy, ni los secretos reales. Sí se prueban el código,
el esquema, la cadena de migraciones y el flujo completo de la aplicación.

---

## 1. El mapa

| | LOCAL | PRE | PRODUCCIÓN |
|---|---|---|---|
| Rama | la que tengas | `develop` | `master` |
| Frontend | `http://localhost:5173` | vapss.net/app-pre/ | vapss.net/app/ |
| API | `http://localhost:3001` | api-pre.vapss.net | api.vapss.net |
| MySQL | contenedor `ambulancia-local-mysql`, puerto **3307** | contenedor en Hetzner | contenedor en Hetzner |
| Datos | falsos, generados por `seed-local.js` | limpios | reales |

La base de datos local arranca **vacía** desde `database/schema.sql` +
`database/seed.sql`, y el backend le aplica las migraciones al arrancar. Es la
misma secuencia que correría una BD nueva de PRE, así que si una migración está
rota se ve aquí.

El puerto es el **3307** y no el 3306 a propósito: así no choca con un MySQL
instalado en la máquina.

---

## 2. Puesta en marcha (la primera vez)

Hace falta Node 22 y Docker Desktop arrancado. Si está cerrado, cualquier
comando `docker` falla con `open //./pipe/dockerDesktopLinuxEngine`: abre Docker
Desktop y espera unos 10 segundos a que el motor conteste. **Después hay que
volver a levantar la base**, porque al cerrar Docker los contenedores mueren y
no vuelven solos:

```bash
cd backend && npm run local:db
```

Los datos no se pierden: están en el volumen `ambulancia-local_mysql_local_data`.

```bash
cd backend && cp .env.local.example .env
```

Ese `.env` apunta al MySQL local, usa secretos JWT de juguete (distintos de los
de PRE y producción, para que un token de local no valga en ningún otro sitio),
sube los topes de rate limit y baja bcrypt a 4 rondas para que el login sea
instantáneo.

Luego, en tres terminales:

```bash
cd backend && npm run local:db
```

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

La primera vez, con el backend ya arrancado (es quien aplica las migraciones):

```bash
cd backend && npm run seed:local
```

Y a `http://localhost:5173`.

### Usuarios que crea el seed

Todos con la contraseña `Local.2026`:

| Usuario | Rol |
|---|---|
| `admin` | administrador + superadmin (ve el panel `/admin`) |
| `gestor` | gestor |
| `tecnico` | técnico, con una asignación activa |
| `tecnico2` | técnico, con una asignación programada para mañana |
| `enfermero` | enfermero |

Más 4 vehículos, uno con la tarjeta de transporte a punto de caducar (para ver
los avisos) y dos asignaciones.

El seed es idempotente y **se niega a ejecutarse** si el `.env` no apunta a una
base local: comprueba `DB_HOST`, que `DB_NAME` contenga «local», que `APP_ENV`
sea `local` y que no haya un `MYSQL_URL` de por medio. Crea usuarios con
contraseña conocida y publicada, así que no puede tocar otra cosa.

---

## 3. Día a día

```bash
cd backend && npm run local:db      # levantar la BD (si está parada)
cd backend && npm run local:db:stop # pararla sin borrar datos
```

Empezar de cero — borra el volumen y vuelve a crear la base desde `schema.sql`:

```bash
cd backend && npm run local:reset
```

Después de un reset hay que volver a arrancar el backend (aplica migraciones) y
a ejecutar `npm run seed:local`.

Entrar a la base a mano:

```bash
docker exec -it ambulancia-local-mysql mysql -uambulancia_local -plocal_dev ambulancia_local
```

Ver qué migraciones han entrado:

```sql
SELECT name, applied_at FROM schema_migrations ORDER BY applied_at;
```

---

## 4. Qué comprobar antes de subir

Esto es lo que hace `/verifica`; queda aquí escrito para poder repetirlo a mano.

```bash
cd backend  && npm test
cd frontend && npm test
```

Y en `http://localhost:5173`, lo que toque el cambio. El flujo que más
se rompe y menos cubren los tests:

1. Entrar como `tecnico` → «Mis Asignaciones» → abrir la asignación activa.
2. Inicio de servicio, fotos (el navegador pide la cámara; con el portátil vale)
   y kilómetros.
3. Entrar como `admin` → revisar esa asignación → registrar una incidencia.
4. Ficha del vehículo → pestaña Historial: la asignación tiene que aparecer.

Si el cambio toca el esquema, además: `npm run local:reset`, arrancar el backend
y comprobar que las migraciones pasan **de cero** sin errores. Ese es justo el
caso que producción nunca ejercita y PRE sí.

---

## 5. Problemas conocidos

**`ECONNREFUSED 127.0.0.1:3307`** — la BD no ha terminado de arrancar. La
primera vez tarda ~30 s en crear el esquema. Verlo con:

```bash
docker compose -f docker-compose.local.yml logs -f mysql
```

**El backend arranca pero falla todo con 500** — mira los logs: si sale
«Migración FALLIDA», el esquema quedó a medias. `npm run local:reset` y otra vez.

**El frontend no llega a la API** — `frontend/.env` tiene que tener
`VITE_API_URL` vacío. Con eso, Vite hace de proxy de `/api` y `/uploads` hacia
`localhost:3001`. Si lo rellenas, el proxy se salta.

**El service worker sirve una versión vieja** — en el dev server está activado a
propósito. Recarga forzada, o Application → Service Workers → Unregister.
