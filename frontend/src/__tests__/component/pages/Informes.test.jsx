import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../../services/informes.service.js', () => ({
  informesService: { getMensual: vi.fn(), getDetalleTecnico: vi.fn() },
}));
vi.mock('../../../utils/pdfInformeTecnico.js', () => ({ descargarPdfTecnico: vi.fn() }));
// El detalle de un servicio es el panel de siempre; aquí basta con saber que se abre encima
vi.mock('../../../pages/asignaciones/AsignacionDetalle.jsx', () => ({
  default: ({ id, onClose }) => (
    <div data-testid="detalle-asignacion">
      Asignación {id}<button type="button" onClick={onClose}>Cerrar asignación</button>
    </div>
  ),
}));

import { informesService }      from '../../../services/informes.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import Informes                 from '../../../pages/informes/Informes.jsx';
import { descargarPdfTecnico }  from '../../../utils/pdfInformeTecnico.js';

const RESUMEN = {
  servicios: 20, iniciados: 20, inicios_tardios: 4, retraso_mediana_min: 45, retraso_medio_min: 50,
  sin_iniciar: 1, con_llegada: 10, desplazamiento_mediana_min: 25, con_fotos_inicio_tarde: 2,
  finalizados: 18, cierres_tardios: 3, cierres_anticipados: 0, horas_servicio: 150,
  vehiculos_en_flota: 3, vehiculos_usados: 2,
  incidencias: { nuevas: 3, graves: 1, moderadas: 1, leves: 1, resueltas: 2, abiertas_fin: 4, resolucion_mediana_horas: 12.5 },
};

const DATOS = {
  actual: {
    mes: '2026-08', fuente: 'en_vivo', en_curso: false, umbral_min: 30, resumen: RESUMEN,
    por_vehiculo: [{ vehicle_id: 1, alias: 'Ambulancia 1', matricula: '1111AAA', servicios: 12, iniciados: 12,
                     inicios_tardios: 3, horas_servicio: 90, incidencias: 2 }],
    vehiculos_sin_uso: [{ vehicle_id: 3, alias: 'Ambulancia 3', matricula: '3333CCC' }],
    por_tecnico: [{ user_id: 7, nombre: 'Ana Ruiz', servicios: 8, como_personal: 2, iniciados: 8,
                    inicios_tardios: 2, retraso_mediana_min: 95, sin_iniciar: 0, con_llegada: 4,
                    con_fotos_inicio_tarde: 1, incidencias: 1,
                    finalizados: 7, cierres_tardios: 1, cierres_anticipados: 0, desplazamiento_mediana_min: 25,
                    minutos_asignacion: 3690, asignaciones_medidas: 9, asignaciones_sin_finalizar: 1,
                    minutos_en_evento: 1995, eventos_medidos: 6, eventos_sin_fin: 2 },
                  { user_id: 8, nombre: 'Luis Gil', servicios: 0, como_personal: 3, iniciados: 0,
                    inicios_tardios: 0, sin_iniciar: 0, con_llegada: 0, con_fotos_inicio_tarde: 0, incidencias: 0,
                    finalizados: 0, cierres_tardios: 0, cierres_anticipados: 0,
                    minutos_asignacion: 4500, asignaciones_medidas: 3, asignaciones_sin_finalizar: 0,
                    minutos_en_evento: 600, eventos_medidos: 2, eventos_sin_fin: 0 }],
  },
  comparativa: {
    anterior: { mes: '2026-07', resumen: { ...RESUMEN, inicios_tardios: 2 } },
    anio_anterior: null,
  },
};

function Donde() {
  const { pathname, search } = useLocation();
  return <><p data-testid="donde">{search}</p><p data-testid="ruta">{pathname + search}</p></>;
}

function montar(ruta = '/informes') {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[ruta]}><Informes /><Donde /></MemoryRouter>
    </NotificationProvider>
  );
}

