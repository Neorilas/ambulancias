# Backups

> Estado a 2026-09-26: **los scripts están en el repo, sin instalar en el
> servidor.** Hasta que se instalen, ambulancia no tiene ninguna copia: ni de
> la BD ni de las fotos. Lo que hay en el cron del Hetzner
> (`maraya-pg-backup`) es de otro proyecto y no la toca.

## 1. Qué se copia y dónde

| Qué | Cómo | En el servidor | Fuera (Storage Box) |
|---|---|---|---|
| BD MySQL (`mysql_data`) | `mysqldump` comprimido, diario 03:45 UTC | `/root/ambulancia-backups/db/`, 14 días | `<destino>/db/`, no se borra nunca |
| Fotos (`uploads_data`) | `rsync` incremental | — | `<destino>/uploads/`, espejo **sin** borrado |
| Logs (`logs_data`) | no se copian | — | — |
| `.env` del servidor | **a mano**, una vez y cada vez que cambie (§2.5) | — | en un gestor de contraseñas, no en el Storage Box |
| Código, frontend | no hace falta: se reconstruyen desde git | — | — |

Ficheros en `scripts/backup/`:

- `backup-ambulancia.sh`: el backup. Comprueba el dump antes de darlo por
  bueno: gzip íntegro, termina en «Dump completed» y tiene tantas tablas como
  la BD viva.
- `verificar-backup.sh`: restaura un dump en un MySQL **desechable** y cuenta
  filas. No toca ninguna BD real.
- `ambulancia-backup.conf.ejemplo`: la configuración, que va en `/etc/ambulancia-backup.conf`.
- `ambulancia-backup.cron`: la entrada de cron, que va en `/etc/cron.d/ambulancia-backup`.

Códigos de salida del backup: `0` todo copiado y subido; `1` fallo (el log
dice dónde); `2` BD copiada en local pero **sin copia externa**. Un 2 no es un
éxito.

## 2. Instalación (una vez)

Todo esto se hace en el Hetzner (`ssh maraya`) como root.

### 2.1 Destino fuera del servidor: Storage Box de Hetzner

Por qué fuera: una copia en el mismo disco no sobrevive a perder el disco ni a
que alguien entre como root, y el root de este servidor estuvo expuesto en el
repo público.

1. En la consola de Hetzner: contratar un Storage Box (el más pequeño basta).
   Activar **SSH/rsync** y los **snapshots automáticos** (por ejemplo, diario
   con 30 de retención). Los snapshots son la protección de verdad: aunque
   alguien con la clave del servidor borre o cifre la copia, el snapshot no lo
   puede tocar desde SSH.
2. Crear una **subcuenta** con directorio base propio (p. ej. `ambulancia`), para
   que la clave del servidor solo vea esa carpeta. Anotar usuario
   (`uXXXXXX-subN`) y host (`uXXXXXX.your-storagebox.de`).
3. En el servidor, una clave solo para esto, y dársela al Storage Box:
   ```bash
   ssh-keygen -t ed25519 -N "" -f /root/.ssh/ambulancia_backup -C "ambulancia-backup@maraya"
   ssh-keyscan -p 23 uXXXXXX.your-storagebox.de >> /root/.ssh/known_hosts
   ssh-copy-id -p 23 -s -i /root/.ssh/ambulancia_backup.pub uXXXXXX-subN@uXXXXXX.your-storagebox.de
   ```
   (`-s` porque el Storage Box solo habla SFTP para esto; pedirá la contraseña
   de la subcuenta una vez).
4. Crear la carpeta destino (rsync crea `db/` y `uploads/`, pero no el padre):
   ```bash
   echo "mkdir ambulancia" | sftp -P 23 -i /root/.ssh/ambulancia_backup uXXXXXX-subN@uXXXXXX.your-storagebox.de
   ```

### 2.2 Scripts

Desde el PC, en la raíz del repo:

```bash
scp scripts/backup/backup-ambulancia.sh scripts/backup/verificar-backup.sh scripts/backup/ambulancia-backup.conf.ejemplo scripts/backup/ambulancia-backup.cron maraya:/tmp/
```

En el servidor:

```bash
install -m 700 /tmp/backup-ambulancia.sh /tmp/verificar-backup.sh /usr/local/sbin/
install -m 600 /tmp/ambulancia-backup.conf.ejemplo /etc/ambulancia-backup.conf
nano /etc/ambulancia-backup.conf      # DESTINO_REMOTO=uXXXXXX-subN@uXXXXXX.your-storagebox.de:ambulancia
which rsync flock || apt-get install -y rsync util-linux
```

### 2.3 Primera ejecución a mano

```bash
/usr/local/sbin/backup-ambulancia.sh; echo "exit=$?"
```

Tiene que acabar en `=== backup OK ===` y `exit=0`. La primera vez sube todas
las fotos y puede tardar; las siguientes solo suben las nuevas.

### 2.4 Activar el cron

```bash
install -m 644 /tmp/ambulancia-backup.cron /etc/cron.d/ambulancia-backup
```

### 2.5 El `.env`

Sin `/root/ambulancia/.env` una copia de la BD no basta para levantar el
sistema en otra máquina: faltan las claves JWT, las VAPID (sin ellas, todos los
avisos push dejan de valer) y las de Cartrack. Se guarda **a mano** en el gestor
de contraseñas, no en el Storage Box ni en el repo (que es público):

```bash
ssh maraya "cat /root/ambulancia/.env"
```

Repetirlo cada vez que se toque el `.env`.

## 3. Vigilar que funciona

Un backup que falla en silencio es peor que ninguno, porque se confía en él.

