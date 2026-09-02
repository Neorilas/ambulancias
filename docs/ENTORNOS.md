# Entornos: PRE y PRODUCCIÓN

Documento de referencia del despliegue. Sustituye a `DEPLOY.md`, que describe un
montaje con nginx + PM2 que ya no existe.

---

## 1. El mapa

| | PRE | PRODUCCIÓN |
|---|---|---|
| Rama | `develop` | `master` |
| Autorización | no, va sola | **sí, aprobación manual** |
| Frontend | `https://vapss.net/app-pre/` | `https://vapss.net/app/` |
| API | `https://api-pre.vapss.net` | `https://api.vapss.net` |
| Directorio en Hetzner | `/root/ambulancia-pre` | `/root/ambulancia` |
| Contenedores | `ambulancia-pre-mysql` / `-backend` | `ambulancia-mysql` / `-backend` |
| Volúmenes Docker | `ambulancia-pre_*` | `ambulancia_*` |
| Base de datos | **limpia**, sin datos del cliente | datos reales |
| PWA instalada como | «VAPSS PRE», chapa ámbar | «VAPSS», azul |

Los dos entornos comparten el servidor Hetzner y el hosting de Hostalia. Lo que
**no** comparten es nada de dentro: contenedores, volúmenes, base de datos,
secretos JWT y carpeta web son independientes.

---

## 2. Flujo de trabajo

```
feature/lo-que-sea  ──PR──>  develop  ──PR──>  master
                              (PRE)            (PRODUCCIÓN, con aprobación)
```

1. Se trabaja en ramas cortas que salen de `develop`.
2. Al mergear en `develop`, PRE se despliega solo. Ahí se prueba.
3. Cuando lo de PRE está validado, PR de `develop` a `master`.
4. Al mergear en `master`, el workflow **se queda esperando aprobación**. Sale
   un botón «Review deployments» en la pestaña Actions y en el correo. Hasta que
   alguien lo aprueba, producción no se toca.

Un hotfix urgente puede salir de `master` directamente, pero hay que
retro-mergearlo a `develop` para que PRE no se quede atrás.

---

## 3. Cómo se despliega ahora (y qué ha cambiado)

**Antes:** el servidor hacía `git pull` de GitHub. Desde el 02/09/2026 eso
fallaba (`could not read Username for 'https://github.com'`), así que producción
se quedó clavada en el commit `c96167b` mientras el frontend seguía subiendo
versiones nuevas. Front nuevo contra API vieja, sin que saltara ninguna alarma.

**Ahora:** el workflow empaqueta el código (`tar`), lo sube por SSH y lo
descomprime en el servidor. El servidor ya no necesita credenciales de GitHub, y
lo desplegado es exactamente el commit que disparó el workflow.

Para comprobar qué está corriendo de verdad:

```bash
curl -s https://api.vapss.net/health
```

Devuelve `appEnv` (`produccion` / `pre`) y `commit` (el SHA desplegado). Si el
SHA no es el último de la rama, ese deploy no llegó.

El deploy además **falla** si el backend no llega a servir ese SHA o si alguna
migración revienta al arrancar — antes eso pasaba en silencio.

---

## 4. La base de datos de PRE

PRE arranca con una base de datos vacía: `schema.sql` (que crea 10 tablas) más el
runner de migraciones al arrancar el backend.

Hasta ahora eso no habría funcionado. Las migraciones v2 a v8 vivían solo como
`.sql` sueltos en `/database` y se habían aplicado a mano sobre producción, así
que nunca entraron en el runner. Una base de datos nueva salía sin
`vehicle_incidencias`, `vehicle_revisiones`, `audit_logs`, `error_logs`,
`permissions`, `role_permissions` ni `asignaciones_libres`, y la API devolvía 500
en cuanto se tocaba una asignación.

Ya están todas en `backend/src/config/migrations.js`, reescritas para MySQL 8
(la v5 usaba `ADD COLUMN IF NOT EXISTS`, que es sintaxis de MariaDB) y con
guardas para que sobre una BD que ya las tiene sean no-ops.

Comprobar el estado:

```sql
SELECT name, applied_at FROM schema_migrations ORDER BY applied_at;
```

**Al añadir una migración nueva:** el `.sql` en `/database` no basta, hay que
registrarla en el array `MIGRATIONS`. Si no, no llega a ningún entorno.

### Crear el primer usuario en PRE

La BD limpia no trae usuarios. Tras el primer arranque:

```bash
ssh <hetzner> "cd /root/ambulancia-pre && docker compose exec -it backend node scripts/create-admin.js"
```

Ese usuario será el `id = 1` y la migración `v3_superadmin_auditoria` ya le habrá
dado —o le dará en el siguiente arranque— el rol `superadmin`.

---

## 5. Puesta en marcha (una sola vez)

Nada de esto lo hace el workflow: son pasos manuales.

### 5.1 DNS

Un registro `A` para `api-pre.vapss.net` apuntando a la IP del Hetzner
(`91.107.235.70`), igual que `api.vapss.net`.

### 5.2 Servidor Hetzner

```bash
mkdir -p /root/ambulancia-pre
```

Crear `/root/ambulancia-pre/.env`:

