import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/auth.service.js';
import { ROLES, PERMISSIONS } from '../utils/constants.js';
import { getItem, setItem, removeItem, clear as clearSesion } from '../utils/sessionStorage.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser  = getItem('user');
    const accessToken = getItem('accessToken');
    if (!storedUser || !accessToken) {
      setLoading(false);
      return;
    }

    try { setUser(JSON.parse(storedUser)); }
    catch { clearSesion(); setLoading(false); return; }
    setLoading(false);

    // Revalidar contra el servidor: roles y permisos pueden haber cambiado
    // desde el login, y las sesiones abiertas antes de que /auth/me devolviera
    // `permissions` tienen el usuario guardado sin ellos. Si falla se mantiene
    // lo almacenado (el interceptor de api.js ya cierra sesión ante un 401).
    Promise.resolve(authService.me?.())
      .then(fresh => {
        if (!fresh?.id) return;
        setUser(prev => {
          const updated = { ...prev, ...fresh };
          setItem('user', JSON.stringify(updated));
          return updated;
        });
      })
      .catch(() => { /* sesión offline o token caducado: no bloquea la app */ });
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await authService.login(username, password);
    setItem('accessToken',  data.accessToken);
    setItem('refreshToken', data.refreshToken);
    setItem('user',         JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getItem('refreshToken');
    await authService.logout(refreshToken);
    removeItem('accessToken');
    removeItem('refreshToken');
    removeItem('user');
    setUser(null);
  }, []);

  const updateStoredUser = useCallback((updates) => {
    setUser(prev => {
      const updated = { ...prev, ...updates };
      setItem('user', JSON.stringify(updated));
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

  // Solo admin, superadmin y gestor acceden a algo más que "Mis Asignaciones".
  // El resto de roles (técnico/enfermero/médico) y los usuarios sin rol quedan
  // acotados exclusivamente a su lista de vehículos asignados.
  const canAccessGestion  = useCallback(() => isAdmin() || isSuperAdmin() || isGestor(), [isAdmin, isSuperAdmin, isGestor]);

  const value = {
    user, loading,
    login, logout, updateStoredUser,
    hasRole, hasPermission,
    isSuperAdmin, isAdmin, isGestor, isOperacional,
    canManageUsers, canManageVehicles, canManageTrabajos, canDeleteAny,
    canAccessGestion,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
};
