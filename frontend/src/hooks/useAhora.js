import { useEffect, useState } from 'react';

/**
 * La hora actual, refrescada cada `cadaMs`. Para lo que depende del reloj y
 * tiene que cambiar solo en pantalla sin recargar — p. ej. el botón «Inicio de
 * servicio», que se habilita al llegar la media hora previa.
 */
export default function useAhora(cadaMs = 30000) {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}
