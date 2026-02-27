import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }         from './context/AuthContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import ProtectedRoute           from './components/common/ProtectedRoute.jsx';
import Layout                   from './components/Layout/Layout.jsx';
import Login                    from './pages/Login.jsx';
import Dashboard                from './pages/Dashboard.jsx';
import UserList                 from './pages/users/UserList.jsx';
import VehicleList              from './pages/vehicles/VehicleList.jsx';
import TrabajoList              from './pages/trabajos/TrabajoList.jsx';
import TrabajoDetail            from './pages/trabajos/TrabajoDetail.jsx';
import MisTrabajos              from './pages/MisTrabajos.jsx';
import { ROLES }                from './utils/constants.js';

export default function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
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
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard"    element={<Dashboard />} />
              <Route path="/mis-trabajos" element={<MisTrabajos />} />
              <Route path="/trabajos"     element={<TrabajoList />} />
              <Route path="/trabajos/:id" element={<TrabajoDetail />} />

              {/* Vehículos - admin o gestor */}
              <Route
                path="/vehiculos"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.GESTOR]}>
                    <VehicleList />
                  </ProtectedRoute>
                }
              />

              {/* Usuarios - admin o gestor */}
              <Route
                path="/usuarios"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRADOR, ROLES.GESTOR]}>
                    <UserList />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}
