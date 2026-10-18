import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Qué entradas enseña el menú según rol y flags. El menú del técnico (sin
// acceso de gestión) llevaba «Mis asignaciones» con `show: true` fijo: con el
// flag apagado en PRO se veía igual y la guardia lo devolvía a la portada.
const estado = vi.hoisted(() => ({ gestion: false, features: [] }));

vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    canAccessGestion: () => estado.gestion,
    canManageUsers: () => estado.gestion,
    canManageVehicles: () => estado.gestion,
    canManageTrabajos: () => estado.gestion,
    isAdmin: () => estado.gestion,
    isSuperAdmin: () => false,
  }),
}));
vi.mock('../../../context/FeaturesContext.jsx', () => ({
  useFeatures: () => ({ isFeatureEnabled: (f) => estado.features.includes(f) }),
}));

import Sidebar from '../../../components/Layout/Sidebar.jsx';

const pintar = () => render(<MemoryRouter><Sidebar isOpen onClose={() => {}} /></MemoryRouter>);

describe('Sidebar: «Mis asignaciones» obedece a su flag', () => {
  beforeEach(() => {
    estado.gestion = false;
    estado.features = [];
  });

  it('técnico con los flags de PRO: «Mis trabajos» sí, «Mis asignaciones» no', () => {
    estado.features = ['menu_mis_trabajos'];
    pintar();
    expect(screen.getByRole('link', { name: 'Mis trabajos' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis asignaciones' })).not.toBeInTheDocument();
  });

  it('técnico con el flag encendido: la ve', () => {
    estado.features = ['menu_mis_asignaciones'];
    pintar();
    expect(screen.getByRole('link', { name: 'Mis asignaciones' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis trabajos' })).not.toBeInTheDocument();
  });

  // Menú vacío a propósito: la portada cae en /perfil, que va en la barra de
  // arriba. Mejor eso que un enlace que la guardia rebota.
  it('técnico con los dos apagados: ningún enlace', () => {
    pintar();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('gestión con el flag apagado: tampoco la ve', () => {
    estado.gestion = true;
    estado.features = ['menu_mis_trabajos'];
    pintar();
    expect(screen.getByRole('link', { name: 'Mis trabajos' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mis asignaciones' })).not.toBeInTheDocument();
  });

  it('gestión con el flag encendido: la ve', () => {
    estado.gestion = true;
    estado.features = ['menu_mis_asignaciones'];
    pintar();
    expect(screen.getByRole('link', { name: 'Mis asignaciones' })).toBeInTheDocument();
  });
});
