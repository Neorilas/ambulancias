# Backups

> Estado a 2026-09-30: **los scripts están en el repo, sin instalar en el
> servidor, y la retención (§8) está apagada.** Hasta que se instalen, ambulancia no tiene ninguna copia: ni de
> la BD ni de las fotos. Lo que hay en el cron del Hetzner
> (`maraya-pg-backup`) es de otro proyecto y no la toca.
>
> **El destino es Google Drive, cifrado con rclone**, desde el 2026-09-30. El
> plan original era un Storage Box de Hetzner, descartado porque no se puede
> contratar nada de pago. Drive gratis (15 GB) da para unos 3 años al ritmo
> actual (§3); lo que se pierde frente al Storage Box está en §2.1.

## 1. Qué se copia y dónde

| Qué | Cómo | En el servidor | Fuera (Drive, cifrado) |
|---|---|---|---|
| BD MySQL (`mysql_data`) | `mysqldump` comprimido, diario 02:00 UTC (04:00 en España en verano, 03:00 en invierno) | `/root/ambulancia-backups/db/`, 14 días | `<destino>/db/`, no se borra nunca |
| Fotos (`uploads_data`) | `rclone copy`, solo las nuevas | — | `<destino>/uploads/`, **sin** borrado |
| Logs (`logs_data`) | no se copian | — | — |
| `.env` del servidor | **a mano**, una vez y cada vez que cambie (§2.5) | — | en un gestor de contraseñas, no en Drive |
| Código, frontend | no hace falta: se reconstruyen desde git | — | — |

Ficheros en `scripts/backup/`:

- `backup-ambulancia.sh`: el backup. Comprueba el dump antes de darlo por
  bueno: gzip íntegro, termina en «Dump completed» y tiene tantas tablas como
  la BD viva.
- `verificar-backup.sh`: restaura un dump en un MySQL **desechable** y cuenta
  filas. No toca ninguna BD real.
- `ambulancia-backup.conf.ejemplo`: la configuración, que va en `/etc/ambulancia-backup.conf`.
- `ambulancia-backup.cron`: la entrada de cron, que va en `/etc/cron.d/ambulancia-backup`.
- La configuración de rclone (token de Google y contraseñas del cifrado) **no
  está en el repo**: se crea en el servidor (§2.1), en `/etc/ambulancia-rclone.conf`.

Códigos de salida del backup: `0` todo copiado y subido; `1` fallo (el log
dice dónde); `2` BD copiada en local pero **sin copia externa**. Un 2 no es un
éxito.

## 2. Instalación (una vez)

Todo esto se hace en el Hetzner (`ssh maraya`) como root.

### 2.1 Destino fuera del servidor: Google Drive, cifrado con rclone

Por qué fuera: una copia en el mismo disco no sobrevive a perder el disco ni a
que alguien entre como root, y el root de este servidor estuvo expuesto en el
repo público.

Por qué cifrado: los dumps llevan los datos personales de toda la plantilla y
los hashes de las contraseñas. rclone cifra antes de subir (remoto de tipo
`crypt`): en Drive solo hay ficheros y carpetas con nombres ilegibles, y sin
las dos contraseñas del cifrado no los lee nadie, tampoco Google.

**Lo que se pierde frente al Storage Box, y cómo se compensa.** El Storage Box
tenía snapshots que el servidor no podía tocar. Aquí no: quien entre como root
tiene el token de Drive y puede borrar la copia. La papelera de Drive guarda lo
borrado 30 días, pero ese mismo token puede vaciarla. Por eso hace falta una
segunda copia que el servidor no alcance: **una vez por semana, descargar el
dump más reciente desde `/admin` → Backups (§9) y guardarlo en el PC**, en un
disco cifrado (BitLocker).

1. **Una cuenta de Google nueva, solo para esto** (nunca la personal ni la de
   la empresa): contraseña larga y verificación en dos pasos, las dos cosas en
   el gestor de contraseñas. Así los 15 GB son enteros para el backup y, si se
   filtra el token del servidor, no se expone nada más.
