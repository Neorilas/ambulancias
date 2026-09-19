---
description: Sube a producción lo verificado en local y comprueba que el deploy ha llegado de verdad
---

Sube a producción. **Solo después de que `/verifica` haya dado verde**: si no
se ha pasado en esta misma sesión, dilo y ejecútalo antes.

Ten presente al hacerlo: el Environment `produccion` de GitHub **no tiene
required reviewers**, así que el push a `master` despliega en el acto, sin
ninguna puerta intermedia. Y produccion es la app que están usando los técnicos
en la calle.

## 1. Commit en `develop`

Comprueba que estás en `develop` (si no, dilo y para). Commit de los ficheros de
esta tarea, dejando fuera lo no relacionado, con un mensaje en el estilo del
repositorio: en español, `tipo(ámbito): qué cambia en lenguaje llano`. Y push.

## 2. Confirmación

Antes de tocar `master`, enseña al usuario:

- los commits que van a salir (`git log --oneline master..develop`),
- el resumen del veredicto de `/verifica`,
- y esta frase: «esto se despliega a producción en cuanto haga el push, sin
  aprobación».

**Espera su confirmación explícita.** Si no la da, para aquí.

## 3. Merge y push

```bash
git checkout master && git merge --no-ff develop && git push origin master
```

Vuelve a `develop` al terminar.

## 4. Seguir el deploy

`gh run list --limit 5` y `gh run watch <id>` para los workflows de backend y
frontend que dispare el push.

Ojo con dos cosas que ya han pasado:
- el deploy del backend puede salir en rojo **después** de haber desplegado
  bien (el `script_stop` de la acción de SSH); mira en qué paso muere antes de
  concluir nada;
- el frontend va por FTPS y no depende del servidor, así que puede publicar
  aunque el backend se haya quedado atrás — front nuevo contra API vieja.

## 5. Comprobar que ha llegado

```bash
curl -s https://api.vapss.net/health
```

El `commit` tiene que ser el SHA de `master`. Si no lo es, ese deploy no llegó,
aunque el workflow diga que sí. Compruébalo también en
`https://vapss.net/app/` (recarga forzada: el service worker sirve la versión
vieja hasta que se actualiza).

## 6. Cierre

Di en dos líneas qué ha salido, con qué SHA, y si algo se ha quedado a medias.
Si has tenido que hacer un hotfix desde `master`, retro-mergéalo a `develop`.
