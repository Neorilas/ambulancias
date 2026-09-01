import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFeatures } from '../../context/FeaturesContext.jsx';

function NavItem({ to, label, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `block px-[18px] py-[7px] text-[13.5px] font-medium border-l-2 transition-colors
         ${isActive
           ? 'bg-primary-50 text-primary-700 border-primary-600 font-semibold'
           : 'text-neutral-600 border-transparent hover:bg-neutral-100 hover:text-neutral-900'
         }`
      }
    >
      {label}
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

  // Menú declarativo: cada grupo se oculta entero si se queda sin items,
  // así los permisos y los feature flags nunca dejan un título huérfano.
  const groups = privileged
    ? [
        {
          label: null,
          items: [
            { to: '/dashboard', label: 'Dashboard', end: true, show: isFeatureEnabled('menu_dashboard') },
          ],
        },
        {
          label: 'Operación',
          items: [
            { to: '/mis-asignaciones', label: 'Mis asignaciones', show: isFeatureEnabled('menu_mis_asignaciones') },
            { to: '/mis-trabajos',     label: 'Mis trabajos',     show: isFeatureEnabled('menu_mis_trabajos') },
          ],
        },
        {
          label: 'Flota',
          items: [
            { to: '/vehiculos',    label: 'Vehículos',    show: isFeatureEnabled('menu_vehiculos') && canManageVehicles() },
            { to: '/asignaciones', label: 'Asignaciones', show: isFeatureEnabled('menu_asignaciones') && canManageTrabajos() },
            { to: '/trabajos',     label: 'Trabajos',     show: isFeatureEnabled('menu_trabajos') },
          ],
        },
        {
          label: 'Administración',
          items: [
            { to: '/usuarios', label: 'Usuarios',   show: isFeatureEnabled('menu_usuarios') && canManageUsers() },
            { to: '/alertas',  label: 'Alertas',    show: isFeatureEnabled('menu_alertas') && (isAdmin() || isSuperAdmin()) },
            { to: '/admin',    label: 'Superadmin', show: isSuperAdmin() },
          ],
        },
      ]
    : [
        {
          label: null,
          items: [{ to: '/mis-asignaciones', label: 'Mis asignaciones', show: true }],
        },
      ];

  const visibleGroups = groups
    .map(g => ({ ...g, items: g.items.filter(i => i.show) }))
    .filter(g => g.items.length > 0);

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
        className={`fixed top-0 left-0 h-full w-56 bg-white border-r border-neutral-200 z-30
                    flex flex-col pt-12 transition-transform duration-300 ease-out
                    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0 lg:static lg:z-auto lg:pt-0`}
      >
        <nav className="flex-1 py-3.5 overflow-y-auto">
          {visibleGroups.map((group, gi) => (
            <div key={group.label ?? `g${gi}`}>
              {group.label && (
                <p className="micro px-[18px] pt-3.5 pb-1.5">{group.label}</p>
              )}
              {group.items.map(item => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  end={item.end}
                  onClick={closeOnMobile}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* Footer del sidebar */}
        <div className="px-[18px] py-3.5 border-t border-neutral-100">
          <p className="text-[11px] leading-relaxed text-neutral-400">
            V.A.P Servicios Sanitarios<br />v1.0.0
          </p>
        </div>
      </aside>
    </>
  );
}
