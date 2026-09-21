# Plan: avisos push sonoros a administradores

Estado: PLAN (nada implementado). Fecha: 2026-09-20.

## Objetivo

Que los teléfonos de los administradores suenen cuando una asignación:

1. se **activa** (cron o botón manual),
2. tiene completas las **fotos de inicio**,
3. se **finaliza** (esto incluye las fotos de fin: un solo aviso).

Basta con el sonido genérico de notificación del teléfono. Tecnología: Web Push
estándar (VAPID) sobre la PWA existente. Sin app nativa ni Firebase.

## Decisiones

- **Destinatarios:** todo usuario con permiso `MANAGE_TRABAJOS` o rol
  administrador, calculado en cada envío (nada de lista fija). Ojo con los roles
  no excluyentes (un admin que además es técnico). El técnico responsable de la
  asignación no recibe nada.
- **Alcance:** solo asignaciones. Trabajos quedan fuera hasta que se pida.
- **Sonido:** cada aviso se envía con `silent: false` y `vibrate`. Suena salvo
  que el móvil esté en silencio o en «No molestar». Con Web Push no se puede
  forzar más.
- **Ubicación del botón «Activar avisos»:** en el **perfil** del usuario.
- **Fallos:** un aviso que falla nunca rompe la petición. `try/catch` + log, sin
  reintentos.

## Fase 1 — Backend (~1 día)

1. Migración `vNN_push_subscriptions.sql` **registrada en `MIGRATIONS`** (el
   `.sql` suelto no basta).
   - Columnas: `id`, `user_id`, `endpoint` (único), `p256dh`, `auth`,
     `user_agent`, `created_at`, `last_ok_at`.
2. Dependencia `web-push` y claves VAPID.
   - Generar una vez: `npx web-push generate-vapid-keys`.
   - Variables de entorno en PRE y PRO. **Nunca en el repo** (es público).
     Añadir a `.env.example` y al workflow de deploy. Guardar copia en un
     gestor de contraseñas: si se pierden, todas las suscripciones dejan de valer.
3. `push.service.js`:
   - `notificarAdmins({ titulo, cuerpo, url, tag })`: localiza admins con
     permiso y envía a cada suscripción.
   - Borra la suscripción si el envío devuelve 404 o 410.
   - `tag` distinto por asignación y evento para no apilar duplicados.
4. Rutas:
   - `GET /push/vapid-public-key`
   - `POST /push/subscribe` (solo usuarios con permiso de admin)
   - `DELETE /push/subscribe`
   - `POST /push/test` (aviso de prueba a uno mismo)
   - Rate limit **por usuario**, no por IP.

## Fase 2 — Disparadores (~0,5 día)

- **Cron `autoActivar`** (`backend/server.js`): hoy hace un `UPDATE` masivo sin
  saber qué filas cambia. Hacer antes un `SELECT` de los ids con
  `estado='programada' AND fecha_inicio <= ?`, actualizar por esos ids y avisar
  de cada una. Así no se repite ni se pierde ningún aviso.
- **`activarAsignacion`** (`asignaciones.controller.js`): avisar solo si no
  estaba ya `activa` (el endpoint es idempotente; pulsar dos veces no debe
  volver a sonar).
- **`uploadEvidencia`**: avisar cuando `getProgreso` pasa de incompleto a
  completo en `inicio`. Comparar antes y después de guardar. Rehacer una foto
  no avisa.
- **`finalizarAsignacion`**: avisar tras la transacción. Sustituye al aviso de
  «fotos de fin completas» (que no se manda por separado).
- **Texto:** alias/matrícula del vehículo, nombre del técnico y evento.
  Ej.: «Ambulancia X · Fulano ha finalizado el servicio con fotos».
- Ninguna fecha con `NOW()`: el instante lo pone Node.

## Fase 3 — Service worker (~0,5-1 día)

1. `frontend/vite.config.js`: pasar de `generateSW` a
   `strategies: 'injectManifest'` (`srcDir`, `filename: 'sw.js'`).
