# Guía de Despliegue

## Requisitos del servidor

- Node.js ≥ 18.x
- MySQL 8.x
- nginx (como reverse proxy en producción)
- PM2 (gestor de procesos Node.js)
- Certbot/Let's Encrypt (HTTPS obligatorio para PWA)

---

## 1. Base de datos

```bash
# Crear base de datos y usuario MySQL
mysql -u root -p <<EOF
CREATE DATABASE ambulancia_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ambulancia_user'@'localhost' IDENTIFIED BY 'PASSWORD_SEGURO_AQUI';
GRANT ALL PRIVILEGES ON ambulancia_db.* TO 'ambulancia_user'@'localhost';
FLUSH PRIVILEGES;
EOF

# Ejecutar schema y seed
mysql -u ambulancia_user -p ambulancia_db < database/schema.sql
mysql -u ambulancia_user -p ambulancia_db < database/seed.sql

# Crear usuario administrador inicial
cd backend
node scripts/create-admin.js
```

---

## 2. Backend

```bash
cd backend

# Instalar dependencias
npm install --production

# Configurar entorno
cp .env.example .env
# Editar .env con valores reales:
#   DB_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CORS_ORIGIN

# Generar secrets JWT seguros
node -e "const c=require('crypto');console.log(c.randomBytes(64).toString('hex'))"
# (ejecutar dos veces: uno para ACCESS, otro para REFRESH)

# Crear directorios de uploads
mkdir -p uploads/{vehicles,trabajos}

# Test de arranque
node server.js

# Producción con PM2
npm install -g pm2
pm2 start server.js --name ambulancia-api
pm2 startup
pm2 save
```

---

## 3. Frontend (build PWA)

```bash
cd frontend

# Instalar dependencias
npm install

# Generar iconos PWA
node scripts/generate-icons.js

# Configurar URL de API
# Crear archivo .env.production:
echo "VITE_API_URL=https://tu-dominio.com/api/v1" > .env.production

# Build de producción
npm run build
# Output en: frontend/dist/
```

---

## 4. Nginx (reverse proxy + servir frontend)

```nginx
# /etc/nginx/sites-available/ambulancia

server {
    listen 80;
    server_name tu-dominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tu-dominio.com;

    ssl_certificate     /etc/letsencrypt/live/tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305;

    # Seguridad
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
    add_header Permissions-Policy "camera=(self), microphone=()";

    # PWA - service worker necesita same-origin
    add_header Service-Worker-Allowed /;

    # Frontend (SPA)
    root /var/www/ambulancia/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        # Cache agresivo para assets hasheados
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API (proxy al backend Node.js)
    location /api/ {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 15M;
    }

    # Uploads (archivos estáticos del backend)
    location /uploads/ {
        alias /var/www/ambulancia/backend/uploads/;
        expires 7d;
        add_header Cache-Control "public";
        # Nunca ejecutar como script
        types { image/jpeg jpg jpeg; image/png png; image/webp webp; }
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3001;
    }
}
```

```bash
# Activar site y obtener certificado
sudo ln -s /etc/nginx/sites-available/ambulancia /etc/nginx/sites-enabled/
sudo certbot --nginx -d tu-dominio.com
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Instalar como PWA en dispositivos

### Android (Chrome / Edge)
1. Abrir `https://tu-dominio.com` en Chrome
2. Tap en los 3 puntos del menú → "Añadir a pantalla de inicio"
3. Confirmar → App instalada con icono en launcher

### iOS (Safari)
1. Abrir `https://tu-dominio.com` en Safari
2. Pulsar el botón de compartir (cuadrado con flecha)
3. "Añadir a pantalla de inicio"
4. Confirmar → App instalada

**Requisitos para instalabilidad PWA:**
- HTTPS obligatorio
- manifest.webmanifest con iconos 192 y 512
- Service Worker registrado
- Al menos una visita previa

---

## Recomendaciones de producción

### Seguridad
- Cambiar todos los secrets del `.env`
- `NODE_ENV=production` en backend
- Firewall: solo exponer puertos 80, 443 (nginx)
- MySQL: acceso solo desde localhost
- Backups automáticos de MySQL (`mysqldump`)
- Limitar tamaño de uploads en nginx (`client_max_body_size 15M`)
- Activar el event_scheduler de MySQL para limpieza automática:
  ```sql
  SET GLOBAL event_scheduler = ON;
  ```

### Rendimiento
- Aumentar `DB_POOL_MAX` según carga esperada
- Configurar Redis para rate limiting en producción (más preciso con múltiples instancias)
- Comprimir uploads en cliente (ya implementado) + servidor (Sharp)
- CDN para los uploads de imágenes en producción

### Monitorización
- PM2 logs: `pm2 logs ambulancia-api`
- Logs en `backend/logs/`
- Configurar alertas de PM2: `pm2 install pm2-logrotate`
- Health endpoint: `GET /health`

### Base de datos
- Backups diarios: `mysqldump ambulancia_db > backup_$(date +%Y%m%d).sql`
- Monitorizar índices con `SHOW INDEX FROM trabajos`
- Limpiar `login_attempts` y `refresh_tokens` caducados (eventos MySQL automáticos)

---

## Variables de entorno requeridas en producción

```env
NODE_ENV=production
PORT=3001
DB_HOST=localhost
DB_NAME=ambulancia_db
DB_USER=ambulancia_user
DB_PASSWORD=<muy_seguro>
JWT_ACCESS_SECRET=<64_bytes_hex>
JWT_REFRESH_SECRET=<64_bytes_hex_diferente>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
CORS_ORIGIN=https://tu-dominio.com
BCRYPT_ROUNDS=12
UPLOADS_DIR=./uploads
MAX_FILE_SIZE_MB=10
```

---

## Mejoras futuras sugeridas

1. **Notificaciones push** (Web Push API) para alertas de trabajos próximos
2. **WebSockets** (Socket.io) para estado en tiempo real del trabajo
3. **Exportación de informes** PDF (jsPDF o Puppeteer) con evidencias fotográficas
4. **Almacenamiento S3/MinIO** para imágenes en lugar de disco local
5. **2FA** (TOTP) para el rol administrador
6. **Historial de auditoría** (audit_log table) para cambios críticos
7. **App móvil nativa** (Capacitor/React Native) cuando se requiera GPS
8. **Multi-tenancy** si se gestiona más de una empresa
9. **Tests automatizados** (Vitest + Testing Library en frontend, Jest/Supertest en backend)
10. **CI/CD** (GitHub Actions: lint → test → build → deploy)
