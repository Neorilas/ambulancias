/**
 * utils/tema.js
 * Tema de la pantalla: 'claro' (el de siempre) u 'oscuro'.
 *
 * El «oscuro» NO invierte la app a fondo negro: pone el fondo en un gris suave
 * y lleva los grises del texto hacia el negro, para que se lea mejor al sol o
 * con poco brillo. Los colores salen de `index.css` (variables `--txt-*` y
 * `html[data-tema="oscuro"]`); aquí solo se decide cuál toca y se marca en
 * el <html>.
 *
 * Se guarda en localStorage con una clave SIN el prefijo de entorno de
 * `sessionStorage.js` a propósito: es una preferencia del dispositivo, no de
 * la sesión, y `limpiarEntorno()` al cerrar sesión no debe borrarla.
 */

export const CLAVE_TEMA = 'vapss:tema';
export const TEMAS = ['claro', 'oscuro'];

/** Tema guardado en este dispositivo; 'claro' si no hay o no se puede leer. */
export function leerTema() {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    return TEMAS.includes(guardado) ? guardado : 'claro';
  } catch {
    return 'claro';
  }
}

/** Pinta el tema en el <html>. El claro no deja atributo: es el CSS base. */
export function aplicarTema(tema, raiz = document.documentElement) {
  if (tema === 'oscuro') raiz.dataset.tema = 'oscuro';
  else delete raiz.dataset.tema;
}

/** Guarda y aplica. Si localStorage falla (modo privado), se aplica igual. */
export function cambiarTema(tema) {
  const valido = TEMAS.includes(tema) ? tema : 'claro';
  try { localStorage.setItem(CLAVE_TEMA, valido); } catch { /* sin persistir */ }
  aplicarTema(valido);
  return valido;
}
