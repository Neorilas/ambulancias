/**
 * pages/Perfil.jsx
 * Ficha del usuario que ha iniciado sesión.
 *
 * Nació para alojar «Avisos en este dispositivo», que es lo único que aquí se
 * puede cambiar: los datos personales los gestiona administración desde
 * Usuarios. Por eso el resto de la página es de solo lectura.
 */

import React from 'react';
import { useAuth }      from '../context/AuthContext.jsx';
import AvisosPush       from '../components/common/AvisosPush.jsx';

export default function Perfil() {
  const { user } = useAuth();

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-[19px] font-semibold text-neutral-900">Mi perfil</h1>
        <p className="text-neutral-500 text-sm">
          Datos de tu cuenta y avisos de este dispositivo
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="text-[15px] font-semibold text-neutral-900">Cuenta</h2>
        </div>

        <div className="kv-row">
          <div>
            <span className="kv-k">Nombre</span>
            <span className="kv-v">{user?.nombre} {user?.apellidos}</span>
          </div>
          <div>
            <span className="kv-k">Usuario</span>
            <span className="kv-v data">@{user?.username}</span>
          </div>
          {user?.email && (
            <div>
              <span className="kv-k">Correo</span>
              <span className="kv-v">{user.email}</span>
            </div>
          )}
          {user?.telefono && (
            <div>
              <span className="kv-k">Teléfono</span>
              <span className="kv-v data">{user.telefono}</span>
            </div>
          )}
        </div>

        <div className="mt-3.5">
          <span className="kv-k">Roles</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {user?.roles?.length
              ? user.roles.map(r => <span key={r} className="badge-gray">{r}</span>)
              : <span className="text-[13px] text-neutral-400">Sin roles asignados</span>}
          </div>
        </div>

        <p className="hint mt-3.5">
          Para cambiar tus datos o tu contraseña, habla con administración.
        </p>
      </section>

      {/* Para todos: los técnicos reciben el aviso de «nuevo servicio». */}
      <AvisosPush />
    </div>
  );
}
