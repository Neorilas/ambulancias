#!/bin/bash
# Backup diario de ambulancia: la BD (mysqldump) y las fotos (rsync).
# Procedimiento completo, instalación y restauración: docs/BACKUPS.md.
#
#   backup-ambulancia.sh [fichero.conf]      (por defecto /etc/ambulancia-backup.conf)
#
# - BD: dump comprimido en ${BACKUP_DIR}/db, se guardan RETENCION_DIAS días en
#   local y se sube entero a DESTINO_REMOTO.
# - Fotos: NO se copian en local (duplicaría el disco y no protege de perderlo);
#   van directas a DESTINO_REMOTO/uploads con rsync incremental.
# - En el remoto no se borra nunca nada: sin --delete, una foto borrada en el
#   servidor sigue en la copia. La retención remota la dan los snapshots del
#   Storage Box.
#
# Sale con 0 solo si la BD está copiada Y verificada Y todo ha llegado al
# remoto. Sin DESTINO_REMOTO sale con 2: la copia local sola no es un backup.

set -euo pipefail

CONF=${1:-/etc/ambulancia-backup.conf}
# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"

STACK_NAME=${STACK_NAME:-ambulancia}
BACKUP_DIR=${BACKUP_DIR:-/root/ambulancia-backups}
RETENCION_DIAS=${RETENCION_DIAS:-14}
DESTINO_REMOTO=${DESTINO_REMOTO:-}
DESTINO_PUERTO=${DESTINO_PUERTO:-23}
DESTINO_CLAVE=${DESTINO_CLAVE:-/root/.ssh/ambulancia_backup}
AVISO_URL=${AVISO_URL:-}

MYSQL_C="${STACK_NAME}-mysql"
BACKEND_C="${STACK_NAME}-backend"
TS=$(date -u +%Y%m%d_%H%M%S)
DUMP="${BACKUP_DIR}/db/${STACK_NAME}_${TS}.sql.gz"

log()   { echo "$(date -Iseconds) $*"; }
aviso() { # Ping opcional a un monitor tipo healthchecks.io: start | fail | (vacío = OK)
  [ -n "$AVISO_URL" ] || return 0
  curl -fsS -m 10 --retry 3 "${AVISO_URL}${1:+/$1}" >/dev/null 2>&1 || true
}
fallo() {
  trap - ERR
  log "ERROR: $*" >&2
  rm -f "${DUMP}.parcial"
  aviso fail
  exit 1
}
trap 'fallo "comando fallido en la línea $LINENO"' ERR

# Dos ejecuciones a la vez (cron + una a mano) se pisarían el dump.
exec 9>"/tmp/${STACK_NAME}-backup.lock"
flock -n 9 || fallo "ya hay otro backup de ${STACK_NAME} en marcha"

aviso start
umask 077   # el dump lleva datos personales: solo root
mkdir -p "${BACKUP_DIR}/db"
log "=== backup de ${STACK_NAME} ==="

# ── 1. BD ──────────────────────────────────────────────────────────────────
# Como root del contenedor: el usuario de la app no tiene PROCESS y mysqldump
# se queja sin él. La contraseña va por MYSQL_PWD dentro del contenedor, así no
# sale en `ps` ni en el log. --single-transaction: copia coherente sin
# bloquear la app (todas las tablas son InnoDB).
docker exec "$MYSQL_C" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
    --single-transaction --quick --routines --triggers --events \
    --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' \
  | gzip > "${DUMP}.parcial"

# Comprobaciones antes de darlo por bueno. Ojo: nada de `| grep -q` sobre el
# gzip -dc — con pipefail, grep corta, gzip recibe SIGPIPE y la tubería "falla"
# aunque el dump esté bien (le pasa al backup de maraya 1 día de cada 10).
gzip -t "${DUMP}.parcial" || fallo "gzip corrupto"
FINAL=$(gzip -dc "${DUMP}.parcial" | tail -n 1)
case "$FINAL" in
  *"Dump completed"*) ;;
  *) fallo "el dump no termina en «Dump completed» (cortado a medias)" ;;
esac
TABLAS_DUMP=$(gzip -dc "${DUMP}.parcial" | grep -c '^CREATE TABLE' || true)
TABLAS_BD=$(docker exec "$MYSQL_C" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = \"$MYSQL_DATABASE\" AND table_type = \"BASE TABLE\""')
[ "$TABLAS_DUMP" -eq "$TABLAS_BD" ] \
  || fallo "el dump tiene ${TABLAS_DUMP} tablas y la BD ${TABLAS_BD}"

mv "${DUMP}.parcial" "$DUMP"
log "BD OK: ${DUMP} ($(du -h "$DUMP" | cut -f1), ${TABLAS_DUMP} tablas)"

find "${BACKUP_DIR}/db" -name "${STACK_NAME}_*.sql.gz" -mtime +"${RETENCION_DIAS}" -delete
find "${BACKUP_DIR}/db" -name "*.parcial" -mmin +120 -delete

# ── 2. Copia fuera del servidor ────────────────────────────────────────────
if [ -z "$DESTINO_REMOTO" ]; then
  log "AVISO: sin DESTINO_REMOTO. La BD solo está en este disco y las fotos en NINGÚN sitio." >&2
  aviso fail
  exit 2
fi

# Las fotos se leen del volumen en el host, no con docker cp: así rsync solo
# manda las nuevas. La ruta se saca del contenedor, no se adivina el nombre
# del volumen (depende de COMPOSE_PROJECT_NAME).
UPLOADS=$(docker inspect -f \
  '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Source}}{{end}}{{end}}' "$BACKEND_C")
[ -n "$UPLOADS" ] && [ -d "$UPLOADS" ] || fallo "no encuentro el volumen de fotos de ${BACKEND_C}"

SSH_CMD="ssh -p ${DESTINO_PUERTO} -i ${DESTINO_CLAVE} -o BatchMode=yes -o StrictHostKeyChecking=yes"

rsync -a --partial --timeout=300 -e "$SSH_CMD" "${BACKUP_DIR}/db/" "${DESTINO_REMOTO}/db/"
log "BD subida a ${DESTINO_REMOTO}/db/"

# A una variable y no en tubería: `rsync | grep || true` se tragaría un fallo de rsync.
STATS=$(rsync -a --partial --timeout=300 --stats -e "$SSH_CMD" "${UPLOADS}/" "${DESTINO_REMOTO}/uploads/")
echo "$STATS" | grep -E 'Number of (regular )?files transferred|Total transferred file size' || true
log "fotos subidas a ${DESTINO_REMOTO}/uploads/ ($(du -sh "$UPLOADS" | cut -f1) en origen)"

aviso
log "=== backup OK ==="
