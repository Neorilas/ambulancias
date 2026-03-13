FROM node:20-alpine

# Dependencias nativas necesarias para sharp (procesado de imágenes)
RUN apk add --no-cache \
    vips-dev \
    build-base \
    python3

WORKDIR /app

# Instalar dependencias primero (capa cacheada si package.json no cambia)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY . .

# Crear directorios necesarios
RUN mkdir -p uploads/vehicles uploads/trabajos logs

EXPOSE 3001

# Usuario sin privilegios
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

CMD ["node", "server.js"]