2. **rclone en el servidor y en el PC.** El PC solo hace falta una vez, para
   dar el permiso de Google, porque el servidor no tiene navegador:
   ```bash
   apt-get install -y rclone && rclone version          # en el servidor
   ```
   ```powershell
   winget install Rclone.Rclone                          # en el PC
   ```
3. **Crear el remoto de Drive**, en el servidor:
   ```bash
   rclone config --config /etc/ambulancia-rclone.conf
   ```
   - `n` (nuevo remoto) → nombre **`ambulancia-drive`** → tipo `drive`.
   - `client_id` y `client_secret`: vacíos (se usa el de rclone; ver §7).
   - `scope`: **`drive.file`**. rclone solo ve lo que ha creado él, no el resto
     del Drive de esa cuenta.
   - `service_account_file`: vacío. Configuración avanzada: `n`.
   - «Use web browser to automatically authenticate?»: **`n`**. rclone escribe
     un comando `rclone authorize "drive" "…"`: se copia **entero**, se ejecuta
     en el PC, se entra con la cuenta del paso 1 y se acepta. El PC imprime un
     token, que se pega en el servidor.
   - Shared Drive: `n`. Confirmar con `y`.
4. **Crear el remoto cifrado**, en la misma sesión de `rclone config`:
   - `n` → nombre **`ambulancia-cifrado`** → tipo `crypt`.
   - `remote`: **`ambulancia-drive:ambulancia-backups`**.
   - `filename_encryption`: `standard`. `directory_name_encryption`: `true`.
   - Contraseña: `g` (generar), 256 bits. La segunda (salt): `g` también.
   - **Antes de confirmar, copiar al gestor de contraseñas las dos que
     enseña.** Sin ellas la copia no se puede leer nunca más, aunque el Drive
     siga intacto.
   - Confirmar con `y` y salir con `q`.
5. **Comprobar:**
   ```bash
   chmod 600 /etc/ambulancia-rclone.conf
   rclone --config /etc/ambulancia-rclone.conf mkdir ambulancia-cifrado:ambulancia
   rclone --config /etc/ambulancia-rclone.conf about ambulancia-drive:
   ```
   `about` tiene que dar unos 15 GB en total. En drive.google.com, con la
   cuenta del backup, aparece la carpeta `ambulancia-backups` y dentro una
   carpeta de nombre ilegible: es `ambulancia`, cifrada.

### 2.2 Scripts

Desde el PC, en la raíz del repo:

```bash
scp scripts/backup/backup-ambulancia.sh scripts/backup/verificar-backup.sh scripts/backup/ambulancia-backup.conf.ejemplo scripts/backup/ambulancia-backup.cron maraya:/tmp/
```

En el servidor:

```bash
install -m 700 /tmp/backup-ambulancia.sh /tmp/verificar-backup.sh /usr/local/sbin/
install -m 600 /tmp/ambulancia-backup.conf.ejemplo /etc/ambulancia-backup.conf
nano /etc/ambulancia-backup.conf      # DESTINO_REMOTO=ambulancia-cifrado:ambulancia (ya viene así)
which rclone flock || apt-get install -y rclone util-linux
```

### 2.3 Primera ejecución a mano

```bash
/usr/local/sbin/backup-ambulancia.sh; echo "exit=$?"
```

Tiene que acabar en `=== backup OK ===` y `exit=0`. La primera vez sube todas
las fotos y puede tardar (Drive acepta pocos ficheros por segundo); las
siguientes solo suben las nuevas.

### 2.4 Activar el cron

```bash
install -m 644 /tmp/ambulancia-backup.cron /etc/cron.d/ambulancia-backup
```

### 2.5 El `.env`

Sin `/root/ambulancia/.env` una copia de la BD no basta para levantar el
sistema en otra máquina: faltan las claves JWT, las VAPID (sin ellas, todos los
avisos push dejan de valer) y las de Cartrack. Se guarda **a mano** en el gestor
de contraseñas, no en Drive ni en el repo (que es público):

```bash
ssh maraya "cat /root/ambulancia/.env"
```

Repetirlo cada vez que se toque el `.env`.

