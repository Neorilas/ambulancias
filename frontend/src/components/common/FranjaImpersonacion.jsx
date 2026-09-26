/**
 * components/common/FranjaImpersonacion.jsx
 * Aviso fijo mientras un superadmin ve la app como otro usuario.
 *
 * Va debajo del Navbar (no encima) para no pelearse con el recorte del iPhone:
 * el Navbar ya lleva el `safe-top`. No se puede cerrar: que se vea en todo
 * momento es la gracia, porque lo que se haga queda a nombre de los dos.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';

function minutosRestantes(expira) {
  return Math.max(0, Math.ceil((expira - Date.now()) / 60000));
}

export default function FranjaImpersonacion() {
  const { impersonando, terminarImpersonacion } = useAuth();
  const [minutos, setMinutos] = useState(() => impersonando ? minutosRestantes(impersonando.expira) : 0);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    if (!impersonando) return undefined;
    const t = setInterval(() => {
      const m = minutosRestantes(impersonando.expira);
      setMinutos(m);
      // Caducado: se vuelve solo, sin esperar a que una petición dé 401.
      if (m === 0) terminarImpersonacion();
    }, 30000);
    return () => clearInterval(t);
  }, [impersonando, terminarImpersonacion]);

  if (!impersonando) return null;

  const salir = async () => {
    setSaliendo(true);
    await terminarImpersonacion();
  };

  return (
    <div
      role="status"
      className="bg-amber-400 text-amber-950 safe-x"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-[13px]">
        <p className="flex-1 min-w-0">
          Estás viendo la app como{' '}
          <strong className="font-semibold">
            {impersonando.nombre} {impersonando.apellidos}
          </strong>{' '}
          <span className="font-mono text-[12px]">@{impersonando.username}</span>
          <span className="text-amber-900"> · lo que hagas queda a su nombre y al tuyo · {minutos} min</span>
        </p>
        <button
          onClick={salir}
          disabled={saliendo}
          className="px-2.5 py-1 rounded bg-amber-950 text-amber-50 text-xs font-semibold hover:bg-amber-900 disabled:opacity-60"
        >
          {saliendo ? 'Volviendo…' : 'Volver a mi sesión'}
        </button>
      </div>
    </div>
  );
}
