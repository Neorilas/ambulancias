#!/bin/bash
# Restaura un dump en un MySQL 8 DESECHABLE y cuenta las filas de cada tabla.
# No toca ninguna BD real: el contenedor no publica puertos ni usa volúmenes
# con nombre, y se borra al terminar pase lo que pase.
#
#   verificar-backup.sh /root/ambulancia-backups/db/ambulancia_AAAAMMDD_HHMMSS.sql.gz
#
# Sirve en el servidor (prueba mensual, docs/BACKUPS.md §4) y en local.
# Un backup que nunca se ha restaurado es una esperanza, no un backup.

set -euo pipefail

DUMP=${1:?uso: verificar-backup.sh <dump.sql.gz>}
[ -f "$DUMP" ] || { echo "no existe: $DUMP" >&2; exit 1; }

C="ambulancia-verificar-$$"
PASS="verif_$$_$RANDOM"
trap 'docker rm -f "$C" >/dev/null 2>&1 || true' EXIT

echo "Arrancando MySQL desechable ($C)…"
docker run -d --name "$C" \
  -e MYSQL_ROOT_PASSWORD="$PASS" -e MYSQL_DATABASE=verif \
  mysql:8.0 --default-time-zone=+00:00 >/dev/null

# El entrypoint arranca primero un servidor temporal SIN red (port: 0) para la
# inicialización y luego lo reinicia; «ping» respondería ya en ese primero. El
# bueno es el que anuncia el 3306.
for _ in $(seq 1 90); do
  docker logs "$C" 2>&1 | grep -q 'ready for connections.*port: 3306' && break
  sleep 2
done
docker logs "$C" 2>&1 | grep -q 'ready for connections.*port: 3306' \
  || { echo "MySQL no arrancó en 3 minutos" >&2; exit 1; }

echo "Restaurando $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))…"
gzip -dc "$DUMP" | docker exec -i -e MYSQL_PWD="$PASS" "$C" mysql -uroot verif

sql() { docker exec -e MYSQL_PWD="$PASS" "$C" mysql -uroot -N verif -e "$1"; }

echo
echo "Filas por tabla:"
for t in $(sql "SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'verif' AND table_type = 'BASE TABLE' ORDER BY table_name"); do
  printf '  %-32s %s\n' "$t" "$(sql "SELECT COUNT(*) FROM \`$t\`")"
done

echo
echo "Última migración aplicada: $(sql "SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC LIMIT 1" 2>/dev/null || echo '¿sin schema_migrations?')"
echo "Última asignación creada:  $(sql "SELECT MAX(created_at) FROM asignaciones_libres" 2>/dev/null || echo '-')"
echo
echo "OK: el dump se restaura. Compara las cifras con la app (usuarios, vehículos, asignaciones)."