En el mismo gestor, junto al `.env`: **las dos contraseñas del cifrado** (§2.1
paso 4) y el usuario y la contraseña de la cuenta de Google. El token de Drive
no hace falta guardarlo: en un servidor nuevo se pide otro.

## 3. Vigilar que funciona

Un backup que falla en silencio es peor que ninguno, porque se confía en él.

- **Log:** `tail -20 /var/log/ambulancia-backup.log`. Una línea `backup OK`
  por día; cualquier `ERROR` o `AVISO` hay que mirarlo.
- **Aviso automático (recomendado):** crear un check en healthchecks.io (gratis),
  periodo 1 día y gracia 2 h, y poner su URL en `AVISO_URL`. Si un día el backup
  falla **o no llega a ejecutarse**, llega un correo. Sin esto, solo se sabe
  mirando el log.
- **Espacio en Drive:** `rclone --config /etc/ambulancia-rclone.conf about ambulancia-drive:`.
  Son 15 GB y el remoto solo crece (§7). Al ritmo medido en septiembre de 2026
  (~47 fotos al día de ~177 KB: unos 3 GB al año, más los dumps) dan para unos
  3 años. Al pasar de 12 GB hay que decidir: pagar más espacio o borrar a mano
  los dumps diarios antiguos, dejando uno por mes. Si se llena, el backup
  falla y el log lo dice.

## 4. Prueba de restauración (mensual)

En el servidor, contra el dump más reciente. Levanta un MySQL aparte, no
publica puertos y se borra al acabar:

```bash
/usr/local/sbin/verificar-backup.sh "$(ls -t /root/ambulancia-backups/db/*.sql.gz | head -1)"
```

Sale la lista de tablas con sus filas, la última migración y la última
asignación. Las cifras tienen que cuadrar con lo que se ve en la app.

Las fotos, una muestra desde Drive (rclone las enseña ya descifradas):

```bash
rclone --config /etc/ambulancia-rclone.conf ls ambulancia-cifrado:ambulancia/uploads/vehicles | tail
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
# Si solo está en Drive:
#   rclone --config /etc/ambulancia-rclone.conf copy ambulancia-cifrado:ambulancia/db/<fichero> /root/

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
rclone --config /etc/ambulancia-rclone.conf copy ambulancia-cifrado:ambulancia/uploads/ "$UPLOADS/"
docker exec -u 0 ambulancia-backend chown -R appuser:appgroup /app/uploads
```

El `chown` no es opcional: lo que baja de Drive llega como root, y el
backend corre como `appuser`. Sin él, verá las fotos antiguas pero no podrá
escribir las nuevas en esas carpetas.

### 5.3 Servidor nuevo desde cero

Instalar Docker, clonar el despliegue según [`ENTORNOS.md`](ENTORNOS.md),
restaurar el `.env` desde el gestor de contraseñas, `docker compose up -d`
(crea la BD vacía), y después §5.1 y §5.2. Para bajar de Drive hay que rehacer
antes `/etc/ambulancia-rclone.conf` como en §2.1, con una diferencia: en el
remoto cifrado, en vez de `g`, se escriben (`y`) **las dos contraseñas del
gestor**. Con otras, rclone no ve ningún fichero. Caddy y el DNS de `api.vapss.net`
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
- **En el remoto no se borra nunca nada, a propósito, y ahora obligatorio.**
  Se sube con `rclone copy --ignore-existing`: sube lo que falta y no toca lo
  que ya está. Si se borra una foto en el servidor, por error o por un ataque,
  sigue en la copia. Y con la retención encendida (§8), Drive es **el único
  sitio** donde quedan las asignaciones purgadas. **Nunca `rclone sync`**: deja
  el remoto igual que el servidor, o sea, borra en Drive todo lo purgado. El
  precio es que el remoto solo crece (§3).
- **`DESTINO_REMOTO` es el remoto cifrado (`ambulancia-cifrado:`), nunca
  `ambulancia-drive:`.** Con el de Drive a pelo todo funciona igual, sin un
  solo error, y los datos personales quedan en claro en Google.
