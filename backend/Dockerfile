FROM node:22-alpine

# Sin compilador ni vips-dev: sharp trae libvips ya compilada para Alpine
# (@img/sharp-linuxmusl-arm64 en Hetzner, -x64 en un PC). Aquí antes se
# instalaban build-base, python3 y vips-dev "para sharp": 534 MB que nadie
# usaba, porque el proceso carga la libvips de node_modules, no la del sistema.

WORKDIR /app

# Usuario sin privilegios. uid 100 / gid 101 fijos: los volúmenes de PRO
# (uploads_data, logs_data) son de 100:101 y la carpeta de backups del host
# es del grupo 101. Si cambian, la app deja de poder guardar fotos.
RUN addgroup -S -g 101 appgroup && adduser -S -u 100 -G appgroup appuser

# Instalar dependencias primero (capa cacheada si package.json no cambia).
# La caché de npm se borra en la misma capa o se queda dentro de la imagen.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Si un día sharp no trae binario para esta plataforma, que falle el build
# y no la subida de fotos en producción.
RUN node -e "require('sharp')"

# Código y node_modules siguen siendo de root (la app no los escribe). Solo
# son de appuser las carpetas donde escribe. Un `chown -R /app` duplicaba
# node_modules en otra capa (+94 MB).
COPY . .
RUN mkdir -p uploads/vehicles uploads/trabajos logs \
 && chown -R appuser:appgroup uploads logs

EXPOSE 3001

USER appuser

CMD ["node", "server.js"]
