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

# ── 1. Crear .env si no existe ──────────────────────────────────────────────
if [ ! -f .env ]; then
  echo ""
  echo "⚠️  No existe .env — créalo antes de continuar:"
  echo ""
  echo "    nano .env"
  echo ""
  echo "Contenido mínimo necesario:"
  cat << 'EOF'
DB_HOST=mysql.tudominiohostalia.com
DB_PORT=3306
DB_NAME=tuusuario_ambulancia
DB_USER=tuusuario_ambulancia
DB_PASSWORD=PASSWORD_MYSQL_HOSTALIA

JWT_ACCESS_SECRET=$(openssl rand -hex 64)
JWT_REFRESH_SECRET=$(openssl rand -hex 64)

CORS_ORIGIN=https://vapss.net
EOF
  echo ""
  echo "Ejecuta primero: cp .env.example .env && nano .env"
  exit 1
fi

# ── 2. Pull de código ────────────────────────────────────────────────────────
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "🔄 Actualizando código..."
  git pull --ff-only
fi

# ── 3. Verificar que la red proxy-net existe ─────────────────────────────────
if ! docker network ls --format '{{.Name}}' | grep -q '^proxy-net$'; then
  echo "⚠️  Red proxy-net no existe. Creándola..."
  docker network create proxy-net
  echo "✅ Red proxy-net creada"
fi

# ── 4. Construir y levantar ──────────────────────────────────────────────────
echo "🐳 Construyendo imagen Docker del backend..."
docker compose build backend

echo "🚀 Levantando servicio..."
docker compose up -d backend

# ── 5. Esperar health check ──────────────────────────────────────────────────
echo "⏳ Esperando al backend (máx. 60s)..."
for i in $(seq 1 20); do
  if docker compose exec -T backend wget -qO- http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Backend respondiendo"
    break
  fi
  echo "   intento $i/20..."
  sleep 3
done

# ── 6. Resumen ───────────────────────────────────────────────────────────────
echo ""
echo "✅ Deploy completado"
echo "────────────────────────────────────────"
echo "🔗 API:    https://api.vapss.net/api/v1"
echo "❤️  Health: https://api.vapss.net/health"
echo ""
echo "Ver logs en tiempo real:"
echo "  docker compose logs -f backend"