- **El script comprueba que el dump de hoy ha llegado**, comparando su tamaño
  en Drive con el local (rclone da el tamaño ya descifrado). Un `rclone copy`
  que acaba bien sin haber subido nada no pasa desapercibido.
- **rclone reescribe `/etc/ambulancia-rclone.conf`** cada vez que renueva el
  token de Google: tiene que ser de root con 600, no de solo lectura.
- **Si algún día se usa un `client_id` propio de Google** (el de rclone es
  compartido y tiene cupo, pero para 50 ficheros al día sobra), la app de
  Google Cloud tiene que estar «en producción», no «en pruebas». En pruebas el
  token caduca a los 7 días, y el backup empieza a fallar una semana después
  de instalarlo.
- **No tocar la carpeta `ambulancia-backups` desde la web de Drive.** Los
  nombres están cifrados: un fichero movido o renombrado a mano deja de
  existir para rclone.
- **Las limpiezas de Docker del servidor no tocan volúmenes.**
  `/root/docker-cleanup.sh` lleva `--volumes=false` y
  `/usr/local/sbin/docker-cleanup.sh` solo borra caché e imágenes huérfanas. Si
  alguien añade un `prune --volumes`, se lleva los datos de cualquier stack que
  esté parado en ese momento.

## 8. Retención: el servidor purga, Drive archiva

Para que el disco del servidor no se llene, el backend borra las asignaciones
**cerradas hace más de N meses** con todo lo suyo
([`retencion.service.js`](../backend/src/services/retencion.service.js)). El
motivo es el espacio, no la protección de datos: lo purgado sigue en
Drive.

| Se purga | Se queda |
|---|---|
| Asignaciones finalizadas o canceladas cuyo cierre es anterior al corte | Asignaciones programadas o activas, sean de cuando sean |
| Asignaciones con borrado lógico hace más de N meses | Usuarios y vehículos |
| Sus fotos: la fila de `vehicle_images` **y** el fichero | Incidencias: son del vehículo; solo pierden el enlace a la asignación |
| Sus miembros (`asignacion_usuarios`) | El **total** de la ficha del vehículo: suma `vehicles.asignaciones_purgadas` (v27) |

**Antes de purgar se archiva el informe mensual.** La pantalla de Informes
calcula cada mes a partir de sus asignaciones; en cuanto se purga una, ese
cálculo miente. Por eso cada pasada guarda primero en `informe_mensual` el
informe de cada mes que va a tocar y que aún no esté guardado
(`informes.service.archivarMeses`). **Si no puede guardarlo, esa pasada no purga
nada**: el log dice «no se pudo archivar el informe mensual; no se purga nada».
Detalle en `MAPA_CODIGO.md` §2.7.

Cada pasada deja una línea en `audit_logs` (`action = 'purga_retencion'`) con
las ids purgadas, para que quien busque una asignación que ya no está vea que
la borró la retención y no una persona.

**Encenderla**, solo cuando el backup de §2 lleve días en verde, porque sin él
lo purgado se pierde del todo:

```bash
echo "RETENCION_ASIGNACIONES_MESES=9" >> /root/ambulancia/.env
cd /root/ambulancia && docker compose up -d backend
docker compose logs backend | grep "Retención"
```

El log de arranque dice «Retención de asignaciones: se purgan las cerradas hace
más de 9 meses». Si dice «apagada», la variable no ha llegado al contenedor.
Corre al arrancar y cada 6 h, y como mucho 1000 asignaciones por pasada: el
primer día que se encienda con atraso tardará unas pocas pasadas.

**Recuperar una asignación purgada** (una reclamación por un golpe, por
ejemplo):

- Las fotos están en `<destino>/uploads/`, con el mismo nombre que tenían.
- Los datos de la asignación están en cualquier dump de `<destino>/db/` de
  antes de la purga. Se restaura en un MySQL desechable con
  `CONSERVAR=1 verificar-backup.sh <dump>`, que deja el contenedor vivo y dice
  cómo entrar, o en local (§6), y se consulta ahí. No se reinyecta en producción: el contador del
  vehículo ya la cuenta.

**Trampas:**

