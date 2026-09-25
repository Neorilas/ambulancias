import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar  from './Navbar.jsx';
import Sidebar from './Sidebar.jsx';
import ToastContainer from '../common/Toast.jsx';
import InstallPWAButton from '../common/InstallPWAButton.jsx';
import VehicleExpirationAlerts from '../common/VehicleExpirationAlerts.jsx';
import AlarmaSinIniciar from '../common/AlarmaSinIniciar.jsx';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col h-dvh">
      <Navbar onMenuToggle={() => setSidebarOpen(v => !v)} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Contenido principal */}
        <main className="flex-1 overflow-y-auto bg-neutral-50 safe-x">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-[calc(5rem+var(--safe-bottom))]">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer />

      {/* Alertas flotantes de caducidad de documentos (solo admin) */}
      <VehicleExpirationAlerts />

      {/* Alarma sonora: servicio sin iniciar pasada su hora (solo gestión) */}
      <AlarmaSinIniciar />

      {/* Botón flotante instalar PWA (solo si no está instalada) */}
      <InstallPWAButton variant="float" />
    </div>
  );
}
