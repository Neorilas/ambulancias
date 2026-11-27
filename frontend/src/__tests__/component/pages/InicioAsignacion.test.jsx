import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { uploadEvidencia: vi.fn(), activar: vi.fn(), crearIncidencia: vi.fn() },
}));

// La cámara real usa getUserMedia; aquí un botón completa de golpe los tipos pedidos
vi.mock('../../../components/camera/CameraCapture.jsx', () => ({
  default: ({ tipos, onComplete }) => (
    <button onClick={() => onComplete(tipos.map(t => ({ tipo: t.key, file: new File(['x'], `${t.key}.jpg`) })))}>
      completar cámara
    </button>
  ),
}));

import { NotificationProvider, useNotification } from '../../../context/NotificationContext.jsx';
import InicioAsignacion        from '../../../pages/asignaciones/InicioAsignacion.jsx';
import { asignacionesService } from '../../../services/asignaciones.service.js';

const MECANICA = ['nivel_aceite', 'nivel_liquidos_general', 'cuentakilometros'];
const EXTERIOR = ['frontal', 'lateral_izquierdo', 'trasera', 'lateral_derecho'];

// Iniciada (botón ya pulsado), sin fotos
const INICIADA = {
  id: 9, estado: 'activa', inicio_real_at: '2026-11-27T07:00:00.000Z',
  fecha_inicio: '2026-11-27T07:00:00.000Z', fecha_fin: '2026-11-27T15:00:00.000Z',
  vehiculo_alias: 'Ambulancia 3', matricula: '1234ABC', evidencias: [],
};

function Avisos() {
  const { toasts } = useNotification();
  return toasts.map(t => <p key={t.id}>{t.message}</p>);
}

function montar(asignacion, { onDone = () => {} } = {}) {
  return render(
    <NotificationProvider>
      <InicioAsignacion asignacion={asignacion} onDone={onDone} onCancel={() => {}} />
      <Avisos />
    </NotificationProvider>
  );
}

const tiposSubidos = () => asignacionesService.uploadEvidencia.mock.calls.map(([, fd]) => fd.get('tipo_imagen'));

beforeEach(() => {
  asignacionesService.uploadEvidencia.mockReset();
  asignacionesService.uploadEvidencia.mockResolvedValue({});
});

describe('InicioAsignacion — fotos en dos tandas', () => {
  it('iniciada, se abre por la mecánica y «Guardar» sube solo esas tres', async () => {
    montar(INICIADA);
    expect(screen.getByRole('heading', { name: 'Revisión mecánica' })).toBeInTheDocument();

    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
    fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await screen.findByTestId('pausa-carroceria');
    expect(tiposSubidos()).toEqual(MECANICA);
    expect(asignacionesService.uploadEvidencia.mock.calls.every(([, fd]) => fd.get('momento') === 'inicio')).toBe(true);
  });

  it('desde la pausa se sigue a la carrocería y el final no repite la mecánica', async () => {
    const onDone = vi.fn();
    montar(INICIADA, { onDone });

    fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
    fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Fotos de la carrocería/ }));

    expect(screen.getByRole('heading', { name: 'Estado exterior' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
    fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar revisión' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(tiposSubidos()).toEqual([...MECANICA, ...EXTERIOR]);
  });

  it('«Más tarde» cierra el asistente con la mecánica ya subida', async () => {
    const onDone = vi.fn();
    montar(INICIADA, { onDone });

    fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
    fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Más tarde' }));

    expect(onDone).toHaveBeenCalled();
    expect(tiposSubidos()).toEqual(MECANICA);
  });

  it('con la mecánica ya en el servidor, se reabre por la carrocería y solo sube esas', async () => {
    const onDone = vi.fn();
    montar({
      ...INICIADA,
      evidencias: MECANICA.map((t, i) => ({ id: i + 1, momento: 'inicio', tipo_imagen: t, image_url: `/uploads/${t}.jpg` })),
    }, { onDone });

    expect(screen.getByRole('heading', { name: 'Estado exterior' })).toBeInTheDocument();

    // Atrás: la mecánica sale hecha y el botón solo avanza, sin subir nada
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(screen.getByText('3/3 fotos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByRole('heading', { name: 'Estado exterior' })).toBeInTheDocument();
    expect(asignacionesService.uploadEvidencia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
    fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar revisión' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(tiposSubidos()).toEqual(EXTERIOR);
  });

  it('si «Guardar» falla por cobertura, se queda en la mecánica y lo dice', async () => {
    asignacionesService.uploadEvidencia.mockReset();
    asignacionesService.uploadEvidencia.mockRejectedValue(Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' }));
    montar(INICIADA);

    fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
    fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await screen.findByText(/falta de cobertura \(0 de 3 subidas\).*«Guardar»/);
    expect(screen.queryByTestId('pausa-carroceria')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Revisión mecánica' })).toBeInTheDocument();
  });
});
