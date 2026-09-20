# Instrucciones del proyecto

## Antes de buscar nada: el mapa

**`docs/MAPA_CODIGO.md` se lee SIEMPRE antes de abrir ficheros o lanzar
búsquedas.** Es el índice de dónde está cada cosa y cómo se conecta: rutas →
controlador, página → servicio → endpoint, tablas, permisos, migraciones,
entornos, y la tabla «si cambias X toca Y» (§8).

El orden es este y no otro:

1. **Leer el mapa.** Empezar por el §8 y por la sección del área que se toca.
2. **Solo si el mapa no responde**, buscar en el repo (grep, exploración).
3. **Al terminar, actualizar el mapa** en el mismo commit que el cambio.

**No se lanza una búsqueda amplia «por si acaso» en paralelo a leer el mapa.**
Si el mapa ya ha respondido, esa búsqueda es tiempo y tokens tirados —
exactamente lo que el fichero existe para evitar. Si el mapa no responde o se
ha quedado viejo, se busca, y entonces la corrección del mapa forma parte de la
tarea.

Si el mapa contradice al código, manda el código: se corrige el mapa.

## Al terminar: documentar

**Todo cambio de lógica o de funcionalidad se documenta en
`docs/MAPA_CODIGO.md`, en el mismo commit que lo introduce.** La regla completa
—qué entra, qué no, y qué hacer cuando da para más de un párrafo— está en
`docs/README.md` → «Regla de documentación».

Lo que más valor tiene ahí no es el inventario de ficheros, que lo saca
cualquiera con un grep, sino **los porqués y las trampas**: lo que no se deduce
leyendo el código es justo lo que hace falta dentro de seis meses.

## Git

Puede haber **más de una sesión trabajando sobre este mismo árbol** a la vez.
Por eso:

- **Nunca `git add -A`.** Stagear los ficheros por nombre, o se cuelan los
  cambios sin commitear de la otra sesión.
- Antes de un merge a `master`, comprobar `git log --oneline master..develop`
  **justo antes** del merge, no minutos antes, y avisar si hay commits ajenos.
  `master` despliega a producción en el acto, sin aprobación.
