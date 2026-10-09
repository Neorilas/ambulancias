import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }         from './context/AuthContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { FeaturesProvider, useFeatures } from './context/FeaturesContext.jsx';
import ProtectedRoute           from './components/common/ProtectedRoute.jsx';
import Layout                   from './components/Layout/Layout.jsx';
import Login                    from './pages/Login.jsx';
import Dashboard                from './pages/Dashboard.jsx';
import UserList                 from './pages/users/UserList.jsx';
import VehicleList              from './pages/vehicles/VehicleList.jsx';
import VehicleHistory           from './pages/vehicles/VehicleHistory.jsx';
import TrabajoList              from './pages/trabajos/TrabajoList.jsx';
import TrabajoDetail            from './pages/trabajos/TrabajoDetail.jsx';
import MisTrabajos              from './pages/MisTrabajos.jsx';
import AdminPanel               from './pages/AdminPanel.jsx';
import AlertsPage               from './pages/AlertsPage.jsx';
import AsignacionList           from './pages/asignaciones/AsignacionList.jsx';
import MapaFlota                from './pages/flota/MapaFlota.jsx';
import Informes                 from './pages/informes/Informes.jsx';
import MisAsignaciones          from './pages/asignaciones/MisAsignaciones.jsx';
import Perfil                   from './pages/Perfil.jsx';
import { ROLES, PERMISSIONS }   from './utils/constants.js';
import SWUpdater                from './components/common/SWUpdater.jsx';
import { PageLoading }          from './components/common/LoadingSpinner.jsx';

// Facturas va en su propio fichero y fuera del precache de la PWA
// (vite.config.js, globIgnores): su código solo lo descarga quien la abre, que
// solo puede ser administración. El resto ni la tiene en el móvil.
const Facturas = lazy(() => import('./pages/facturas/Facturas.jsx'));

/**
 * La portada: «Mis trabajos» en cuanto Trabajos esté encendido para todos
 * (D7 del plan del trabajo padre, fase 7); hasta entonces, «Mis asignaciones».
 * Se mira la lista REAL de flags y no isFeatureEnabled, que al superadmin le
 * dice que sí a todo y le cambiaría la portada antes que a nadie.
 */
function PortadaInicio() {
  const { features, loading } = useFeatures();
  if (loading) return <PageLoading />;
  return <Navigate to={features.includes('menu_mis_trabajos') ? '/mis-trabajos' : '/mis-asignaciones'} replace />;
}

export default function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <FeaturesProvider>
        <SWUpdater />
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Routes>
            {/* Pública */}
            <Route path="/login" element={<Login />} />

            {/* Protegidas - con layout */}
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<PortadaInicio />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_dashboard">
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mis-trabajos"
                element={
                  // Cualquiera: responsables y equipo de un trabajo son
                  // personal de campo. Qué trabajos ve cada uno lo filtra el
                  // backend (§6.2 del mapa).
                  <ProtectedRoute requiredFeature="menu_mis_trabajos">
                    <MisTrabajos />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/trabajos"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_trabajos">
                    <TrabajoList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/trabajos/:id"
                element={
                  // Se llega desde el listado de gestión (menu_trabajos) o
                  // desde «Mis trabajos» (menu_mis_trabajos). El backend da 403
                  // a quien no va en el trabajo y recorta lo que no le toca.
                  <ProtectedRoute requiredFeature={['menu_trabajos', 'menu_mis_trabajos']}>
                    <TrabajoDetail />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/vehiculos"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_vehiculos">
                    <VehicleList />
                  </ProtectedRoute>
                }
              />
              {/* Ficha del vehículo: mismo componente, la pestaña inicial es el resumen */}
              <Route
                path="/vehiculos/:id"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_vehiculos">
                    <VehicleHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/vehiculos/:id/historial"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_vehiculos">
                    <VehicleHistory />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/usuarios"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_usuarios">
                    <UserList />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/asignaciones"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_asignaciones">
                    <AsignacionList />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/mis-asignaciones"
                element={
                  <ProtectedRoute requiredFeature="menu_mis_asignaciones">
                    <MisAsignaciones />
                  </ProtectedRoute>
                }
              />

              {/* Perfil propio: cualquiera autenticado, sin feature flag. Es
                  donde se activan los avisos push del dispositivo. */}
              <Route
                path="/perfil"
                element={
                  <ProtectedRoute>
                    <Perfil />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/alertas"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN]} requiredFeature="menu_alertas">
                    <AlertsPage />
                  </ProtectedRoute>
                }
              />

              {/* Informes para administración. Solo admin y superadmin: lleva
                  el desglose nominal por técnico. Quien manda es el backend
                  (routes/informes.routes.js); el flag solo pone el menú. */}
              <Route
                path="/informes"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN]} requiredFeature="menu_informes">
                    <Informes />
                  </ProtectedRoute>
                }
              />

              {/* Facturas de proveedores. Solo admin y superadmin, y OCULTA para
                  el resto: a quien no lo es, ProtectedRoute lo manda a la
                  portada, igual que el `*` de abajo con una ruta que no
                  existe; el backend le contesta 404 (ocultarSalvoRoles) y
                  ni le enseña el flag. */}
              <Route
                path="/facturas"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN]} requiredFeature="menu_facturas">
                    <Suspense fallback={<PageLoading />}><Facturas /></Suspense>
                  </ProtectedRoute>
                }
              />

              {/* Mapa de flota (Cartrack).
                  Superadmin siempre; administradores solo con `menu_flota`
                  encendido desde /admin. Aquí eso sale gratis porque
                  `isFeatureEnabled` ya le da true al superadmin: el flag no
                  sirve para ocultarle la pantalla, sirve para ABRÍRSELA a los
                  administradores.

                  Gestores no, aunque sí vean /vehiculos: esto enseña dónde
                  está cada vehículo en tiempo casi real y, con él, la persona
                  que lo conduce. Quien manda es el backend
                  (routes/flota.routes.js, que comprueba rol Y flag); la
                  guardia de aquí es comodidad, no seguridad. */}
              <Route
                path="/flota"
                element={
                  <ProtectedRoute
                    allowedRoles={[ROLES.SUPERADMIN, ROLES.ADMINISTRADOR]}
                    requiredFeature="menu_flota"
                  >
                    <MapaFlota />
                  </ProtectedRoute>
                }
              />

              {/* Panel superadmin */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.SUPERADMIN]}>
                    <AdminPanel />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<PortadaInicio />} />
          </Routes>
        </BrowserRouter>
        </FeaturesProvider>
      </AuthProvider>
    </NotificationProvider>
  );
}
