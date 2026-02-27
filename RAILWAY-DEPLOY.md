# Despliegue del Backend en Railway

## Requisitos previos
- Repositorio en GitHub (este mismo repo)
- Cuenta en [railway.app](https://railway.app) (puedes registrarte con GitHub)

---

## Paso 1 — Crear el proyecto en Railway

1. Entra en [railway.app](https://railway.app) → **Start a New Project**
2. Selecciona **Deploy from GitHub repo**
3. Autoriza a Railway a acceder a tu GitHub si es la primera vez
4. Busca y selecciona el repositorio `ambulancias`
5. Railway detectará el repo. **No pulses Deploy todavía.**

---

## Paso 2 — Configurar el Root Directory

Railway desplegará solo la carpeta `backend`, no todo el repo:

1. En la configuración del servicio creado → pestaña **Settings**
2. Busca el campo **Root Directory**
3. Escribe: `backend`
4. Guarda. Railway ahora usará `backend/` como raíz del proyecto Node.js.

---

## Paso 3 — Añadir base de datos MySQL

1. En tu proyecto Railway → botón **+ New**
2. Selecciona **Database → Add MySQL**
3. Railway crea el servicio MySQL y conecta automáticamente las variables de entorno al proyecto

> Railway inyecta automáticamente `MYSQLHOST`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`, `MYSQLPORT`.
> El backend usa `DB_HOST`, `DB_USER`, etc. — hay que mapearlos manualmente (ver Paso 4).

---

## Paso 4 — Variables de entorno del backend

En el servicio backend → pestaña **Variables** → añade cada una:

```
NODE_ENV=production
PORT=3001

# Base de datos — copiar los valores del servicio MySQL de Railway
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_POOL_MIN=2
DB_POOL_MAX=10

# JWT — genera valores seguros con el comando de abajo
JWT_ACCESS_SECRET=<64_bytes_hex>
JWT_REFRESH_SECRET=<64_bytes_hex_diferente>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# CORS — dominio del frontend
CORS_ORIGIN=https://vapss.net

# Uploads
UPLOADS_DIR=./uploads
MAX_FILE_SIZE_MB=10
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/webp

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOGIN_RATE_LIMIT_MAX=5
LOGIN_RATE_LIMIT_WINDOW_MS=900000
ACCOUNT_LOCKOUT_ATTEMPTS=5
ACCOUNT_LOCKOUT_DURATION_MINUTES=30

# Seguridad
BCRYPT_ROUNDS=12
LOG_LEVEL=info
LOG_DIR=./logs
API_VERSION=v1
```

### Generar JWT secrets seguros (ejecutar en local):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Ejecutar dos veces: uno para ACCESS_SECRET, otro para REFRESH_SECRET
```

---

## Paso 5 — Inicializar la base de datos

Railway no ejecuta los scripts SQL automáticamente. Hay que hacerlo una vez:

### Opción A — Desde Railway CLI (recomendado)
```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Vincular al proyecto
railway link

# Ejecutar schema y seed usando las vars de Railway
railway run node scripts/setup-db.js

# Crear usuario administrador
railway run node scripts/create-admin.js
```

### Opción B — Desde MySQL Workbench / DBeaver
1. En Railway → servicio MySQL → pestaña **Connect**
2. Copia los datos de conexión (host, port, user, password, database)
3. Conéctate desde tu cliente MySQL local
4. Ejecuta `database/schema.sql` y luego `database/seed.sql`
5. Para el admin, conecta Railway CLI y ejecuta `railway run node scripts/create-admin.js`

---

## Paso 6 — Obtener la URL pública del backend

1. Railway → servicio backend → pestaña **Settings**
2. Sección **Networking** → **Generate Domain**
3. Railway asigna una URL tipo: `https://ambulancias-backend-xxxx.railway.app`

---

## Paso 7 — Actualizar el frontend con la URL de Railway

Edita el archivo `frontend/.env.production`:

```env
VITE_BASE_PATH=/app/
VITE_API_URL=https://ambulancias-backend-xxxx.railway.app/api/v1
```

Luego genera el build y súbelo a cPanel:

```bash
cd frontend
npm run build
# Subir contenido de dist/ a public_html/app/ en cPanel
```

---

## Paso 8 — Verificar que todo funciona

```bash
# Health check del backend
curl https://ambulancias-backend-xxxx.railway.app/health

# Respuesta esperada:
# {"status":"ok","db":"connected",...}
```

---

## Notas importantes

- **Uploads de imágenes**: Railway tiene sistema de archivos efímero. Las fotos subidas
  se perderán si el servicio se reinicia. Para producción real, migrar a un bucket S3/R2.
  De momento funciona para pruebas y uso ligero.

- **Plan gratuito de Railway**: incluye 500 horas/mes y 1 GB de RAM. Suficiente para uso interno.

- **Redeploy automático**: cada `git push` a la rama `main` dispara un nuevo despliegue automático.

- **Logs**: Railway → servicio backend → pestaña **Logs** para ver errores en tiempo real.
