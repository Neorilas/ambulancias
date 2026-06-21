import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFeatures } from '../../context/FeaturesContext.jsx';

function NavItem({ to, icon, label, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all
         ${isActive
           ? 'bg-primary-600 text-white shadow-sm'
           : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
         }`
      }
    >
      <span className="text-lg">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ isOpen, onClose }) {
  const { canManageUsers, canManageVehicles, canManageTrabajos, isAdmin, isSuperAdmin, canAccessGestion } = useAuth();
  const { isFeatureEnabled } = useFeatures();

  const closeOnMobile = () => {
    if (window.innerWidth < 1024) onClose?.();
  };

  // Usuarios sin acceso de gestión (todo lo que no sea admin/superadmin/gestor)
  // solo pueden ver su lista de vehículos asignados.
  const privileged = canAccessGestion();

  return (
    <>
      {/* Overlay para móvil */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Panel lateral */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-white border-r border-neutral-100 z-30
                    flex flex-col pt-14 transition-transform duration-300 ease-out
                    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0 lg:static lg:z-auto lg:pt-0`}
      >
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {!privileged ? (
            /* Roles operativos / sin rol: única opción permitida */
            <NavItem to="/mis-asignaciones" icon="🔑" label="Mis Asignaciones" onClick={closeOnMobile} />
          ) : (
            <>
              {isFeatureEnabled('menu_dashboard') && (
                <NavItem to="/dashboard" icon="📊" label="Dashboard" end onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_mis_trabajos') && (
                <NavItem to="/mis-trabajos" icon="📋" label="Mis Trabajos" onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_mis_asignaciones') && (
                <NavItem to="/mis-asignaciones" icon="🔑" label="Mis Asignaciones" onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_trabajos') && (
                <NavItem to="/trabajos" icon="🚑" label="Trabajos" onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_asignaciones') && canManageTrabajos() && (
                <NavItem to="/asignaciones" icon="🚐" label="Asignaciones" onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_vehiculos') && canManageVehicles() && (
                <NavItem to="/vehiculos" icon="🚗" label="Vehículos" onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_usuarios') && canManageUsers() && (
                <NavItem to="/usuarios" icon="👥" label="Usuarios" onClick={closeOnMobile} />
              )}

              {isFeatureEnabled('menu_alertas') && (isAdmin() || isSuperAdmin()) && (
                <NavItem to="/alertas" icon="🔔" label="Alertas" onClick={closeOnMobile} />
              )}

              {isSuperAdmin() && (
                <NavItem to="/admin" icon="🛡️" label="Superadmin" onClick={closeOnMobile} />
              )}
            </>
          )}
        </nav>

        {/* Footer del sidebar */}
        <div className="p-4 border-t border-neutral-100">
          <p className="text-xs text-neutral-400 text-center">
            VAPSS · V.A.P Servicios Sanitarios<br />v1.0.0
          </p>
        </div>
      </aside>
    </>
  );
}