2. Crear `src/sw.js`:
   - `precacheAndRoute(self.__WB_MANIFEST)`.
   - Portar los dos `runtimeCaching` actuales (`api-cache`, `images-cache`).
   - Handler `push`: `showNotification` con `silent:false`,
     `vibrate:[200,100,200]`, `tag`, `renotify:true`, icono.
   - Handler `notificationclick`: abrir o enfocar la ficha de la asignación.
3. Mantener `registerType: 'autoUpdate'`.
4. Comprobar que `sw.js` se sirve **sin caché** (bloques `FilesMatch` del
   `.htaccess`: en Apache gana el último bloque que encaja).

## Fase 4 — Perfil del usuario (~0,5 día)

- Sección «Avisos en este dispositivo» en la página de perfil, visible solo para
  quien tenga permiso de admin. Estados:
  - Desactivado (botón «Activar avisos»).
  - Activo (botón «Desactivar» y «Enviar aviso de prueba»).
  - Bloqueado por el navegador (instrucciones para desbloquear).
  - iPhone sin instalar: explicar que hay que añadir la app a la pantalla de
    inicio (iOS 16.4 o superior).
- El permiso del navegador se pide solo tras un clic.
- Verificación de que los admins tienen avisos activos: mostrar en el listado de
  usuarios (o panel admin) cuántos dispositivos suscritos tiene cada admin.
- Estilo: diseño v2, sin emoji.

## Fase 5 — Pruebas (~1 día)

- **Backend (Jest, `web-push` mockeado):** un aviso por evento; sin repetición
  en un segundo `activar`; sin aviso al rehacer una foto; borrado de suscripción
  con 410; un fallo de push no rompe la respuesta; el técnico responsable no
  recibe. Usar `query.mockReset()`, no solo `clearAllMocks`.
- **Frontend:** estados del componente de perfil.
- **Local:** service worker, suscripción y aviso de prueba en Chrome de escritorio.
- **PRE con móviles reales:** Android e iPhone (PWA instalada). Un escenario por
  evento y un caso con el móvil bloqueado. Sin esto no se da por cerrado.

## Despliegue

1. `develop` → PRE con claves VAPID de PRE.
2. Comprobar en PRE que suena en un Android y en un iPhone.
3. Cargar las claves VAPID de PRO **antes** de subir a PRO. Revisar
   `master..develop` antes del merge.
4. `/a-pro` y comprobar que el deploy llegó (`/health` dice qué commit corre y
   `sw.js` nuevo servido sin caché).
5. Cada admin abre la app y pulsa «Activar avisos» en su perfil.

## Riesgos

- **iPhone:** sin la PWA instalada no llega nada.
- **Silencio / No molestar:** no suena; el plan no lo puede evitar.
- **Ahorro de batería en Android:** algunos fabricantes retrasan los avisos.
  Se comprueba en las pruebas.
- **Pérdida de claves VAPID:** invalida todas las suscripciones.
- **Frontend en otro hosting:** subida manual; si `sw.js` se cachea, los móviles
  siguen con el viejo.

## Estimación total

Unos 3,5-4 días, incluidas las pruebas en móviles reales.

## Al implementar

Actualizar `docs/MAPA_CODIGO.md` (rutas `/push`, `push.service.js`, tabla nueva,
`sw.js`, sección del perfil).

---

# Apéndice · «Llega tarde» y «suena flojo» (2026-09-20)

Lo primero que se vio al probarlo en un Android con la PWA instalada: el primer
aviso llegó y los siguientes no, y cuando sonaba se oía bajísimo. Son dos
problemas distintos y se arreglan en sitios distintos.

## 1. Llega tarde o no llega — sí era código

`web-push` manda los avisos con `urgency: normal` si no se le dice otra cosa, y
con esa urgencia FCM **acumula** el mensaje mientras el teléfono está en reposo
(Doze) y lo entrega en la siguiente ventana de mantenimiento. El primer aviso
pilla el móvil despierto y llega; los de después se quedan aparcados. Desde
`push.service.js` ahora todo sale con:

- `urgency: 'high'` — despierta el dispositivo. Es lo que corresponde a un aviso
  que exige atención de una persona.
- `TTL` de una hora — más allá, un aviso de servicio ya no informa de nada.
- `topic` derivado del tag — si queda un aviso del mismo suceso sin entregar, el
  nuevo lo sustituye en vez de encolarse detrás.

