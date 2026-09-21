import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { uploadEvidencia: vi.fn(), finalizar: vi.fn() },
}));

import { NotificationProvider }  from '../../../context/NotificationContext.jsx';
import FinalizacionAsignacion    from '../../../pages/asignaciones/FinalizacionAsignacion.jsx';

const ASIGNACION = {
  id: 5, vehiculo_alias: 'Ambulancia 3', km_inicio: 1000,
  fecha_fin: '2000-01-01T00:00:00.000Z',   // ya vencida: sin paso de motivo
  progreso: { inicio: { completo: true, completado: 7, total: 7 } },
};

function montar(onCancel = () => {}) {
  return render(
    <NotificationProvider>
      <FinalizacionAsignacion asignacion={ASIGNACION} onDone={() => {}} onCancel={onCancel} />
    </NotificationProvider>
  );
}

describe('FinalizacionAsignacion — orden de pasos', () => {
  it('el material utilizado es el primer paso, antes de las fotos de fin', () => {
    const onCancel = vi.fn();
    montar(onCancel);

    expect(screen.getByRole('heading', { name: 'Material utilizado' })).toBeInTheDocument();
    expect(screen.getByText(/Paso 1 de/)).toBeInTheDocument();

    // En el primer paso el botón izquierdo sale del asistente
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('sin material no se avanza; con material se pasa a las fotos exteriores', () => {
    montar();

    const siguiente = screen.getByRole('button', { name: /Siguiente/ });
    expect(siguiente).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sin gasto de material' } });
    fireEvent.click(siguiente);

    expect(screen.getByRole('heading', { name: 'Estado exterior' })).toBeInTheDocument();
    // Desde las fotos se vuelve al material, no se sale
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(screen.getByRole('heading', { name: 'Material utilizado' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Sin gasto de material');
  });
});
