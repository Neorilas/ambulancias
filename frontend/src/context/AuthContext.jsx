import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/auth.service.js';
import { ROLES, PERMISSIONS } from '../utils/constants.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser  = localStorage.getItem('user');
    const accessToken = localStorage.getItem('accessToken');
    if (storedUser && accessToken) {
      try { setUser(JSON.parse(storedUser)); }
      catch { localStorage.clear(); }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await authService.login(username, password);
    localStorage.setItem('accessToken',  data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user',         JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    await authService.logout(refreshToken);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  const updateStoredUser = useCallback((updates) => {
    setUser(prev => {
      const updated = { ...prev, ...updates };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Helpers de rol ────────────────────────────────────────────
  const hasRole      = useCallback((role) => user?.roles?.includes(role) || false, [user]);
  const isSuperAdmin = useCallback(() => hasRole(ROLES.SUPERADMIN),    [hasRole]);
  const isAdmin      = useCallback(() => hasRole(ROLES.ADMINISTRADOR), [hasRole]);
  const isGestor     = useCallback(() => hasRole(ROLES.GESTOR),        [hasRole]);
  const isOperacional = useCallback(() =>
    hasRole(ROLES.TECNICO) || hasRole(ROLES.ENFERMERO) || hasRole(ROLES.MEDICO),
    [hasRole]
  );

  // ── Helper de permiso ─────────────────────────────────────────
  // El superadmin bypassa todos los permisos (igual que en el backend).
  const hasPermission = useCallback((perm) => {
    if (!user) return false;
    if (isSuperAdmin()) return true;
    return user.permissions?.includes(perm) || false;
  }, [user, isSuperAdmin]);

  // ── Helpers de conveniencia (delegados a hasPermission) ───────
  const canManageUsers    = useCallback(() => hasPermission(PERMISSIONS.MANAGE_USERS),    [hasPermission]);
  const canManageVehicles = useCallback(() => hasPermission(PERMISSIONS.MANAGE_VEHICLES), [hasPermission]);
  const canManageTrabajos = useCallback(() => hasPermission(PERMISSIONS.MANAGE_TRABAJOS), [hasPermission]);
  const canDeleteAny      = useCallback(() => isAdmin() || isSuperAdmin(),                [isAdmin, isSuperAdmin]);

  const value = {
    user, loading,
    login, logout, updateStoredUser,
    hasRole, hasPermission,
    isSuperAdmin, isAdmin, isGestor, isOperacional,
    canManageUsers, canManageVehicles, canManageTrabajos, canDeleteAny,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
};
