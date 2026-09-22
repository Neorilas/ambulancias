import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { uploadEvidencia: vi.fn(), finalizar: vi.fn() },
}));

// La cámara real usa getUserMedia; aquí basta con un botón que complete de
// golpe todos los tipos que le pidan, sin pasar por vídeo de verdad.
vi.mock('../../../components/camera/CameraCapture.jsx', () => ({
  default: ({ tipos, onComplete }) => (
    <button onClick={() => onComplete(tipos.map(t => ({ tipo: t.key, file: new File(['x'], `${t.key}.jpg`) })))}>
      completar cámara
    </button>
  ),
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

// Avanza desde el paso 0 (material) hasta dejar el wizard en el paso de
// kilometraje, con las 4 fotos exteriores ya completadas por la cámara mock.
function irAPasoKm() {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sin gasto de material' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cámara guiada' }));
  fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  expect(screen.getByRole('heading', { name: 'Kilometraje' })).toBeInTheDocument();

  // La foto del cuadro de km también es obligatoria en este paso: sin ella
  // "Siguiente" queda deshabilitado aunque el número sea válido.
  fireEvent.click(screen.getByText('Fotografía el cuadro de instrumentos mostrando los km'));
  fireEvent.click(screen.getByRole('button', { name: 'completar cámara' }));
}

describe('FinalizacionAsignacion — mínimo de kilometraje', () => {
  // El vehículo puede haber avanzado por otra asignación desde que empezó
  // ésta: el mínimo real es el mayor entre km_inicio y el km actual del
  // vehículo, no solo km_inicio.
  const ASIGNACION_CON_VEHICULO_ADELANTADO = {
    ...ASIGNACION, km_inicio: 1000, vehiculo_km_actual: 5000,
  };

  it('rechaza un km_fin por debajo del km actual del vehículo aunque supere km_inicio', () => {
    render(
      <NotificationProvider>
        <FinalizacionAsignacion asignacion={ASIGNACION_CON_VEHICULO_ADELANTADO} onDone={() => {}} onCancel={() => {}} />
      </NotificationProvider>
    );
    irAPasoKm();

    const input = screen.getByPlaceholderText('Mín. 5000');
    fireEvent.change(input, { target: { value: '2000' } }); // > km_inicio, < vehiculo_km_actual

    expect(screen.getByText(/No puede ser menor que los km actuales del vehículo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled();
  });

  it('quita el punto de miles antes de comparar: "5.500" no es 5', () => {
    render(
      <NotificationProvider>
        <FinalizacionAsignacion asignacion={ASIGNACION_CON_VEHICULO_ADELANTADO} onDone={() => {}} onCancel={() => {}} />
      </NotificationProvider>
    );
    irAPasoKm();

    const input = screen.getByPlaceholderText('Mín. 5000');
    fireEvent.change(input, { target: { value: '5.500' } });

    expect(screen.queryByText(/No puede ser menor que los km actuales del vehículo/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente/ })).not.toBeDisabled();

    // El resumen final confirma que se guardó 5500, no 5 (parseInt("5.500")
    // cortaría en el punto sin la limpieza previa). El separador de miles del
    // texto depende del locale del entorno, así que solo se comprueba el
    // número en sí.
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByText(/^5[.,]?500 km$/)).toBeInTheDocument();
  });
});
