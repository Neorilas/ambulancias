import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { uploadEvidencia: vi.fn(), finalizar: vi.fn(), catalogoMaterial: vi.fn(() => Promise.resolve([])) },
}));

vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { get: vi.fn(), cerrar: vi.fn() },
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

import { NotificationProvider, useNotification } from '../../../context/NotificationContext.jsx';
import FinalizacionAsignacion    from '../../../pages/asignaciones/FinalizacionAsignacion.jsx';
import { asignacionesService }  from '../../../services/asignaciones.service.js';
import { trabajosService }      from '../../../services/trabajos.service.js';

const ASIGNACION = {
  id: 5, vehiculo_alias: 'Ambulancia 3', km_inicio: 1000,
  fecha_fin: '2000-01-01T00:00:00.000Z',
  progreso: { inicio: { completo: true, completado: 7, total: 7 } },
};

// El provider guarda los avisos pero no los pinta (eso lo hace el Layout).
function Avisos() {
  const { toasts } = useNotification();
  return toasts.map(t => <p key={t.id}>{t.message}</p>);
}

function montar(onCancel = () => {}) {
  return render(
    <NotificationProvider>
      <FinalizacionAsignacion asignacion={ASIGNACION} onDone={() => {}} onCancel={onCancel} />
      <Avisos />
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

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(siguiente);

    expect(screen.getByRole('heading', { name: 'Estado exterior' })).toBeInTheDocument();
    // Desde las fotos se vuelve al material, no se sale
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(screen.getByRole('heading', { name: 'Material utilizado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true');
  });
});

// El motivo de fin anticipado se pide en «Fin evento/servicio»; el asistente
// de cierre solo lo pide si ese botón se olvidó.
describe('FinalizacionAsignacion — motivo de fin anticipado', () => {
  const FUTURO = new Date(Date.now() + 3600000).toISOString();
  const pintar = (asig) => render(
    <NotificationProvider>
      <FinalizacionAsignacion asignacion={asig} onDone={() => {}} onCancel={() => {}} />
    </NotificationProvider>
  );

  it('antes de la hora prevista y sin motivo guardado añade el paso del motivo', () => {
    pintar({ ...ASIGNACION, fecha_fin: FUTURO, fin_servicio_at: null });
    expect(screen.getByText(/Paso 1 de 5/)).toBeInTheDocument();
  });

  it('con el motivo ya dejado en «Fin evento/servicio» no lo pide', () => {
    pintar({ ...ASIGNACION, fecha_fin: FUTURO, fin_servicio_at: '2026-10-04T08:00:00.000Z', motivo_fin: 'Traslado cancelado' });
    expect(screen.getByText(/Paso 1 de 4/)).toBeInTheDocument();
  });

  it('pasada la hora prevista no lo pide', () => {
    pintar(ASIGNACION);
    expect(screen.getByText(/Paso 1 de 4/)).toBeInTheDocument();
  });

  // v42: con evento en el trabajo, la hora es su fin, no la vuelta a base
  it('con el evento del trabajo ya acabado no lo pide, aunque la vuelta a base sea después', () => {
    pintar({ ...ASIGNACION, fecha_fin: FUTURO, fin_servicio_at: null,
      trabajo: { evento_fin: new Date(Date.now() - 60000).toISOString() } });
    expect(screen.getByText(/Paso 1 de 4/)).toBeInTheDocument();
  });
});

// Avanza desde el paso 0 (material) hasta dejar el wizard en el paso de
// kilometraje, con las 4 fotos exteriores ya completadas por la cámara mock.
function irAPasoKm() {
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
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

// Incidente 2026-10-03: con mala cobertura la subida de una foto agotó el
// timeout y la pantalla enseñó «timeout of 30000ms exceeded». Ahora explica
// qué se ha subido y deja reintentar sin repetir lo que ya está arriba.
describe('FinalizacionAsignacion — sin cobertura al enviar', () => {
  beforeEach(() => {
    asignacionesService.uploadEvidencia.mockReset();
    asignacionesService.finalizar.mockReset();
  });

  function irAlResumen() {
    montar();
    irAPasoKm();
    fireEvent.change(screen.getByPlaceholderText('Mín. 1000'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  }

  const timeout = () => Object.assign(new Error('timeout of 120000ms exceeded'), {
    code: 'ECONNABORTED', request: {},
  });

  it('dice cuántas fotos han subido y en español, y no intenta cerrar', async () => {
    asignacionesService.uploadEvidencia
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(timeout());
    irAlResumen();

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));

    expect(await screen.findByText(/falta de cobertura \(1 de 5 subidas\)/)).toBeInTheDocument();
    expect(screen.queryByText(/timeout of/)).not.toBeInTheDocument();
    expect(asignacionesService.finalizar).not.toHaveBeenCalled();
  });

  it('al volver a pulsar no repite las fotos ya subidas y cierra', async () => {
    asignacionesService.uploadEvidencia
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue({});
    asignacionesService.finalizar.mockResolvedValue({});
    irAlResumen();

    const boton = screen.getByRole('button', { name: 'Finalizar asignación' });
    fireEvent.click(boton);
    await screen.findByText(/falta de cobertura/);
    await waitFor(() => expect(boton).not.toBeDisabled());

    fireEvent.click(boton);
    await waitFor(() => expect(asignacionesService.finalizar).toHaveBeenCalled());
    // 2 del primer intento + las 4 que faltaban (la que falló, otra vez)
    expect(asignacionesService.uploadEvidencia).toHaveBeenCalledTimes(6);
  });

  it('si las fotos suben y lo que falla es el cierre, lo dice', async () => {
    asignacionesService.uploadEvidencia.mockResolvedValue({});
    asignacionesService.finalizar.mockRejectedValueOnce(timeout());
    irAlResumen();

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));

    expect(await screen.findByText(/Las fotos ya están subidas, pero no se ha podido terminar/)).toBeInTheDocument();
  });

  it('un rechazo del servidor (4xx) se enseña tal cual', async () => {
    asignacionesService.uploadEvidencia.mockResolvedValue({});
    asignacionesService.finalizar.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'La asignación ya está finalizada' } },
    });
    irAlResumen();

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));

    expect(await screen.findByText('La asignación ya está finalizada')).toBeInTheDocument();
  });
});