- **Log:** `tail -20 /var/log/ambulancia-backup.log`. Una línea `backup OK`
  por día; cualquier `ERROR` o `AVISO` hay que mirarlo.
- **Aviso automático (recomendado):** crear un check en healthchecks.io (gratis),
  periodo 1 día y gracia 2 h, y poner su URL en `AVISO_URL`. Si un día el backup
  falla **o no llega a ejecutarse**, llega un correo. Sin esto, solo se sabe
  mirando el log.

## 4. Prueba de restauración (mensual)

En el servidor, contra el dump más reciente. Levanta un MySQL aparte, no
publica puertos y se borra al acabar:

```bash
/usr/local/sbin/verificar-backup.sh "$(ls -t /root/ambulancia-backups/db/*.sql.gz | head -1)"
```

Sale la lista de tablas con sus filas, la última migración y la última
asignación. Las cifras tienen que cuadrar con lo que se ve en la app.

Las fotos, una muestra desde el Storage Box:

```bash
ssh -p 23 -i /root/.ssh/ambulancia_backup uXXXXXX-subN@uXXXXXX.your-storagebox.de ls -la ambulancia/uploads/vehicles | tail
```

## 5. Restaurar en producción

**Antes de nada, hacer una copia del estado actual**, aunque esté roto: si la
restauración sale mal, es lo único que queda.

```bash
/usr/local/sbin/backup-ambulancia.sh     # o, si no hay remoto, al menos deja el dump local
```

### 5.1 La base de datos

```bash
cd /root/ambulancia
DUMP=/root/ambulancia-backups/db/ambulancia_AAAAMMDD_HHMMSS.sql.gz   # el elegido
# Si solo está en el Storage Box:
#   rsync -e "ssh -p 23 -i /root/.ssh/ambulancia_backup" uXXXXXX-subN@uXXXXXX.your-storagebox.de:ambulancia/db/<fichero> /root/

docker compose stop backend              # que nadie escriba a mitad
gunzip -c "$DUMP" | docker exec -i ambulancia-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$MYSQL_DATABASE"'
docker compose start backend
docker compose exec -T backend wget -qO- http://localhost:3001/health
```

- El dump borra y recrea cada tabla que contiene (`DROP TABLE IF EXISTS`), pero
  no toca las tablas que no están en él.
- Si el dump es de antes de una migración, el backend la vuelve a aplicar al
  arrancar ([`migrations.js`](../backend/src/config/migrations.js)), igual que en
  un deploy. Mirar el log por si sale «Migración FALLIDA».
- Todo lo que pasó entre el dump y ahora se pierde (hasta 24 h). Hay que
  avisar a los técnicos.

### 5.2 Las fotos

```bash
UPLOADS=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Source}}{{end}}{{end}}' ambulancia-backend)
rsync -a -e "ssh -p 23 -i /root/.ssh/ambulancia_backup" uXXXXXX-subN@uXXXXXX.your-storagebox.de:ambulancia/uploads/ "$UPLOADS/"
docker exec -u 0 ambulancia-backend chown -R appuser:appgroup /app/uploads
```

El `chown` no es opcional: lo que baja del Storage Box llega como root, y el
backend corre como `appuser`. Sin él, verá las fotos antiguas pero no podrá
escribir las nuevas en esas carpetas.

### 5.3 Servidor nuevo desde cero

Instalar Docker, clonar el despliegue según [`ENTORNOS.md`](ENTORNOS.md),
restaurar el `.env` desde el gestor de contraseñas, `docker compose up -d`
(crea la BD vacía), y después §5.1 y §5.2. Caddy y el DNS de `api.vapss.net`
van aparte.

## 6. Restaurar en local (para probar o investigar)

Lleva datos personales de la plantilla: se borra al acabar.

```bash
gunzip -c ambulancia_AAAAMMDD_HHMMSS.sql.gz \
  | sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' \
  | docker exec -i -e MYSQL_PWD=local_root ambulancia-local-mysql mysql -uroot ambulancia_local
```

El `sed` quita los `DEFINER` de vistas y eventos: apuntan al usuario MySQL de
producción, que en local no existe, y las vistas fallarían al consultarlas. En
el servidor (§5.1) no hace falta.

## 7. Trampas

- **`| grep -q` sobre un `gzip -dc` con `pipefail` da falsos fallos.** `grep`
  corta en cuanto encuentra, `gzip` recibe SIGPIPE y la tubería «falla». Le pasa
  al backup de maraya un día de cada diez. Aquí se mira con `tail`, que lee
  hasta el final.
- **mysqldump como root del contenedor**, no con el usuario de la app. Sin el
  privilegio `PROCESS` protesta, y el usuario de la app no lo tiene. La
  contraseña va por `MYSQL_PWD` dentro del contenedor para que no salga en `ps`.
- **La ruta de las fotos se le pregunta al contenedor** (`docker inspect`), no
  se adivina: el nombre del volumen depende de `COMPOSE_PROJECT_NAME`.
- **Sin `--delete` en el remoto, a propósito.** Si se borra una foto en el
  servidor, por error o por un ataque, sigue en la copia. El precio es que el
  remoto solo crece, pero con las fotos ya comprimidas por Sharp es poco.
- **Las limpiezas de Docker del servidor no tocan volúmenes.**
  `/root/docker-cleanup.sh` lleva `--volumes=false` y
  `/usr/local/sbin/docker-cleanup.sh` solo borra caché e imágenes huérfanas. Si
  alguien añade un `prune --volumes`, se lleva los datos de cualquier stack que
  esté parado en ese momento.