Y el aviso de prueba pasa a llevar **tag fijo** (`test-<userId>`): con un tag
distinto por envío las pruebas se apilaban en la bandeja y Android dejaba de
alertar de las siguientes.

## 2. Suena flojo — esto NO es código

**Una web no puede elegir el tono ni subir el volumen.** En Android eso lo
decide el canal de notificaciones del sistema, y sólo una app nativa puede crear
canales con su propio sonido. `Notification.sound` no la implementa ningún
navegador.

La buena noticia es que con la PWA **instalada** (WebAPK) Android le da a VAPSS
su propia entrada en los ajustes, con su propio canal. Ahí el usuario sí puede
dejarla igual que WhatsApp:

1. Ajustes → Aplicaciones → **VAPSS** → Notificaciones → la categoría de avisos.
2. Comportamiento: **Urgente** («mostrar en pantalla y hacer sonido»).
3. Sonido: el tono que se quiera, incluido el de WhatsApp.
4. Excepción de «No molestar», si se quiere que suene siempre.
5. Ajustes → Aplicaciones → **Chrome** → Batería → **Sin restricciones** (y lo
   mismo en VAPSS). Es Chrome, no la app instalada, quien recibe el push y
   ejecuta el service worker: con Chrome dormido los avisos solo aparecen al
   abrir la app. En Samsung, además, sacar a Chrome de las «aplicaciones en
   suspensión»; en Xiaomi/Huawei, activarle el inicio automático; y no cerrar
   Chrome deslizándolo desde recientes.

Sin instalar, los avisos cuelgan de Chrome (Ajustes → Chrome → Notificaciones →
Sitios) y comparten tono con todas las demás webs: ahí no hay nada que hacer.

Estas instrucciones están dentro de la app, en el perfil, bajo «¿Suena demasiado
flojo o llega tarde?» (`AvisosPush` → `AjustesDelTelefono`), que es donde las va
a buscar quien tenga el problema.

## 3. iPhone — otras reglas

Apple no da las mismas palancas, así que las instrucciones son distintas y la
app enseña unas u otras según el dispositivo (`AvisosPush` → `AjustesIPhone` /
`AjustesAndroid`).

Requisito previo: **iOS 16.4 o superior y la PWA añadida a la pantalla de
inicio desde Safari**. En una pestaña de Safari no llega nada, por mucho que se
pulse «Activar avisos».

Que suene y se vea — Ajustes → Notificaciones → VAPSS: activar **Sonidos** y
Globos, marcar Pantalla bloqueada + Centro de notificaciones + Tiras, y poner el
estilo de tira en **Persistente**.

Que no lleguen tarde:

- Ajustes → Notificaciones → **Resumen programado**: quitar VAPSS de la lista.
  El resumen retiene los avisos y los entrega todos juntos más tarde, que es
  exactamente lo contrario de lo que se busca aquí.
- Ajustes → Modos de concentración: añadir VAPSS a las apps permitidas.
- El modo de bajo consumo también retrasa la entrega.

Volumen: en iPhone el aviso suena al volumen del **timbre** (Ajustes → Sonidos y
vibraciones), no al de multimedia. Y el interruptor físico de silencio manda.

**Lo que en iPhone NO se puede hacer, ni desde el código ni desde los ajustes:**
poner un tono propio. iOS usa siempre el sonido de aviso del sistema para las
apps web; no hay selector de sonido como en Android. Tampoco hay avisos
«urgentes» (time sensitive): eso requiere una app nativa.

Gotcha: si se borra el icono de la pantalla de inicio y se vuelve a añadir, la
suscripción se pierde y hay que pulsar «Activar avisos» otra vez.

## Si aun así no suena

Por orden, porque cada paso descarta una capa:

1. El toast de «Enviar aviso de prueba» dice a cuántos dispositivos ha salido.
   Si dice 0, el problema está en la suscripción, no en el teléfono.
2. ¿Aparece el aviso en la bandeja aunque sea en silencio? Entonces es el canal
   (punto 2 de arriba), no la entrega.
3. ¿Aparece «Esta web se ha actualizado en segundo plano»? El dispositivo tiene
   un service worker viejo: desinstalar la PWA y volver a instalarla.
