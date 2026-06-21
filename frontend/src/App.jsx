import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }         from './context/AuthContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { FeaturesProvider }     from './context/FeaturesContext.jsx';
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
import MisAsignaciones          from './pages/asignaciones/MisAsignaciones.jsx';
import { ROLES, PERMISSIONS }   from './utils/constants.js';
import SWUpdater                from './components/common/SWUpdater.jsx';

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
              <Route index element={<Navigate to="/mis-asignaciones" replace />} />
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
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_mis_trabajos">
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
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR]} requiredFeature="menu_trabajos">
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

              <Route
                path="/alertas"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.SUPERADMIN]} requiredFeature="menu_alertas">
                    <AlertsPage />
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
            <Route path="*" element={<Navigate to="/mis-asignaciones" replace />} />
          </Routes>
        </BrowserRouter>
        </FeaturesProvider>
      </AuthProvider>
    </NotificationProvider>
  );
}
