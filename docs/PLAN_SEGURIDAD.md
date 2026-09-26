# Plan de seguridad — lo que queda

> Compañero de [PLAN_TRABAJO.md](PLAN_TRABAJO.md) y de la regla de [MAPA_CODIGO.md](MAPA_CODIGO.md).
> Base: `master` en `01e7102` · 2026-09-26.
>
> El detalle de los hallazgos está en `docs/AUDITORIA_SEGURIDAD.md`, que **no se
> sube al repo a propósito** (el repo es público). Aquí solo va qué hay que hacer.

---

## Cómo usar este plan

Cada tarea lleva **cuándo**, **quién**, **pasos**, **riesgo** y **cómo se da por hecha**.
Las que tocan producción pasan antes por `/verifica` y se suben con `/a-pro`. Lo que
cambie el `.htaccess` o el publicador del frontend se prueba **antes** en la carpeta
aparte del hosting (tarea P0).

| # | Tarea | Cuándo | Quién | Esfuerzo | Estado |
|---|---|---|---|---|---|
| F0 | Comprobaciones del servidor y de GitHub | Cuanto antes | Propietario | 30 min | ⏳ |
| P1 | CSP de la PWA: de «solo aviso» a obligatoria | A partir del **3-oct-2026** | Claude | S | ⏳ |
| P2 | Retirar `GET /push/estado` | A partir del **10-oct-2026** | Claude | S | ⏳ |
| P3 | Refresh token en cookie `httpOnly` (SEC-07) | Después de P1 | Claude | L | ⏳ |
| — | Lo cerrado el 2026-09-26 | — | — | — | ✅ (al final) |

---

## F0 — Comprobaciones del servidor y de GitHub (propietario)

El 2026-08-25 se rotaron las credenciales del servidor y SSH pasó a solo clave
(incidente de credenciales, ver `ESTADO_PROYECTO.md`). Esto confirma que sigue así
y que nadie entró antes. Todo es **solo lectura**.

1. **La contraseña ya no vale.** Tiene que decir `Permission denied (publickey)` sin
   llegar a pedir contraseña:
   ```bash
   ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password root@<ip-del-hetzner>
   ```
2. **Configuración de SSH en uso.** `passwordauthentication no`,
   `permitrootlogin without-password`, `kbdinteractiveauthentication no`:
   ```bash
   ssh maraya "sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication)'"
   ```
3. **Quién ha entrado desde marzo.** Cualquier `Accepted password` que no sea tuyo,
   sobre todo antes del 25-ago, es una intrusión. Los `Accepted publickey` deben ser
   tu IP y las de GitHub Actions:
   ```bash
   ssh maraya "zgrep -h 'Accepted' /var/log/auth.log* | awk '{print \$1, \$2, \$6, \$7, \$9, \$11}' | sort | uniq -c"
   ssh maraya "last -F | head -50"
   ```
4. **Nada dejado atrás.** Claves que reconozcas, un único UID 0, crons conocidos:
   ```bash
   ssh maraya "cat /root/.ssh/authorized_keys; awk -F: '\$3==0' /etc/passwd; crontab -l; ls -la /etc/cron.d"
   ```
5. **GitHub** → Settings → Code security → Secret scanning → activar
   *non-provider patterns* (lo único que detecta contraseñas genéricas).
6. **Opcional:** `DROP USER 'root'@'%';` en el MySQL de producción (root solo desde
   localhost), y aplicar las actualizaciones pendientes del sistema con reinicio, en
   una ventana sin servicios.

**Riesgo:** ninguno, es lectura (el 6 no).
**Hecho cuando:** los cuatro comandos salen limpios y el secret scanning genérico está
activo. Si algo no cuadra, parar y tratarlo como incidente.

---

## P1 — CSP de la PWA: de «solo aviso» a obligatoria

**Por qué:** la CSP es la defensa real contra un XSS que robe los tokens de
`localStorage`. Hoy va en `Content-Security-Policy-Report-Only`: avisa pero no bloquea.

