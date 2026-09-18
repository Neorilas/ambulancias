---
description: Batería completa de verificación en local — tests, migraciones desde cero, revisión del diff y prueba funcional con agente
---

Verifica en local el cambio que hay en el árbol de trabajo. Es la puerta que
hay que pasar antes de subir nada a producción: en este proyecto PRE no está
operativo, así que **esto es el único filtro real**.

Ve informando de cada bloque según termine, y **no sigas al siguiente si el
anterior ha fallado**: para y cuéntaselo al usuario.

## 1. Qué ha cambiado

`git status` y `git diff` (más `git diff master...HEAD` si la rama ya tiene
commits). Resume en dos líneas qué toca el cambio: backend, frontend, esquema,
o varias. De eso depende lo que hay que probar después.

## 2. Tests

```bash
cd backend && npm test
```

```bash
cd frontend && npm test
```

Los dos tienen que pasar enteros. Si el cambio toca el backend y no hay ningún
test nuevo que lo cubra, dilo — el backend no ejecuta tests en el deploy, así
que lo que no se compruebe aquí no se comprueba en ninguna parte.

## 3. Migraciones desde cero (solo si el cambio toca el esquema)

Si hay cambios en `database/` o en `backend/src/config/migrations.js`:

```bash
cd backend && npm run local:reset
```

Reinicia el backend, espera al `/health`, y comprueba en la base que las
migraciones han entrado todas y ninguna ha fallado:

```bash
docker exec ambulancia-local-mysql mysql -uambulancia_local -plocal_dev ambulancia_local -e "SELECT name, applied_at FROM schema_migrations ORDER BY applied_at;"
```

Recuerda la trampa: una migración nueva que solo esté como `.sql` en
`/database` y no en el array `MIGRATIONS` **no llega a ningún entorno**.
Después del reset, vuelve a sembrar: `npm run seed:local`.

## 4. Revisión del código

Lanza el agente `code-reviewer` sobre el diff.

## 5. Prueba funcional

Asegúrate de que el stack está en pie (si no, ejecuta `/local`) y lanza el
agente `probador-local`, describiéndole qué ha cambiado para que se centre ahí
además del recorrido de siempre.

## 6. Veredicto

Una tabla corta: bloque, resultado, y qué ha fallado si algo ha fallado.
Termina con una de estas dos frases, sin adornos:

- **«Listo para subir a producción»** — solo si todo ha pasado.
- **«No subir: <motivo>»** — con lo que hay que arreglar.

Si el usuario ha pasado argumentos, indican en qué fijarse especialmente:
$ARGUMENTS