- **Borrar la asignación no borra sus fotos.** La FK de
  `vehicle_images.asignacion_id` es `SET NULL`: sin el borrado explícito de
  `purgarUna` quedarían huérfanas en la BD y en disco. Una tabla nueva que
  cuelgue de `asignaciones_libres` sin `CASCADE` hay que añadirla ahí.
- **El cierre de una cancelada es su `updated_at`**, porque `finalizado_at`
  solo lo pone la finalización. Una cerrada ya no se puede editar, así que no se
  mueve; si una migración masiva lo tocara, la purga solo se retrasaría.
- **Las asignaciones de un trabajo (v33) esperan a que el coordinador lo
  cierre**: mientras siga abierto (por ejemplo, pendiente de cierre durante
  meses) no se purgan, porque sin sus ambulancias el trabajo no se podría
  cerrar nunca. Cuando se purga la última de un trabajo cerrado (o borrado),
  `purgarUna` borra también el trabajo, en la misma transacción; la auditoría
  `purga_retencion` lo apunta en `details.trabajos`.
- **La variable tiene que estar en el `environment` de `docker-compose.yml`**,
  y ya lo está, con valor por defecto 0. Si se quita de ahí, el `.env` deja de
  llegar al contenedor y la retención se apaga sin avisar.

## 9. Descargar un dump desde la app (superadmin)

En `/admin` → **Backups** están los dumps de la BD de los últimos 14 días, con
un botón para descargar cada uno. Es la salida de emergencia si se pierde el
Hetzner **y** Drive a la vez: un dump basta para reconstruir la BD
entera en otro servidor (§5.3). Las fotos **no** van ahí: son GB y viven en el
Drive.

Cómo llega el fichero a la app:

- `backup-ambulancia.sh` escribe en `/root/ambulancia-backups/db` (host).
- `docker-compose.yml` monta esa carpeta en `/app/backups`, **solo lectura**.
  El backend solo lista y sirve ([`backups.controller.js`](../backend/src/controllers/backups.controller.js)).
- El script da permiso de lectura **al grupo del backend** (`chgrp` con el gid
  que tiene `appuser` dentro del contenedor, 750 la carpeta y 640 los dumps).
  Sin eso, el backend no podría leerlos: los dumps son de root con 600.

Seguridad:

- Solo superadmin, y nunca viendo la app como otro usuario.
- **Pide otra vez la contraseña** (desde 2026-10-04). Como mucho 5 intentos
  fallidos cada 15 minutos (las descargas buenas no cuentan). Así un token robado o un fallo de XSS no bastan para
  sacar la BD entera.
- Cada descarga manda un **aviso push a todos los superadmin** con quién ha
  bajado qué fichero, para enterarse en el momento y no al revisar la auditoría.
- El nombre se valida contra un patrón cerrado (`<stack>_AAAAMMDD_HHMMSS.sql.gz`):
  no se puede pedir otro fichero ni salir de la carpeta.
- Cada descarga queda en la auditoría como «Descargó un backup de la BD», con
  el fichero y su tamaño.
- Se sirve con `Cache-Control: no-store`, y el service worker solo cachea dos
  listados concretos: el dump no se queda en el navegador.
- **Lo descargado lleva los datos personales de toda la plantilla y los hashes
  de las contraseñas.** Se guarda cifrado y no se reenvía.

Si la pestaña dice «No hay backups disponibles»:

| Motivo en pantalla | Qué pasa |
|---|---|
| «La carpeta de backups no existe» | El backup diario no está instalado (§2) |
| «No tiene permiso para leer» | La carpeta no tiene el grupo del backend: `/usr/local/sbin/backup-ambulancia.sh` lo arregla en su siguiente pasada; o a mano, `chgrp $(docker exec ambulancia-backend id -g) /root/ambulancia-backups/db && chmod 750 /root/ambulancia-backups/db` |
| «Todavía no ha generado ninguna copia» | Instalado, pero aún no ha corrido el cron (02:00 UTC) |

**Trampa:** si Docker arranca el backend antes de que exista la carpeta, la crea
él vacía y de root. No pasa nada: el script la usa igual y le pone los permisos
en su primera pasada.