**Ficheros:** `frontend/public/.htaccess` (la cabecera), `backend/src/controllers/csp.controller.js`
(recoge los avisos).

**Pasos:**
1. Leer los avisos de la última semana (salen una vez por hora cada uno):
   ```bash
   ssh maraya "docker exec ambulancia-backend sh -c \"grep -h 'CSP (report-only)' /app/logs/combined.log* | sort | uniq -c | sort -rn | head -50\""
   ```
2. Clasificar cada aviso:
   - Un origen legítimo que falta (una API, fuentes, teselas del mapa) → añadirlo a la
     directiva que diga el aviso, en el `.htaccess`.
   - Algo que no reconoces (un script de otro dominio, `eval`) → **no** abrirlo:
     averiguar de dónde sale (extensiones del navegador del usuario suelen
     aparecer aquí y se ignoran).
3. Si hubo cambios en la política, subirlos y esperar otra semana sin avisos nuevos.
4. Cuando no haya avisos legítimos pendientes: en el `.htaccess`, cambiar el nombre
   de la cabecera `Content-Security-Policy-Report-Only` → `Content-Security-Policy`
   (misma política, **mismo `report-uri`**: seguirá avisando de lo que bloquee).
5. Probarlo en la carpeta aparte del hosting (tarea P0) **con la app funcionando de
   verdad**: login, fotos con la cámara, el mapa de flota, las miniaturas de la ficha
   del vehículo y los avisos push. Cualquier cosa que no cargue es un origen que falta.
6. `/verifica` + `/a-pro`, y vigilar el log de avisos los dos días siguientes.

**Riesgo:** medio. Un origen olvidado deja de cargar en la app de los técnicos (fotos,
mapa). Vuelta atrás: devolver el nombre `-Report-Only` y subir (2 minutos).
**Hecho cuando:** `curl -sI https://vapss.net/app/ | grep -i content-security-policy:`
devuelve la cabecera obligatoria y el log no muestra bloqueos de cosas legítimas en 48 h.

---

## P2 — Retirar `GET /push/estado`

**Por qué:** la consulta de estado de los avisos pasó a `POST` (el endpoint del
dispositivo no debe viajar en la URL, que acaba en los logs). El `GET` se dejó
para las PWA que aún no se hubieran actualizado.

**Ficheros:** `backend/src/routes/push.routes.js`, `backend/src/controllers/push.controller.js`
(el `|| req.query?.endpoint`), sus tests, y la entrada `'GET /push/estado'` de `ACCESO` en
`backend/src/__tests__/integration/autorizacion-rutas.test.js`.

**Pasos:**
1. Comprobar que ya nadie lo usa (debería salir 0 o casi):
   ```bash
   ssh maraya "docker exec ambulancia-backend sh -c \"grep -hc 'GET /api/v1/push/estado' /app/logs/combined.log*\""
   ```
2. Quitar la ruta, el fallback a `req.query` y la entrada de `ACCESO` (si no se quita,
   el test de rutas falla: es lo esperado).
3. Actualizar §2.2 y §2.5 del mapa.

**Riesgo:** bajo. Una PWA sin actualizar vería «avisos desactivados» hasta recargar.
**Hecho cuando:** `curl -s -o /dev/null -w "%{http_code}" https://api.vapss.net/api/v1/push/estado`
da 404 y la sección de avisos del perfil sigue cargando.

---

## P3 — Refresh token en cookie `httpOnly` (SEC-07)

**Por qué:** hoy el access y el refresh token viven en `localStorage`, al alcance de
cualquier JavaScript de la página. Con la CSP obligatoria (P1) el riesgo baja mucho;
esto lo cierra del todo para el refresh token, que es el que dura 7 días.

**Ficheros:** `backend/src/controllers/auth.controller.js` (login, refresh, logout),
`backend/server.js` (CORS ya tiene `credentials: true`), `frontend/src/services/api.js`
(interceptor de refresh), `frontend/src/context/AuthContext.jsx`,
`frontend/src/utils/sessionStorage.js`.