```env
# Identidad del stack — sin esto los contenedores chocan con los de producción
COMPOSE_PROJECT_NAME=ambulancia-pre
STACK_NAME=ambulancia-pre
APP_ENV=pre
LOG_LEVEL=debug

# Base de datos — credenciales PROPIAS, distintas de las de producción
DB_NAME=ambulancia_pre
DB_USER=ambulancia_pre
DB_PASSWORD=<genera uno>
MYSQL_ROOT_PASSWORD=<genera otro>

# JWT — secretos PROPIOS. Que sean distintos es lo que impide que un token
# de PRE valga en producción.  Genera cada uno con: openssl rand -hex 64
JWT_ACCESS_SECRET=<64 bytes hex>
JWT_REFRESH_SECRET=<otros 64 bytes hex>

CORS_ORIGIN=https://vapss.net
```

Y añadir a `/root/ambulancia/.env` (producción) estas tres líneas, para que su
identidad quede explícita en vez de depender del nombre de la carpeta:

```env
COMPOSE_PROJECT_NAME=ambulancia
STACK_NAME=ambulancia
APP_ENV=produccion
```

> `STACK_NAME` por defecto vale `ambulancia`, así que si se omite, producción
> sigue funcionando igual. Es mejor ponerlo.

### 5.3 Caddy

Añadir el sitio de PRE junto al de `api.vapss.net`, apuntando al contenedor
nuevo dentro de `proxy-net`:

```
api-pre.vapss.net {
    reverse_proxy ambulancia-pre-backend:3001
}
```

Luego recargar Caddy. (No he podido verificar la ruta del Caddyfile en el
servidor — está en el stack de `fundacion`, que comparte la red `proxy-net`.)

### 5.4 Hosting Hostalia

Crear la carpeta `app-pre/` al mismo nivel que `app/`, dentro del docroot de
`vapss.net`.

### 5.5 GitHub — Environments

En `Settings → Environments` del repo, dos entornos:

**`pre`**
- Sin protection rules (despliega solo).
- Secret `FTP_REMOTE_DIR` = la ruta FTP de `app-pre/` (la de producción con
  `-pre` al final; mirar el valor del secret actual del repo para la forma
  exacta).

**`produccion`**
- **Required reviewers**: las personas que pueden autorizar. Esta es la puerta.
- *Deployment branches*: limitar a `master`.
- No necesita secrets propios: hereda los del repo.

Los secrets `HETZNER_HOST`, `HETZNER_SSH_KEY`, `FTP_HOST`, `FTP_USER`,
`FTP_PASSWORD` y `FTP_REMOTE_DIR` siguen a nivel de repositorio y valen para los
dos entornos, salvo `FTP_REMOTE_DIR`, que el entorno `pre` sobrescribe.

> El secret `VITE_API_URL` ya no se usa: las URLs de cada entorno están en
> `frontend/.env.production` y `frontend/.env.pre`, que son públicas de todos
> modos (acaban dentro del bundle JS). Se puede borrar.

### 5.6 Primer arranque de PRE

```bash
cd /root/ambulancia-pre
# el primer deploy desde develop deja aquí el código
docker compose up -d
docker compose logs -f backend     # ver que las migraciones pasan
docker compose exec -it backend node scripts/create-admin.js
```

---

## 6. Convivencia de las dos PWA

PRE y producción se sirven **del mismo origen** (`https://vapss.net`), así que
comparten `localStorage`. Con las claves sueltas que había antes, entrar en PRE
pisaba la sesión de producción: el técnico se encontraba deslogueado sin haber
tocado nada, porque su token ya no valía.

Ahora las claves van prefijadas por entorno (`vapss:pre:` / `vapss:produccion:`,
en `frontend/src/utils/sessionStorage.js`) y las sesiones conviven. Hay una
migración automática de las claves viejas, para que el primer despliegue no eche
a nadie.

Para distinguirlas a simple vista:
- El manifest cambia: PRE se instala como «VAPSS PRE», con color ámbar.
- Chapa **PRE** en la barra superior y aviso «Entorno de pruebas» en el login.

Lo que **sigue compartido** (y no importa, es cosmético): los descartes de
alertas de caducidad de `vehicleAlerts.js`, que usan sus propias claves sin
prefijo.

---

## 7. Cosas a tener en cuenta

- **El `.htaccess` es obligatorio.** Lleva dentro la ruta base (`RewriteBase`,
  `Service-Worker-Allowed`) y la genera Vite en el build según el modo. Si no
  llega al hosting, se rompen el fallback de la SPA y el alcance del service
  worker. Muchos clientes FTP ocultan los dotfiles: si subes a mano, comprueba
  que está.
- **El orden de los `FilesMatch` importa.** Apache aplica el último bloque que
  encaja, no el más específico. Si se invierte, `sw.js` hereda caché de un año y
  los dispositivos se quedan clavados en la versión vieja.
- **El deploy nunca toca MySQL.** Ni en PRE ni en producción. El esquema solo se
  mueve por el runner de migraciones al arrancar el backend.
- **La PWA se recarga sola** al detectar versión nueva (≤60 s). Sigue sin ser
  condicional: si un técnico está subiendo fotos a mitad, pierde lo que llevaba.
  Es una razón más para que los despliegues a producción pasen por PRE primero.
- **Ficheros muertos en el repo:** `RAILWAY-DEPLOY.md` y `render.yaml` son de un
  despliegue que no existe. `DEPLOY.md` describe nginx + PM2. Conviene limpiarlos.
