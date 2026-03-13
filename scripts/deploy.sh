#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Instalación inicial o actualización manual en servidor Hetzner
# Ejecutar en el servidor: bash scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "🚑 Ambulancias — Despliegue"
echo "────────────────────────────────────────"

# ── 1. Verificar .env ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo ""
  echo "⚠️  No existe .env — créalo con:"
  echo ""
  echo "    nano /root/ambulancia/.env"
  echo ""
  echo "Contenido necesario:"
  cat << 'EOF'
# BD (Docker interno — no cambies DB_HOST)
DB_HOST=mysql
DB_PORT=3306
DB_NAME=ambulancia_db
DB_USER=ambulancia_user
DB_PASSWORD=CAMBIA_ESTO_POR_PASSWORD_SEGURO
MYSQL_ROOT_PASSWORD=CAMBIA_ESTO_POR_ROOT_PASSWORD_SEGURO

# JWT (genera con: openssl rand -hex 64)
JWT_ACCESS_SECRET=PEGAR_AQUI_64_BYTES_HEX
JWT_REFRESH_SECRET=PEGAR_AQUI_OTRO_64_BYTES_HEX

# CORS — dominio del frontend
CORS_ORIGIN=https://vapss.net
EOF
  echo ""
  exit 1
fi

# ── 2. Pull de código ────────────────────────────────────────────────────────
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "🔄 Actualizando código..."
  git pull --ff-only
fi

# ── 3. Verificar red proxy-net ───────────────────────────────────────────────
if ! docker network ls --format '{{.Name}}' | grep -q '^proxy-net$'; then
  echo "⚠️  Creando red proxy-net..."
  docker network create proxy-net
  echo "✅ Red proxy-net creada"
fi

# ── 4. Construir y levantar todo ─────────────────────────────────────────────
echo "🐳 Construyendo imagen backend..."
docker compose build backend

echo "🚀 Levantando MySQL y backend..."
docker compose up -d

# ── 5. Esperar a MySQL ───────────────────────────────────────────────────────
echo "⏳ Esperando a MySQL (máx. 60s)..."
for i in $(seq 1 20); do
  if docker compose exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
    echo "✅ MySQL listo"
    break
  fi
  echo "   intento $i/20..."
  sleep 3
done

# ── 6. Esperar al backend ────────────────────────────────────────────────────
echo "⏳ Esperando al backend (máx. 60s)..."
for i in $(seq 1 20); do
  if docker compose exec -T backend wget -qO- http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Backend listo"
    break
  fi
  echo "   intento $i/20..."
  sleep 3
done

# ── 7. Crear admin (solo si la BD acaba de inicializarse) ───────────────────
echo ""
echo "ℹ️  Si es la primera vez, crea el usuario admin:"
echo "   docker compose exec backend node scripts/create-admin.js"

# ── 8. Resumen ───────────────────────────────────────────────────────────────
echo ""
echo "✅ Deploy completado"
echo "────────────────────────────────────────"
echo "🔗 API:    https://api.vapss.net/api/v1"
echo "❤️  Health: https://api.vapss.net/health"
echo ""
echo "Logs en tiempo real:"
echo "  docker compose logs -f"
