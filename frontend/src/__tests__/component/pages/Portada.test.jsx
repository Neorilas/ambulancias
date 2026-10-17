import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// La App DE VERDAD, con sus rutas y su ProtectedRoute: lo que se prueba es que
// la portada (utils/portada.js) y las guardias de App.jsx se entiendan. Si la
// portada manda a una pantalla que la guardia rechaza, la guardia rebota a `/`
// y la portada vuelve a mandar allí: bucle. El test unitario de rutaPortada no
// lo ve, porque tiene que replicar la guardia a mano. Aquí solo se simulan los
// contextos (quién es y qué flags hay) y se sustituyen las páginas por un
// rótulo.
const estado = vi.hoisted(() => ({
  roles: [],
  features: [],
  errorCarga: false,
  reload: null,
}));

vi.mock('../../../context/AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
    salidaVoluntaria: false,
    hasRole: (r) => estado.roles.includes(r),
    isSuperAdmin: () => estado.roles.includes('superadmin'),
  }),
}));
vi.mock('../../../context/FeaturesContext.jsx', () => ({
  FeaturesProvider: ({ children }) => children,
  // Como el de verdad: al superadmin le dice que sí a todo.
  useFeatures: () => ({
    features: estado.features,
    loading: false,
    errorCarga: estado.errorCarga,
    reload: estado.reload,
    isFeatureEnabled: (f) => estado.roles.includes('superadmin') || estado.features.includes(f),
  }),
}));
vi.mock('../../../context/NotificationContext.jsx', () => ({
  NotificationProvider: ({ children }) => children,
  useNotification: () => ({ notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }),
}));
vi.mock('../../../components/common/SWUpdater.jsx', () => ({ default: () => null }));
vi.mock('../../../components/Layout/Layout.jsx', async () => {
  const { createElement, Fragment } = await import('react');
  const { Outlet, useLocation } = await import('react-router-dom');
  return {
    default: function Layout() {
      const { pathname } = useLocation();
      return createElement(Fragment, null,
        createElement('p', { 'data-testid': 'ruta' }, pathname),
        createElement(Outlet));
    },
  };
});
vi.mock('../../../pages/Login.jsx', () => ({ default: () => 'pantalla:Login' }));
vi.mock('../../../pages/Dashboard.jsx', () => ({ default: () => 'pantalla:Dashboard' }));
vi.mock('../../../pages/users/UserList.jsx', () => ({ default: () => 'pantalla:UserList' }));
vi.mock('../../../pages/vehicles/VehicleList.jsx', () => ({ default: () => 'pantalla:VehicleList' }));
vi.mock('../../../pages/vehicles/VehicleHistory.jsx', () => ({ default: () => 'pantalla:VehicleHistory' }));
vi.mock('../../../pages/trabajos/TrabajoList.jsx', () => ({ default: () => 'pantalla:TrabajoList' }));
vi.mock('../../../pages/trabajos/TrabajoDetail.jsx', () => ({ default: () => 'pantalla:TrabajoDetail' }));
vi.mock('../../../pages/MisTrabajos.jsx', () => ({ default: () => 'pantalla:MisTrabajos' }));
vi.mock('../../../pages/AdminPanel.jsx', () => ({ default: () => 'pantalla:AdminPanel' }));
vi.mock('../../../pages/AlertsPage.jsx', () => ({ default: () => 'pantalla:AlertsPage' }));
vi.mock('../../../pages/asignaciones/AsignacionList.jsx', () => ({ default: () => 'pantalla:AsignacionList' }));
vi.mock('../../../pages/flota/MapaFlota.jsx', () => ({ default: () => 'pantalla:MapaFlota' }));
vi.mock('../../../pages/informes/Informes.jsx', () => ({ default: () => 'pantalla:Informes' }));
vi.mock('../../../pages/asignaciones/MisAsignaciones.jsx', () => ({ default: () => 'pantalla:MisAsignaciones' }));
vi.mock('../../../pages/Perfil.jsx', () => ({ default: () => 'pantalla:Perfil' }));
vi.mock('../../../pages/facturas/Facturas.jsx', () => ({ default: () => 'pantalla:Facturas' }));

import App from '../../../App.jsx';

const PANTALLA = {
  '/trabajos': 'pantalla:TrabajoList',
  '/mis-trabajos': 'pantalla:MisTrabajos',
  '/mis-asignaciones': 'pantalla:MisAsignaciones',
  '/perfil': 'pantalla:Perfil',
};

// Cada redirección es un `replaceState`. Un bucle no acaba nunca: se corta a
// las 30 para que el test falle diciendo qué pasa en vez de colgarse.
const MAX_SALTOS = 30;
let saltos;
let replaceOriginal;

beforeEach(() => {
  saltos = 0;
  replaceOriginal = window.history.replaceState;
  window.history.replaceState = function (...args) {
    saltos += 1;
    if (saltos > MAX_SALTOS) throw new Error(`bucle de redirección (último destino: ${args[2]})`);
    return replaceOriginal.apply(this, args);
  };
  estado.errorCarga = false;
  estado.reload = vi.fn();
});

afterEach(() => {
  window.history.replaceState = replaceOriginal;
});

