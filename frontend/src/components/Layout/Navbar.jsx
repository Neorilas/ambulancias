import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';

const ES_PRE = import.meta.env.VITE_APP_ENV === 'pre';

export default function Navbar({ onMenuToggle }) {
  const { user, logout, isAdmin, isGestor, canManageUsers, canManageVehicles } = useAuth();
  const { notify } = useNotification();
  const navigate   = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = async () => {
    await logout();
    notify.success('Sesión cerrada');
    navigate('/login');
  };

  const initials = user
    ? `${user.nombre?.[0] || ''}${user.apellidos?.[0] || ''}`.toUpperCase()
    : '?';

  return (
    <header className="bg-primary-600 text-white shadow-lg sticky top-0 z-30 safe-top">
      <div className="flex items-center h-12 px-4 gap-3">
        {/* Hamburger (móvil) */}
        <button
          onClick={onMenuToggle}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors lg:hidden"
          aria-label="Abrir menú"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Logo */}
        <Link to="/dashboard" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <img
            src={`${import.meta.env.BASE_URL}logo-vapss-compact.svg`}
            alt="V.A.P. Servicios Sanitarios"
            className="h-6 object-contain brightness-0 invert"
          />
        </Link>

        {/* PRE y produccion se sirven del mismo dominio y con el mismo diseño.
            Sin una marca visible es cuestión de tiempo que alguien dé por buena
            una prueba hecha contra el entorno equivocado — o al revés. */}
        {ES_PRE && (
          <span
            className="px-2 py-0.5 rounded bg-amber-400 text-amber-950 text-[11px] font-bold tracking-widest uppercase"
            title="Entorno de pruebas — los datos no son los del cliente"
          >
            Pre
          </span>
        )}

        <div className="flex-1" />

        {/* Avatar + menú usuario */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <div className="w-[26px] h-[26px] rounded-full bg-white/20 flex items-center justify-center text-[11px] font-semibold tracking-wide">
              {initials}
            </div>
            <span className="hidden sm:block text-[13px] font-medium max-w-24 truncate">
              {user?.nombre}
            </span>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-neutral-200 z-20 py-1 animate-slide-up">
                <div className="px-4 py-3 border-b border-neutral-100">
                  <p className="font-medium text-neutral-900 text-sm">{user?.nombre} {user?.apellidos}</p>
                  <p className="text-xs text-neutral-500 mt-0.5 font-mono">@{user?.username}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {user?.roles?.map(r => (
                      <span key={r} className="badge-gray">{r}</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  className="w-full px-4 py-2.5 text-left text-sm text-bad-600 hover:bg-bad-50"
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
