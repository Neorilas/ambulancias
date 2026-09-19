---
description: Levanta el entorno local (MySQL + backend + frontend) y lo deja listo para probar
---

Levanta el entorno local completo. Runbook: `docs/LOCAL.md`.

1. **Docker.** Comprueba `docker ps`. Si falla con
   `open //./pipe/dockerDesktopLinuxEngine`, el motor está parado: arráncalo tú
   con la herramienta PowerShell y espera, sin pedírselo al usuario.

   ```
   Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
   ```

   Luego espera en bucle a que `docker ps` conteste (cada 3 s, hasta 2 min).
   Medido el 18/09/2026: la tubería aparece a los ~5 s y el motor contesta a los
   ~10 s. El error solo significa «todavía no», no «ha fallado»: no concluyas
   nada hasta agotar la espera.

2. **Base de datos.** `cd backend && npm run local:db`.

   Hace falta **siempre** después de arrancar Docker: al cerrar Docker Desktop
   los contenedores mueren con exit 137 y no vuelven solos, ni con el
   `restart: unless-stopped`. Los datos sí sobreviven, están en el volumen.

   Espera a que `ambulancia-local-mysql` esté `healthy`.

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
