import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/informes.service.js', () => ({
  informesService: { getMensual: vi.fn() },
}));

import { informesService }      from '../../../services/informes.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import Informes                 from '../../../pages/informes/Informes.jsx';

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

function montar() {
  return render(
    <NotificationProvider>
      <MemoryRouter><Informes /></MemoryRouter>
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

    expect(screen.getByRole('tab', { name: 'Horas de asignación' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('columnheader', { name: 'Horas con asignación activa' })).toBeInTheDocument();
    // Luis (75 h) antes que Ana (61 h 30 min); total 136 h 30 min
    expect(filas()[0]).toMatch(/^Luis Gil75 h/);
    expect(filas()[1]).toMatch(/^Ana Ruiz61 h 30 min/);
    expect(filas()[2]).toMatch(/^Total136 h 30 min121$/);

    fireEvent.click(screen.getByRole('tab', { name: 'Horas de evento/servicio' }));
    expect(screen.getByRole('columnheader', { name: 'Horas con evento/servicio activo' })).toBeInTheDocument();
    expect(filas()[0]).toMatch(/^Ana Ruiz33 h 15 min/);
    expect(filas()[2]).toMatch(/^Total43 h 15 min82$/);

    fireEvent.click(screen.getByRole('tab', { name: 'Puntualidad' }));
    expect(screen.getByRole('columnheader', { name: 'Cierres tardíos' })).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('un informe sin tiempos por técnico (archivado viejo) pinta «—»', async () => {
    const { minutos_asignacion, asignaciones_medidas, ...sinTiempo } = DATOS.actual.por_tecnico[0];
    informesService.getMensual.mockResolvedValue({ ...DATOS, actual: { ...DATOS.actual, por_tecnico: [sinTiempo] } });
    montar();
    const celdas = (await screen.findByText('Ana Ruiz')).closest('tr').querySelectorAll('td');
    expect(celdas[1]).toHaveTextContent('—');
    expect(celdas[2]).toHaveTextContent('—');
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
