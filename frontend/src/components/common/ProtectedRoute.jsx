import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageLoading } from './LoadingSpinner.jsx';

/**
 * Ruta protegida: redirige a /login si no autenticado.
 * allowedRoles: si se pasa, verifica que el usuario tenga al menos uno.
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, loading, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoading />;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const allowed = allowedRoles.some(role => hasRole(role));
    if (!allowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}
