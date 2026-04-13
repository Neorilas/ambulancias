import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../../context/AuthContext';
import { BrowserRouter } from 'react-router-dom';
import { NotificationProvider } from '../../../context/NotificationContext';

vi.mock('../../../services/auth.service', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
}));

import { authService } from '../../../services/auth.service';

function Wrapper({ children }) {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <AuthProvider>{children}</AuthProvider>
      </NotificationProvider>
    </BrowserRouter>
  );
}

function TestConsumer() {
  const { user, isAuthenticated, login, logout, hasRole, hasPermission, isOperacional } = useAuth();
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid="user">{user?.username || 'none'}</span>
      <span data-testid="hasAdmin">{hasRole('administrador') ? 'yes' : 'no'}</span>
      <span data-testid="isOp">{isOperacional() ? 'yes' : 'no'}</span>
      <button onClick={() => login('admin', 'pass')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('starts unauthenticated', async () => {
    render(<Wrapper><TestConsumer /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('no'));
  });

  it('login sets user and tokens', async () => {
    authService.login.mockResolvedValueOnce({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_users'] },
    });

    render(<Wrapper><TestConsumer /></Wrapper>);
    await act(() => screen.getByText('login').click());

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('yes');
      expect(screen.getByTestId('user').textContent).toBe('admin');
      expect(screen.getByTestId('hasAdmin').textContent).toBe('yes');
    });
    expect(localStorage.getItem('accessToken')).toBe('at');
  });

  it('logout clears user', async () => {
    // Pre-populate
    localStorage.setItem('accessToken', 'at');
    localStorage.setItem('refreshToken', 'rt');
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin', roles: ['administrador'], permissions: [] }));

    authService.logout.mockResolvedValueOnce({});
    authService.me.mockResolvedValueOnce({ data: { data: { id: 1, username: 'admin', roles: ['administrador'], permissions: [] } } });

    render(<Wrapper><TestConsumer /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('yes'));

    await act(() => screen.getByText('logout').click());
    await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('no'));
  });

  it('isOperacional returns true for tecnico', async () => {
    localStorage.setItem('accessToken', 'at');
    localStorage.setItem('user', JSON.stringify({ id: 5, username: 'tec', roles: ['tecnico'], permissions: [] }));
    authService.me.mockResolvedValueOnce({ data: { data: { id: 5, username: 'tec', roles: ['tecnico'], permissions: [] } } });

    render(<Wrapper><TestConsumer /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('isOp').textContent).toBe('yes'));
  });

  it('restores user from localStorage on mount', async () => {
    localStorage.setItem('accessToken', 'at');
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin', roles: ['administrador'], permissions: [] }));
    authService.me.mockResolvedValueOnce({ data: { data: { id: 1, username: 'admin', roles: ['administrador'], permissions: [] } } });

    render(<Wrapper><TestConsumer /></Wrapper>);
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin'));
  });
});
