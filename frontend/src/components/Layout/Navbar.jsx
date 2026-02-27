import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';

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
      <div className="flex items-center h-14 px-4 gap-3">
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
            src="https://vapss.net/wp-content/uploads/2024/12/cropped-cropped-vapss-banner-2.webp"
            alt="VAPSS"
            className="h-7 object-contain"
            onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='inline'; }}
          />
          <span className="hidden">VAPSS</span>
        </Link>

        <div className="flex-1" />

        {/* Avatar + menú usuario */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
              {initials}
            </div>
            <span className="hidden sm:block text-sm font-medium max-w-24 truncate">
              {user?.nombre}
            </span>
            <svg className="w-4 h-4 opacity-70" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-neutral-100 z-20 py-1 animate-slide-up">
                <div className="px-4 py-3 border-b border-neutral-100">
                  <p className="font-medium text-neutral-900 text-sm">{user?.nombre} {user?.apellidos}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">@{user?.username}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {user?.roles?.map(r => (
                      <span key={r} className="badge-gray text-xs">{r}</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
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