describe('Informes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    informesService.getMensual.mockResolvedValue(DATOS);
  });

  it('pinta resumen, comparativa, flota y técnicos', async () => {
    montar();

    expect(await screen.findByText(/Informe de agosto de 2026/)).toBeInTheDocument();
    expect(screen.getByText('4 de 20 iniciados')).toBeInTheDocument();
    // 20 % frente a 10 % del mes anterior: peor
    expect(screen.getByText('+10 pt')).toHaveClass('text-bad-600');
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Ambulancia 1')).toBeInTheDocument();
    expect(screen.getByText(/Sin servicio: Ambulancia 3/)).toBeInTheDocument();
    expect(screen.getByText('12,5 h')).toBeInTheDocument();
  });

  it('por técnico: sumatorio de horas por pestaña, de más carga a menos y con total', async () => {
    montar();
    await screen.findByText('Ana Ruiz');
    const filas = () => [...screen.getByText('Ana Ruiz').closest('table').rows].slice(1).map(r => r.textContent);

    // La primera pestaña es la de evento/servicio
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Horas de evento/servicio');
    expect(screen.getByRole('tab', { name: 'Horas de evento/servicio' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('columnheader', { name: 'Horas con evento/servicio activo' })).toBeInTheDocument();
    expect(filas()[0]).toMatch(/^Ana Ruiz33 h 15 min/);
    expect(filas()[2]).toMatch(/^Total43 h 15 min82$/);

    fireEvent.click(screen.getByRole('tab', { name: 'Horas de asignación' }));
    expect(screen.getByRole('columnheader', { name: 'Horas con asignación activa' })).toBeInTheDocument();
    // Luis (75 h) antes que Ana (61 h 30 min); total 136 h 30 min
    expect(filas()[0]).toMatch(/^Luis Gil75 h/);
    expect(filas()[1]).toMatch(/^Ana Ruiz61 h 30 min/);
    expect(filas()[2]).toMatch(/^Total136 h 30 min121$/);

    fireEvent.click(screen.getByRole('tab', { name: 'Puntualidad' }));
    expect(screen.getByRole('columnheader', { name: 'Cierres tardíos' })).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('un informe sin tiempos por técnico (archivado viejo) pinta «—»', async () => {
    const { minutos_asignacion, asignaciones_medidas, ...sinTiempo } = DATOS.actual.por_tecnico[0];
    informesService.getMensual.mockResolvedValue({ ...DATOS, actual: { ...DATOS.actual, por_tecnico: [sinTiempo] } });
    montar('/informes?tecnico=asignacion');
    const celdas = (await screen.findByText('Ana Ruiz')).closest('tr').querySelectorAll('td');
    expect(celdas[1]).toHaveTextContent('—');
    expect(celdas[2]).toHaveTextContent('—');
  });

  it('«Por técnico» va antes que el resto', async () => {
    montar();
    await screen.findByText('Ana Ruiz');
    const titulos = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(titulos[0]).toBe('Por técnico');
    expect(titulos.indexOf('Puntualidad')).toBeGreaterThan(0);
  });

  it('cambiar de mes vuelve a pedir el informe', async () => {
    montar();
    await screen.findByText(/Informe de agosto/);
    fireEvent.change(screen.getByLabelText('Mes del informe'), { target: { value: '2026-05' } });
    await waitFor(() => expect(informesService.getMensual).toHaveBeenLastCalledWith('2026-05'));
  });

  it('mes en curso y archivado se avisan; tablas vacías se explican', async () => {
    informesService.getMensual.mockResolvedValue({
      actual: { ...DATOS.actual, en_curso: true, fuente: 'archivado', por_vehiculo: [], por_tecnico: [],
                vehiculos_sin_uso: [] },
      comparativa: { anterior: null, anio_anterior: null },
    });
    montar();
    expect(await screen.findByText(/mes en curso/)).toBeInTheDocument();
    expect(screen.getByText(/archivado/)).toBeInTheDocument();
    expect(screen.getByText('Nadie tuvo servicios este mes.')).toBeInTheDocument();
  });

  it('si falla la carga, lo dice', async () => {
    informesService.getMensual.mockRejectedValue(new Error('403'));
    montar();
    expect(await screen.findByText('Sin informe')).toBeInTheDocument();
  });
});

// Mes y pestaña en la URL: el informe enlaza a la ficha de cada vehículo y al
// volver tiene que seguir en el mismo mes (§8 del mapa)
describe('Informes · lo que se estaba mirando sobrevive a ir a una ficha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    informesService.getMensual.mockResolvedValue(DATOS);
  });

  it('el mes y la pestaña de la URL se aplican al volver', async () => {
    montar('/informes?mes=2026-05&tecnico=evento');
    await screen.findByText('Ana Ruiz');
    expect(informesService.getMensual).toHaveBeenCalledWith('2026-05');
    expect(screen.getByLabelText('Mes del informe')).toHaveValue('2026-05');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(/evento/i);
  });

  it('cambiar el mes o la pestaña lo apunta en la URL', async () => {
    montar();
    await screen.findByText('Ana Ruiz');
    fireEvent.change(screen.getByLabelText('Mes del informe'), { target: { value: '2026-05' } });
    expect(screen.getByTestId('donde')).toHaveTextContent('?mes=2026-05');
    fireEvent.click((await screen.findAllByRole('tab'))[1]);
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\?mes=2026-05&tecnico=\w+$/);
  });

  it('un mes mal formado o futuro en la URL se ignora: el actual', async () => {
    montar('/informes?mes=2999-01');
    await screen.findByText('Ana Ruiz');
    expect(informesService.getMensual).not.toHaveBeenCalledWith('2999-01');
  });
});