function entrar(ruta, roles, features) {
  estado.roles = roles;
  estado.features = features;
  window.history.pushState({}, '', ruta);
  render(<App />);
}

async function esperarEn(ruta) {
  expect(await screen.findByText(PANTALLA[ruta])).toBeInTheDocument();
  expect(screen.getByTestId('ruta').textContent).toBe(ruta);
  expect(saltos).toBeLessThan(5);
}

// Flags como en PRO (Trabajos encendidos, «Mis asignaciones» apagada, §7 del
// mapa), como vienen de serie (local, BD nueva), solo el listado de Trabajos,
// y ninguno.
const PRO = ['menu_trabajos', 'menu_mis_trabajos', 'menu_dashboard', 'menu_vehiculos', 'menu_usuarios'];
const DE_SERIE = ['menu_asignaciones', 'menu_mis_asignaciones', 'menu_vehiculos', 'menu_usuarios'];
const SOLO_TRABAJOS = ['menu_trabajos'];
const NINGUNO = [];

const RUTAS = ['/', '/trabajos', '/mis-trabajos', '/mis-asignaciones'];

// [roles, flags, dónde acaba entrando por cada una de RUTAS]
const CASOS = [
  [['administrador'], PRO,           ['/trabajos', '/trabajos', '/mis-trabajos', '/trabajos']],
  [['administrador'], DE_SERIE,      ['/mis-asignaciones', '/mis-asignaciones', '/mis-asignaciones', '/mis-asignaciones']],
  [['administrador'], SOLO_TRABAJOS, ['/trabajos', '/trabajos', '/trabajos', '/trabajos']],
  [['administrador'], NINGUNO,       ['/perfil', '/perfil', '/perfil', '/perfil']],
  [['administrador', 'tecnico'], PRO, ['/trabajos', '/trabajos', '/mis-trabajos', '/trabajos']],

  // Al superadmin la guardia le deja pasar siempre.
  [['superadmin'], PRO,      ['/trabajos', '/trabajos', '/mis-trabajos', '/mis-asignaciones']],
  [['superadmin'], DE_SERIE, ['/trabajos', '/trabajos', '/mis-trabajos', '/mis-asignaciones']],
  [['superadmin'], NINGUNO,  ['/trabajos', '/trabajos', '/mis-trabajos', '/mis-asignaciones']],

  [['gestor'], PRO,           ['/mis-trabajos', '/trabajos', '/mis-trabajos', '/mis-trabajos']],
  [['gestor'], DE_SERIE,      ['/mis-asignaciones', '/mis-asignaciones', '/mis-asignaciones', '/mis-asignaciones']],
  [['gestor'], SOLO_TRABAJOS, ['/perfil', '/trabajos', '/perfil', '/perfil']],
  [['gestor'], NINGUNO,       ['/perfil', '/perfil', '/perfil', '/perfil']],

  [['tecnico'], PRO,           ['/mis-trabajos', '/mis-trabajos', '/mis-trabajos', '/mis-trabajos']],
  [['tecnico'], DE_SERIE,      ['/mis-asignaciones', '/mis-asignaciones', '/mis-asignaciones', '/mis-asignaciones']],
  [['tecnico'], SOLO_TRABAJOS, ['/perfil', '/perfil', '/perfil', '/perfil']],
  [['tecnico'], NINGUNO,       ['/perfil', '/perfil', '/perfil', '/perfil']],
];

const nombreFlags = (f) => (
  f === PRO ? 'flags de PRO'
    : f === DE_SERIE ? 'flags de serie'
      : f === SOLO_TRABAJOS ? 'solo menu_trabajos'
        : 'ningún flag'
);

describe('Portada con las guardias de verdad: acaba en una pantalla, sin bucle', () => {
  const filas = CASOS.flatMap(([roles, flags, destinos]) =>
    RUTAS.map((ruta, i) => [roles.join('+'), nombreFlags(flags), ruta, destinos[i], roles, flags]));

  it.each(filas)('%s con %s entrando por %s → %s', async (_r, _f, ruta, destino, roles, flags) => {
    entrar(ruta, roles, flags);
    await esperarEn(destino);
  });

  it('una URL que no existe también acaba en la portada', async () => {
    entrar('/no-existe', ['tecnico'], PRO);
    await esperarEn('/mis-trabajos');
  });
});

describe('Si no se pudieron cargar los flags', () => {
  beforeEach(() => { estado.errorCarga = true; });

  it('la portada lo dice y ofrece reintentar, en vez de mandar a otra pantalla', async () => {
    const user = userEvent.setup();
    entrar('/', ['tecnico'], []);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la configuración');
    expect(screen.getByTestId('ruta').textContent).toBe('/');

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(estado.reload).toHaveBeenCalledTimes(1);
  });

  it('quien abre una pantalla con flag acaba en ese aviso, no en bucle', async () => {
    entrar('/mis-asignaciones', ['tecnico'], []);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la configuración');
    expect(screen.getByTestId('ruta').textContent).toBe('/');
    expect(saltos).toBeLessThan(5);
  });

  it('también para administración', async () => {
    entrar('/trabajos', ['administrador'], []);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('ruta').textContent).toBe('/');
  });
});
