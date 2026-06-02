import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFeatures } from '../../context/FeaturesContext.jsx';
import { PageLoading } from './LoadingSpinner.jsx';

export default function ProtectedRoute({ children, allowedRoles, requiredFeature }) {
  const { isAuthenticated, loading, hasRole } = useAuth();
  const { isFeatureEnabled } = useFeatures();
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

  if (requiredFeature && !isFeatureEnabled(requiredFeature)) {
    return <Navigate to="/mis-asignaciones" replace />;
  }

  return children;
}