const DETALLE = {
  mes: '2026-08', user_id: 7, nombre: 'Ana Ruiz', umbral_min: 30, archivado: false, en_curso: false,
  servicios: [
    { asignacion_id: 1, trabajo: 'Feria de agosto', alias: 'Ambulancia 1', matricula: '1111AAA', rol: 'responsable',
      estado: 'finalizada', fecha_inicio: '2026-08-05T06:00:00Z', fecha_fin: '2026-08-05T14:00:00Z',
      inicio_real_at: '2026-08-05T06:05:00Z', llegada_servicio_at: '2026-08-05T06:30:00Z',
      fin_servicio_at: '2026-08-05T13:00:00Z', finalizado_at: '2026-08-05T14:00:00Z',
      minutos_asignacion: 475, minutos_en_evento: 390, avisos: [], trabajo_id: 5 },
    { asignacion_id: 2, trabajo: null, alias: 'Ambulancia 1', matricula: '1111AAA', rol: 'personal',
      estado: 'finalizada', fecha_inicio: '2026-08-06T06:00:00Z', fecha_fin: '2026-08-06T14:00:00Z',
      inicio_real_at: '2026-08-06T06:05:00Z', llegada_servicio_at: '2026-08-06T06:30:00Z',
      fin_servicio_at: null, finalizado_at: '2026-08-06T14:00:00Z',
      minutos_asignacion: 475, minutos_en_evento: null,
      avisos: [{ codigo: 'evento_sin_fin', nivel: 'grave' }] },
  ],
};

// Pulsar un técnico: sus servicios del mes con lo que no cuadra, y el PDF
describe('Informes · detalle de un técnico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    informesService.getMensual.mockResolvedValue(DATOS);
    informesService.getDetalleTecnico.mockResolvedValue(DETALLE);
  });

  it('pulsar el nombre abre sus servicios, marca los que no cuadran y lo apunta en la URL', async () => {
    montar('/informes?mes=2026-08');
    fireEvent.click(await screen.findByRole('button', { name: 'Ana Ruiz' }));

    expect(await screen.findByText('Feria de agosto')).toBeInTheDocument();
    expect(informesService.getDetalleTecnico).toHaveBeenCalledWith('7', '2026-08');
    expect(screen.getByTestId('donde')).toHaveTextContent('detalle=7');
    expect(screen.getByRole('heading', { name: 'Horas de Ana Ruiz' })).toBeInTheDocument();
    const aviso = screen.getByText('Evento sin fin: no suma horas de evento');
    expect(aviso.closest('tr')).toHaveClass('bg-bad-50');
    expect(screen.getByText('Feria de agosto').closest('tr')).not.toHaveClass('bg-bad-50');
    expect(screen.getByText('08:30 – sin fin')).toBeInTheDocument();
    expect(screen.getByText('Equipo')).toBeInTheDocument();
  });

  it('la fila entera también abre el detalle', async () => {
    montar('/informes?mes=2026-08');
    const fila = (await screen.findByRole('button', { name: 'Luis Gil' })).closest('tr');
    fireEvent.click(fila.querySelectorAll('td')[1]);
    await waitFor(() => expect(informesService.getDetalleTecnico).toHaveBeenCalledWith('8', '2026-08'));
  });

  it('«Descargar PDF» genera el PDF con el detalle', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    await screen.findByText('Feria de agosto');
    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(descargarPdfTecnico).toHaveBeenCalledWith(DETALLE));
  });

  it('pulsar un servicio abre su detalle encima, sin salir de Informes', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Feria de agosto' }));
    expect(screen.getByTestId('detalle-asignacion')).toHaveTextContent('Asignación 1');
    expect(screen.getByTestId('ruta')).toHaveTextContent('/informes?mes=2026-08&detalle=7&ver=1');
    // el panel del técnico sigue debajo, sin recargar la tabla
    expect(screen.getByText('Feria de agosto')).toBeInTheDocument();
  });

  it('una asignación del modelo antiguo también se abre, pulsando la fila', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    const titulo = await screen.findByRole('button', { name: 'Asignación #2' });
    fireEvent.click(titulo.closest('tr').querySelectorAll('td')[3]);
    expect(screen.getByTestId('detalle-asignacion')).toHaveTextContent('Asignación 2');
  });

  it('al cerrar el servicio se vuelve al técnico, donde estaba, y se recargan sus horas', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Feria de agosto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asignación' }));
    await waitFor(() => expect(screen.queryByTestId('detalle-asignacion')).not.toBeInTheDocument());
    expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/informes\?mes=2026-08&detalle=7$/);
    expect(screen.getByText('Feria de agosto')).toBeInTheDocument();
    await waitFor(() => expect(informesService.getDetalleTecnico).toHaveBeenCalledTimes(2));
    // y las cifras del informe de debajo, sin spinner (la tabla no se desmonta)
    await waitFor(() => expect(informesService.getMensual).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Luis Gil' })).toBeInTheDocument();
  });

  it('con un servicio encima, los botones del técnico no se pueden usar', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Feria de agosto' }));
    const pie = screen.getAllByRole('button', { name: 'Cerrar' }).at(-1);
    expect(pie).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
  });

  it('con un servicio abierto, Escape no cierra también el panel del técnico', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Feria de agosto' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('ruta')).toHaveTextContent('detalle=7&ver=1');
  });

  it('cerrar quita el detalle de la URL', async () => {
    montar('/informes?mes=2026-08&detalle=7');
    await screen.findByText('Feria de agosto');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' }).at(-1));   // el del pie; la X también se llama así
    await waitFor(() => expect(screen.queryByText('Feria de agosto')).not.toBeInTheDocument());
    expect(screen.getByTestId('donde')).not.toHaveTextContent('detalle');
  });
});
