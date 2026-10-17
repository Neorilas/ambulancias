import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Sesión de mentira con estado de verdad: ProtectedRoute tiene que ver el
// cambio de «sin sesión» a «con sesión» para que el login navegue.
vi.mock('../../../context/AuthContext.jsx', async () => {
  const { createContext, useContext, useState } = await import('react');
  const Ctx = createContext(null);
  return {
    AuthProvider: ({ children }) => {
      const [isAuthenticated, setAuth] = useState(false);
      const login = async () => { setAuth(true); return { id: 1 }; };
      return (
        <Ctx.Provider value={{ isAuthenticated, loading: false, hasRole: () => true, login }}>
          {children}
        </Ctx.Provider>
      );
    },
    useAuth: () => useContext(Ctx),
  };
});
vi.mock('../../../context/FeaturesContext.jsx', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => true, loading: false }),
}));
vi.mock('../../../context/NotificationContext.jsx', () => ({
  useNotification: () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }),
}));
vi.mock('../../../components/common/InstallPWAButton.jsx', () => ({ default: () => null }));

import { AuthProvider } from '../../../context/AuthContext.jsx';
import ProtectedRoute from '../../../components/common/ProtectedRoute.jsx';
import Login from '../../../pages/Login.jsx';

function DondeEstoy() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="ruta">{`${pathname}${search}${hash}`}</p>;
}

const montar = (ruta) => render(
  <AuthProvider>
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<ProtectedRoute><DondeEstoy /></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  </AuthProvider>
);

async function entrar() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Introduce tu usuario'), 'admin');
  await user.type(screen.getByPlaceholderText('Introduce tu contraseña'), 'x');
  await user.click(screen.getByRole('button', { name: /^entrar$/i }));
}

describe('Login: adónde vuelve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un aviso abierto sin sesión vuelve a su pestaña, no solo a la ficha', async () => {
    montar('/vehiculos/2?tab=revisiones#mant');
    expect(screen.getByPlaceholderText('Introduce tu usuario')).toBeInTheDocument();
    await entrar();
    expect(await screen.findByTestId('ruta')).toHaveTextContent('/vehiculos/2?tab=revisiones#mant');
  });

  it('tras la recarga de clearAuth usa ?volver=', async () => {
    montar('/login?volver=%2Fvehiculos%2F2%3Ftab%3Drevisiones');
    await entrar();
    expect(await screen.findByTestId('ruta')).toHaveTextContent('/vehiculos/2?tab=revisiones');
  });

  it('un ?volver= a otro origen no saca de la app', async () => {
    montar('/login?volver=%2F%2Fevil.example%2Fx');
    await entrar();
    expect(await screen.findByTestId('ruta')).toHaveTextContent(/^\/$/);
  });
});
