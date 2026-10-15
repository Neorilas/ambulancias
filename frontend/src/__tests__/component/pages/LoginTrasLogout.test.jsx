import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';

// AuthContext DE VERDAD: el fallo sale de cómo su `logout` y `ProtectedRoute`
// se entienden (2026-10-15, lo encontró probador-local al verificar v3.21.1).
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
vi.mock('../../../context/FeaturesContext.jsx', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => true, loading: false }),
}));
vi.mock('../../../context/NotificationContext.jsx', () => ({
  useNotification: () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }),
}));
vi.mock('../../../components/common/InstallPWAButton.jsx', () => ({ default: () => null }));

import { authService } from '../../../services/auth.service.js';
import { AuthProvider, useAuth } from '../../../context/AuthContext.jsx';
import ProtectedRoute from '../../../components/common/ProtectedRoute.jsx';
import Login from '../../../pages/Login.jsx';
import { setItem } from '../../../utils/sessionStorage.js';

// «Cerrar sesión» de Navbar hace `await logout(); navigate('/login')`, pero en
// el navegador esa navegación no es la última palabra: el router 7 la aplica
// en una transición, el `setUser(null)` se pinta antes con la pantalla vieja
// aún montada, y su `ProtectedRoute` hace `replace` a /login con `state.from`
// encima de la entrada limpia. En jsdom React pinta en otro orden (el replace
// del guardia sale ANTES que el push) y con el `navigate` el test pasaba sin el
// arreglo. Por eso aquí la salida es solo `logout()`: deja al guardia decidir
// el último, como en el navegador.
function Pantalla() {
  const { pathname, search, hash } = useLocation();
  const { logout } = useAuth();
  return (
    <>
      <p data-testid="ruta">{`${pathname}${search}${hash}`}</p>
      <button onClick={() => logout()}>Cerrar sesión</button>
    </>
  );
}

const montar = () => render(
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<ProtectedRoute><Pantalla /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);

async function salir(user) {
  await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
  await screen.findByPlaceholderText('Introduce tu usuario');
}

async function entrar(user) {
  await user.type(screen.getByPlaceholderText('Introduce tu usuario'), 'tecnico');
  await user.type(screen.getByPlaceholderText('Introduce tu contraseña'), 'x');
  await user.click(screen.getByRole('button', { name: /^entrar$/i }));
}

describe('Login tras «Cerrar sesión»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authService.logout.mockResolvedValue(undefined);
    authService.me.mockResolvedValue(null);
    authService.login.mockResolvedValue({
      accessToken: 'at2', refreshToken: 'rt2',
      user: { id: 2, username: 'tecnico', roles: ['tecnico'], permissions: [] },
    });
    // Sesión del gestor abierta en su perfil.
    setItem('accessToken', 'at1');
    setItem('refreshToken', 'rt1');
    setItem('user', JSON.stringify({ id: 1, username: 'gestor', roles: ['gestor'], permissions: [] }));
    window.history.replaceState(null, '', '/perfil?tab=avisos');
  });

  it('el siguiente que entra no aterriza donde salió el anterior', async () => {
    const user = userEvent.setup();
    montar();
    await salir(user);
    await entrar(user);
    expect(await screen.findByTestId('ruta')).toHaveTextContent(/^\/dashboard$/);
  });

  it('el login tras salir no guarda destino: recargarlo tampoco lo trae', async () => {
    const user = userEvent.setup();
    montar();
    await salir(user);
    expect(window.location.pathname).toBe('/login');
    // Lo que sobrevive a una recarga es history.state: ahí iba el `from`.
    expect(window.history.state?.usr?.from).toBeUndefined();
  });
});
