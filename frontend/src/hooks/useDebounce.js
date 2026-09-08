import { useEffect, useState } from 'react';

/**
 * Retrasa la propagación de un valor hasta que deja de cambiar.
 *
 * Los buscadores lanzaban una petición por tecla: escribir "ambulancia" en la
 * lista de vehículos eran 10 llamadas a la API para ver un único resultado.
 * Con esto sólo sale la búsqueda que el usuario ha terminado de escribir.
 *
 * @param {*} valor      valor que cambia con cada pulsación
 * @param {number} ms    silencio necesario antes de propagarlo
 */
export function useDebounce(valor, ms = 400) {
  const [retrasado, setRetrasado] = useState(valor);

  useEffect(() => {
    const t = setTimeout(() => setRetrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);

  return retrasado;
}

export default useDebounce;
