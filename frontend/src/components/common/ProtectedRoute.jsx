import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFeatures } from '../../context/FeaturesContext.jsx';
import { PageLoading } from './LoadingSpinner.jsx';

export default function ProtectedRoute({ children, allowedRoles, requiredFeature }) {
  const { isAuthenticated, loading, hasRole } = useAuth();
  const { isFeatureEnabled, loading: cargandoFlags } = useFeatures();
  const location = useLocation();

  if (loading) return <PageLoading />;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const allowed = allowedRoles.some(role => hasRole(role));
    if (!allowed) {
      return <Navigate to="/mis-asignaciones" replace />;
    }
  }

  // Una lista de flags vale con que esté encendido cualquiera de ellos.
  // Hay que esperar a que lleguen: decidir con la lista aún vacía echaba a
  // /mis-asignaciones a quien recargaba (o abría un enlace a) una pantalla
  // con flag, aunque estuviera encendido.
  const flags = [].concat(requiredFeature || []);
  if (flags.length && cargandoFlags) return <PageLoading />;
  if (flags.length && !flags.some(f => isFeatureEnabled(f))) {
    return <Navigate to="/mis-asignaciones" replace />;
  }

  return children;
}