// ── v43: solo personal, sin ambulancia ──────────────────────
describe('FinalizacionAsignacion — solo personal (v43)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('del material pasa directo a confirmar: sin fotos ni km, y no manda km', async () => {
    asignacionesService.finalizar.mockResolvedValue({});
    render(
      <NotificationProvider>
        <FinalizacionAsignacion onDone={() => {}} onCancel={() => {}} asignacion={{
          ...ASIGNACION, solo_personal: true, vehiculo_alias: null, km_inicio: null, motivo_fin: 'x',
          progreso: { inicio: { completo: true, completado: 0, total: 0 } },
        }} />
      </NotificationProvider>
    );

    expect(screen.getByText(/Paso 1 de 2 — Solo personal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByTestId('cierre-solo-personal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));

    await waitFor(() => expect(asignacionesService.finalizar).toHaveBeenCalledWith(5, expect.objectContaining({
      km_fin: null, material_usado: 'Sin gasto de material' })));
    expect(asignacionesService.uploadEvidencia).not.toHaveBeenCalled();
  });
});

// ── v45: material del almacén ───────────────────────────────
describe('FinalizacionAsignacion — material del almacén (v45)', () => {
  const CATALOGO = [
    { id: 1, nombre: 'Mascarilla FFP2', presentacion: 'Unidad' },
    { id: 2, nombre: 'Mascarilla laríngea 4', presentacion: 'Unidad' },
    { id: 3, nombre: 'Guantes nitrilo M', presentacion: 'Caja' },
  ];
  const SOLO_PERSONAL = {
    ...ASIGNACION, solo_personal: true, vehiculo_alias: null, km_inicio: null, motivo_fin: 'x',
    progreso: { inicio: { completo: true, completado: 0, total: 0 } },
  };
  const pintar = () => render(
    <NotificationProvider>
      <FinalizacionAsignacion asignacion={SOLO_PERSONAL} onDone={() => {}} onCancel={() => {}} />
    </NotificationProvider>
  );
  beforeEach(() => {
    vi.clearAllMocks();
    asignacionesService.catalogoMaterial.mockResolvedValue(CATALOGO);
    asignacionesService.finalizar.mockResolvedValue({});
  });

  it('busca sin tildes, elige con cantidad y manda los productos con el texto libre', async () => {
    pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
    const siguiente = screen.getByRole('button', { name: /Siguiente/ });
    expect(siguiente).toBeDisabled();   // «Sí» sin nada no vale

    const buscador = screen.getByLabelText('Busca el producto');
    fireEvent.change(buscador, { target: { value: 'laringea' } });
    fireEvent.click(await screen.findByRole('button', { name: /Mascarilla laríngea 4/ }));
    expect(buscador).toHaveValue('');

    fireEvent.change(buscador, { target: { value: 'guan' } });
    fireEvent.click(screen.getByRole('button', { name: /Guantes nitrilo M/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Uno más de Guantes nitrilo M' }));
    expect(screen.getByLabelText('Cantidad de Guantes nitrilo M')).toHaveTextContent('2');

    fireEvent.click(screen.getByRole('button', { name: 'No lo encuentro' }));
    fireEvent.change(screen.getByLabelText('Lo que no está en la lista'), { target: { value: '1 manta térmica' } });

    fireEvent.click(siguiente);
    expect(screen.getByTestId('resumen-material').textContent)
      .toBe('1 × Mascarilla laríngea 4\n2 × Guantes nitrilo M (Caja)\n1 manta térmica');
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));

    await waitFor(() => expect(asignacionesService.finalizar).toHaveBeenCalledWith(5, expect.objectContaining({
      material_usado: '1 manta térmica',
      material_items: [{ producto_id: 2, cantidad: 1 }, { producto_id: 3, cantidad: 2 }],
    })));
  });

  it('con cantidad 1, el botón de la izquierda quita la ficha', async () => {
    pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
    fireEvent.change(screen.getByLabelText('Busca el producto'), { target: { value: 'ffp2' } });
    fireEvent.click(await screen.findByRole('button', { name: /Mascarilla FFP2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Mascarilla FFP2' }));
    expect(screen.queryByLabelText('Cantidad de Mascarilla FFP2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled();
  });

  it('si la lista del almacén no carga, se escribe a mano', async () => {
    asignacionesService.catalogoMaterial.mockRejectedValue(new Error('sin red'));
    pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
    expect(await screen.findByText(/No se ha podido cargar la lista del almacén/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Busca el producto')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Material utilizado'), { target: { value: '2 vendas' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));
    await waitFor(() => expect(asignacionesService.finalizar).toHaveBeenCalledWith(5, expect.objectContaining({
      material_usado: '2 vendas', material_items: [] })));
  });
});

// ── 2026-11-22: cerrar el trabajo ahí mismo ─────────────────
describe('FinalizacionAsignacion — cerrar el trabajo tras la última ambulancia', () => {
  const EN_TRABAJO = {
    ...ASIGNACION, trabajo_id: 40, solo_personal: true, vehiculo_alias: null, km_inicio: null, motivo_fin: 'x',
    progreso: { inicio: { completo: true, completado: 0, total: 0 } },
  };
  const finalizarHastaElFinal = (onDone) => {
    render(
      <NotificationProvider>
        <FinalizacionAsignacion asignacion={EN_TRABAJO} onDone={onDone} onCancel={() => {}} />
        <Avisos />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    asignacionesService.finalizar.mockResolvedValue({});
  });

  it('si queda pendiente de cierre y puede cerrarlo, ofrece «Cerrar trabajo» y lo cierra', async () => {
    trabajosService.get.mockResolvedValue({ id: 40, nombre: 'Maratón', estado: 'pendiente_cierre', puede_cerrar: true });
    trabajosService.cerrar.mockResolvedValue({ id: 40, estado: 'finalizado' });
    const onDone = vi.fn();
    finalizarHastaElFinal(onDone);

    expect(await screen.findByTestId('cerrar-trabajo-tras-fin')).toBeInTheDocument();
    expect(screen.getByText(/«Maratón» han terminado/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar trabajo' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(trabajosService.cerrar).toHaveBeenCalledWith(40);
    expect(screen.getByText('Trabajo cerrado')).toBeInTheDocument();
  });

  it('«Ahora no» sale sin cerrarlo', async () => {
    trabajosService.get.mockResolvedValue({ id: 40, nombre: 'Maratón', estado: 'pendiente_cierre', puede_cerrar: true });
    const onDone = vi.fn();
    finalizarHastaElFinal(onDone);

    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(onDone).toHaveBeenCalled();
    expect(trabajosService.cerrar).not.toHaveBeenCalled();
  });

  it('si el cierre falla, avisa y se queda en la pantalla', async () => {
    trabajosService.get.mockResolvedValue({ id: 40, nombre: 'Maratón', estado: 'pendiente_cierre', puede_cerrar: true });
    trabajosService.cerrar.mockRejectedValue({ response: { data: { message: 'Hay una ambulancia sin finalizar' } } });
    const onDone = vi.fn();
    finalizarHastaElFinal(onDone);

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar trabajo' }));
    expect(await screen.findByText('Hay una ambulancia sin finalizar')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('cerrar-trabajo-tras-fin')).toBeInTheDocument();
  });

  it.each([
    ['quedan ambulancias abiertas', { estado: 'activo', puede_cerrar: false }],
    ['no puede cerrarlo (no es coordinador)', { estado: 'pendiente_cierre', puede_cerrar: false }],
  ])('si %s, sale como siempre', async (_, trabajo) => {
    trabajosService.get.mockResolvedValue({ id: 40, nombre: 'Maratón', ...trabajo });
    const onDone = vi.fn();
    finalizarHastaElFinal(onDone);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByTestId('cerrar-trabajo-tras-fin')).not.toBeInTheDocument();
  });

  it('si no se puede leer el trabajo, sale como siempre: la asignación ya está cerrada', async () => {
    trabajosService.get.mockRejectedValue(new Error('sin red'));
    const onDone = vi.fn();
    finalizarHastaElFinal(onDone);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('sin trabajo no lo consulta', async () => {
    const onDone = vi.fn();
    render(
      <NotificationProvider>
        <FinalizacionAsignacion asignacion={{ ...EN_TRABAJO, trabajo_id: null }} onDone={onDone} onCancel={() => {}} />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar asignación' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(trabajosService.get).not.toHaveBeenCalled();
  });
});
