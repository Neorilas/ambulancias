#!/bin/bash
# Backup diario de ambulancia: la BD (mysqldump) y las fotos, a Google Drive.
# Procedimiento completo, instalación y restauración: docs/BACKUPS.md.
#
#   backup-ambulancia.sh [fichero.conf]      (por defecto /etc/ambulancia-backup.conf)
#
# - BD: dump comprimido en ${BACKUP_DIR}/db, se guardan RETENCION_DIAS días en
#   local y se sube a DESTINO_REMOTO/db.
# - Fotos: NO se copian en local (duplicaría el disco y no protege de perderlo);
#   van directas a DESTINO_REMOTO/uploads, solo las nuevas.
# - La subida es con rclone a un remoto cifrado (crypt sobre Drive): en Drive
#   solo hay ficheros ilegibles. `rclone copy --ignore-existing` nunca borra ni
#   sobrescribe nada en el remoto: una foto borrada en el servidor sigue en la
#   copia, y el remoto es además el archivo de la retención (§8).
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
RCLONE_CONF=${RCLONE_CONF:-/etc/ambulancia-rclone.conf}
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
umask 077   # el dump lleva datos personales: solo root (y lectura al grupo del backend, abajo)
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

# Lectura para el backend, que los sirve en /admin (docs/BACKUPS.md §9): la
# carpeta está montada en el contenedor, pero el backend corre como `appuser`
# y los dumps son de root con 600. Se le da lectura SOLO a su grupo, con el
# gid que tiene de verdad dentro del contenedor (no se adivina). Sin backend
# en marcha no pasa nada: se arregla en la pasada siguiente.
GID_APP=$(docker exec "$BACKEND_C" id -g 2>/dev/null || true)
if [ -n "$GID_APP" ]; then
  chgrp "$GID_APP" "${BACKUP_DIR}/db" "${BACKUP_DIR}/db/${STACK_NAME}_"*.sql.gz
  chmod 750 "${BACKUP_DIR}/db"
  chmod 640 "${BACKUP_DIR}/db/${STACK_NAME}_"*.sql.gz
else
  log "AVISO: ${BACKEND_C} no responde; los dumps no se podrán descargar desde /admin hasta la próxima pasada" >&2
fi

# ── 2. Copia fuera del servidor ────────────────────────────────────────────
if [ -z "$DESTINO_REMOTO" ]; then
  log "AVISO: sin DESTINO_REMOTO. La BD solo está en este disco y las fotos en NINGÚN sitio." >&2
  aviso fail
  exit 2
fi

[ -r "$RCLONE_CONF" ] || fallo "no encuentro la configuración de rclone (${RCLONE_CONF})"
command -v rclone >/dev/null || fallo "rclone no está instalado"

# Las fotos se leen del volumen en el host, no con docker cp: así solo se
# mandan las nuevas. La ruta se saca del contenedor, no se adivina el nombre
# del volumen (depende de COMPOSE_PROJECT_NAME).
UPLOADS=$(docker inspect -f   '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Source}}{{end}}{{end}}' "$BACKEND_C")
[ -n "$UPLOADS" ] && [ -d "$UPLOADS" ] || fallo "no encuentro el volumen de fotos de ${BACKEND_C}"

# --ignore-existing: lo que ya está no se vuelve a mirar ni se pisa (todo lo
# que se sube es inmutable: dumps con fecha y fotos con nombre único). Las
# estadísticas salen una vez, al final, a nivel NOTICE para que lleguen al log.
# rclone reescribe RCLONE_CONF al renovar el token de Google: tiene que poder
# escribirlo (root, 600).
subir() {
  rclone --config "$RCLONE_CONF" copy "$1" "$2"     --ignore-existing --retries 3 --low-level-retries 10 --timeout 5m     --stats 1h --stats-one-line --stats-log-level NOTICE
}

subir "${BACKUP_DIR}/db/" "${DESTINO_REMOTO}/db/"
# Que el dump de hoy esté de verdad y con su tamaño: rclone da el tamaño ya
# descifrado, así que se compara con el local tal cual.
TAM_LOCAL=$(stat -c %s "$DUMP")
TAM_REMOTO=$(rclone --config "$RCLONE_CONF" lsf --format s --files-only   "${DESTINO_REMOTO}/db/$(basename "$DUMP")")
[ "$TAM_REMOTO" = "$TAM_LOCAL" ]   || fallo "el dump de hoy no está en el remoto o no cuadra (${TAM_REMOTO:-nada} frente a ${TAM_LOCAL} bytes)"
log "BD subida a ${DESTINO_REMOTO}/db/"

subir "${UPLOADS}/" "${DESTINO_REMOTO}/uploads/"
log "fotos subidas a ${DESTINO_REMOTO}/uploads/ ($(du -sh "$UPLOADS" | cut -f1) en origen)"

aviso
log "=== backup OK ==="
