---
description: Levanta el entorno local (MySQL + backend + frontend) y lo deja listo para probar
---

Levanta el entorno local completo. Runbook: `docs/LOCAL.md`.

1. **Docker.** Comprueba `docker info`. Si el motor no responde, **pide al
   usuario que abra Docker Desktop desde su icono del escritorio** y espera; no
   intentes lanzarlo tú (falla, está pendiente de diagnosticar).

2. **Base de datos.** `cd backend && npm run local:db`. Espera a que el
   contenedor `ambulancia-local-mysql` esté `healthy`.

3. **Backend.** Comprueba si ya responde `http://localhost:3001/health`. Si no,
   arráncalo en segundo plano: `cd backend && npm run dev`. Espera al `/health`
   y confirma que dice `"appEnv":"local"`. Si las migraciones fallan, sale en el
   log: córtalo ahí y enséñaselo al usuario.

4. **Datos.** Si no hay usuarios (`SELECT COUNT(*) FROM users`), ejecuta
   `cd backend && npm run seed:local`.

5. **Frontend.** `preview_start` con la configuración `frontend`.

Termina diciendo en dos líneas qué está levantado, con qué usuarios se entra
(`admin` / `tecnico` / `gestor`, contraseña `Local.2026`) y la URL.

Si el usuario ha pasado argumentos, son una indicación sobre qué quiere probar:
$ARGUMENTS
