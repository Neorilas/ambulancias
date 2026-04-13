import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../../context/AuthContext';
import { authService } from '../../../services/auth.service';
import { ROLES, PERMISSIONS } from '../../../utils/constants';

vi.mock('../../../services/auth.service', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('starts with user=null and loading=false after mount', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('restores user from localStorage on mount', () => {
    const user = { id: 1, username: 'admin', roles: ['superadmin'], permissions: [] };
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('accessToken', 'tok');

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toEqual(user);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('clears localStorage if stored user is invalid JSON', () => {
    localStorage.setItem('user', 'not-json');
    localStorage.setItem('accessToken', 'tok');

    renderHook(() => useAuth(), { wrapper });
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('does not restore user if no accessToken', () => {
    localStorage.setItem('user', JSON.stringify({ id: 1 }));
    // no accessToken
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
  });

  it('login stores tokens and user', async () => {
    const loginData = {
      accessToken: 'at', refreshToken: 'rt',
      user: { id: 1, username: 'admin', roles: ['superadmin'], permissions: [] },
    };
    authService.login.mockResolvedValueOnce(loginData);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('admin', 'pass');
    });

    expect(result.current.user).toEqual(loginData.user);
    expect(localStorage.getItem('accessToken')).toBe('at');
    expect(localStorage.getItem('refreshToken')).toBe('rt');
  });

  it('logout clears user and tokens', async () => {
    localStorage.setItem('accessToken', 'at');
    localStorage.setItem('refreshToken', 'rt');
    localStorage.setItem('user', JSON.stringify({ id: 1, roles: [] }));
    authService.logout.mockResolvedValueOnce({});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('updateStoredUser merges and persists', async () => {
    const user = { id: 1, username: 'test', roles: [], permissions: [] };
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('accessToken', 'tok');

    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.updateStoredUser({ nombre: 'Updated' });
    });

    expect(result.current.user.nombre).toBe('Updated');
    expect(result.current.user.username).toBe('test');
    expect(JSON.parse(localStorage.getItem('user')).nombre).toBe('Updated');
  });

  describe('role helpers', () => {
    function setupUser(roles, permissions = []) {
      const user = { id: 1, roles, permissions };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      return renderHook(() => useAuth(), { wrapper });
    }

    it('hasRole returns true for matching role', () => {
      const { result } = setupUser([ROLES.TECNICO]);
      expect(result.current.hasRole(ROLES.TECNICO)).toBe(true);
      expect(result.current.hasRole(ROLES.ADMINISTRADOR)).toBe(false);
    });

    it('isSuperAdmin', () => {
      const { result } = setupUser([ROLES.SUPERADMIN]);
      expect(result.current.isSuperAdmin()).toBe(true);
      expect(result.current.isAdmin()).toBe(false);
    });

    it('isAdmin', () => {
      const { result } = setupUser([ROLES.ADMINISTRADOR]);
      expect(result.current.isAdmin()).toBe(true);
    });

    it('isGestor', () => {
      const { result } = setupUser([ROLES.GESTOR]);
      expect(result.current.isGestor()).toBe(true);
    });

    it('isOperacional for tecnico', () => {
      const { result } = setupUser([ROLES.TECNICO]);
      expect(result.current.isOperacional()).toBe(true);
    });

    it('isOperacional for enfermero', () => {
      const { result } = setupUser([ROLES.ENFERMERO]);
      expect(result.current.isOperacional()).toBe(true);
    });

    it('isOperacional for medico', () => {
      const { result } = setupUser([ROLES.MEDICO]);
      expect(result.current.isOperacional()).toBe(true);
    });

    it('isOperacional false for admin', () => {
      const { result } = setupUser([ROLES.ADMINISTRADOR]);
      expect(result.current.isOperacional()).toBe(false);
    });
  });

  describe('permission helpers', () => {
    it('hasPermission returns true for superadmin without specific permission', () => {
      const user = { id: 1, roles: [ROLES.SUPERADMIN], permissions: [] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.hasPermission(PERMISSIONS.MANAGE_USERS)).toBe(true);
    });

    it('hasPermission returns true if user has the permission', () => {
      const user = { id: 1, roles: [ROLES.GESTOR], permissions: [PERMISSIONS.MANAGE_VEHICLES] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.hasPermission(PERMISSIONS.MANAGE_VEHICLES)).toBe(true);
      expect(result.current.hasPermission(PERMISSIONS.MANAGE_USERS)).toBe(false);
    });

    it('hasPermission returns false when no user', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.hasPermission(PERMISSIONS.MANAGE_USERS)).toBe(false);
    });

    it('canManageUsers delegates to hasPermission', () => {
      const user = { id: 1, roles: [ROLES.GESTOR], permissions: [PERMISSIONS.MANAGE_USERS] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.canManageUsers()).toBe(true);
    });

    it('canManageVehicles delegates to hasPermission', () => {
      const user = { id: 1, roles: [ROLES.GESTOR], permissions: [PERMISSIONS.MANAGE_VEHICLES] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.canManageVehicles()).toBe(true);
    });

    it('canManageTrabajos delegates to hasPermission', () => {
      const user = { id: 1, roles: [ROLES.GESTOR], permissions: [PERMISSIONS.MANAGE_TRABAJOS] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.canManageTrabajos()).toBe(true);
    });

    it('canDeleteAny true for admin', () => {
      const user = { id: 1, roles: [ROLES.ADMINISTRADOR], permissions: [] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.canDeleteAny()).toBe(true);
    });

    it('canDeleteAny false for gestor', () => {
      const user = { id: 1, roles: [ROLES.GESTOR], permissions: [] };
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('accessToken', 'tok');
      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.canDeleteAny()).toBe(false);
    });
  });

  it('useAuth throws outside provider', () => {
    // Suppress expected React error boundary logs
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth debe usarse dentro de <AuthProvider>');
    spy.mockRestore();
  });
});