**Enfoque:**
- El backend manda el refresh token en `Set-Cookie`: `HttpOnly; Secure; SameSite=Strict;
  Path=/api/v1/auth`, y deja de devolverlo en el JSON.
- La cookie la pone la API **sin atributo `Domain`**, así que es solo de su host:
  `api.vapss.net` y `api-pre.vapss.net` no se pisan aunque la PWA de los dos entornos
  viva en `vapss.net`. Si alguien le pone `Domain=vapss.net`, sí se pisarían: no hacerlo.
  `SameSite=Strict` funciona porque `vapss.net` y `api.vapss.net` son el mismo *sitio*.
- `/auth/refresh` y `/auth/logout` leen la cookie; el frontend las llama con
  `withCredentials: true`.
- CSRF: `SameSite=Strict` + comprobar la cabecera `Origin` contra `CORS_ORIGIN` en
  `/auth/refresh`.
- El access token (15 min) puede quedarse en memoria (no en `localStorage`): al recargar
  se pide uno nuevo con la cookie.
- **Transición:** durante una semana `/auth/refresh` acepta también el refresh token en
  el body, para no echar a los técnicos que tengan la sesión abierta con la versión
  vieja. Luego se quita.

**Riesgo:** alto si sale mal: técnicos deslogueados en la calle. Se prueba en local
con dos pestañas (PRE y PROD simuladas), en móvil real con la PWA instalada (Android e
iPhone: Safari trata las cookies de terceros distinto; aquí son del mismo sitio, pero
hay que verlo) y en la carpeta aparte.
**Hecho cuando:** `localStorage` ya no contiene ningún refresh token, la sesión
sobrevive a recargar y a cerrar la app, y el cierre de sesión borra la cookie.

---

## P0 — Probar en el hosting real sin tocar `/app/` (herramienta)

PRE no está montado. Para cualquier cambio del `.htaccess` o del publicador:
worktree + rama `ci/prueba-*` con un workflow temporal que construye con
`VITE_BASE_PATH=/app-prueba-csp/`, publica en esa carpeta (hermana de la de producción,
el workflow se niega con cualquier otra ruta), y la borra con un commit `[borrar]`.
Entre medias, `curl -sI` de index, una ruta profunda, `sw.js`, assets y manifest, y
abrirla en el navegador. Al acabar: desregistrar su service worker, borrar la rama y
el worktree. Se hizo tres veces el 2026-09-26 (commits de la rama ya borrados).

---

## Hábitos que se quedan

- **Una ruta nueva se clasifica** en `ACCESO` de `autorizacion-rutas.test.js`
  (`denegada` / `propia` / `controlador` / `abierta`). Sin eso los tests fallan y el
  backend no se despliega.
- **Recortes de visibilidad por lista blanca de permisos**, nunca «si es operacional,
  recorta».
- **Mensajes de commit en seco** para los arreglos de seguridad: el repo es público.
- `npm audit` alto o crítico **para el despliegue**: se arregla actualizando, no
  quitando el paso.

---

## Cerrado el 2026-09-26 (en producción)

| Qué | Commit en `master` |
|---|---|
| Avisos push: destino validado, tope de dispositivos, timeout, estado por POST | `1e7701a` |
| Flota y fotos visibles solo con permiso (usuarios sin rol) | `1e7701a` |
| Fotos de trabajo solo del propio trabajo; caché de la PWA vaciada al cerrar sesión | `1e7701a` |
| Publicación FTPS con certificado verificado; cabeceras de seguridad y CSP en aviso | `787454b` |
| Todo 403 queda en la auditoría | `787454b` |
| Tests + `npm audit` antes de desplegar; test de autorización de todas las rutas | `01e7102` |
| react-router 7 (0 vulnerabilidades en producción); `setup-db` con migraciones | `01e7102` |
| Gestor: crea y edita usuarios solo por debajo de su rol; roles normalizados | `e55f842` |
