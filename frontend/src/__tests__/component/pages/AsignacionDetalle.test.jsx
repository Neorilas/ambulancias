import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { get: vi.fn(), crearIncidencia: vi.fn(), registrarLlegada: vi.fn(), registrarFinServicio: vi.fn(),
    iniciarJornada: vi.fn(), finalizarJornada: vi.fn() },
}));
vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
// Las revisiones de inicio y fin tienen sus propios tests: aquí solo importa
// cuándo se abren y que el «atrás» vuelva de ellas al detalle.
vi.mock('../../../pages/asignaciones/FinalizacionAsignacion.jsx', () => ({
  default: ({ onCancel }) => (
    <><p>revisión de fin</p><button onClick={onCancel}>cancelar la revisión</button></>
  ),
}));
// Los flags se fijan por test: el enlace al trabajo depende de su pantalla.
const flags = vi.hoisted(() => ({ activos: [] }));
vi.mock('../../../context/FeaturesContext.jsx', () => ({
  useFeatures: () => ({ features: flags.activos, isFeatureEnabled: (k) => flags.activos.includes(k) }),
}));

import { asignacionesService }  from '../../../services/asignaciones.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import { PREFIJO }              from '../../../utils/sessionStorage.js';
import { formatDateTime }       from '../../../utils/dateUtils.js';
import AsignacionDetalle        from '../../../pages/asignaciones/AsignacionDetalle.jsx';

const BASE = {
  id: 5, vehicle_id: 7, user_id: 2, estado: 'finalizada',
  vehiculo_alias: 'Ambulancia 3', matricula: '1234BCD',
  responsable_nombre: 'Jose Lopez', responsable_username: 'jlopez',
  fecha_inicio: '2026-09-21T06:00:00.000Z', fecha_fin: '2026-09-21T14:00:00.000Z',
  inicio_real_at: '2026-09-21T06:07:00.000Z', finalizado_at: '2026-09-21T14:23:00.000Z',
  km_inicio: 1000, km_fin: 1100,
  evidencias: [], incidencias: [],
  progreso: { inicio: { completado: 7, total: 7 }, fin: { completado: 7, total: 7 } },
};

// En la app el detalle va siempre bajo el router: los pasos de inicio y fin
// se abren con `?paso=` en la URL (usePanelEnUrl)
function montar() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <AuthProvider>
          <AsignacionDetalle id={5} onClose={() => {}} />
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>
  );
}


// La etiqueta de un dato de la ficha. La barra de pasos (PasosAsignacion)
// repite los nombres de los botones, así que se busca fuera de ella.
async function etiquetaDato(texto) {
  const todas = await screen.findAllByText(texto);
  return todas.find(el => !el.closest('[data-testid="pasos-asignacion"]'));
}

describe('AsignacionDetalle — horas reales', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'],
    }));
  });

  it('muestra la hora real de fin junto a la de inicio', async () => {
    asignacionesService.get.mockResolvedValue(BASE);
    montar();

    expect(await screen.findByText('Fin en base')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE.finalizado_at))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE.inicio_real_at))).toBeInTheDocument();
  });

  it('en una asignación aún abierta el fin real sale como guion', async () => {
    asignacionesService.get.mockResolvedValue({ ...BASE, estado: 'activa', finalizado_at: null });
    montar();

    const etiqueta = await screen.findByText('Fin en base');
    expect(etiqueta.nextElementSibling).toHaveTextContent('—');
  });

  it('sin ninguna hora real no pinta la fila', async () => {
    asignacionesService.get.mockResolvedValue({
      ...BASE, estado: 'programada', inicio_real_at: null, finalizado_at: null,
    });
    montar();

    await screen.findByText('Fin previsto en base');
    expect(screen.queryByText('Fin en base')).not.toBeInTheDocument();
  });
});

describe('AsignacionDetalle — editar', () => {
  const ACTIVA_CON_FOTOS = {
    ...BASE, estado: 'activa', finalizado_at: null, notas: 'Llevar camilla',
    responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }],
    personal: [],
    evidencias: [{ id: 9, tipo_imagen: 'delantera', momento: 'inicio', image_url: 'x.jpg' }],
    progreso: { inicio: { completado: 7, total: 7, completo: true }, fin: { completado: 0, total: 7 } },
  };

  function comoUsuario(u) {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify(u));
  }

  it('gestión puede editar una activa con las fotos de inicio ya subidas', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue(ACTIVA_CON_FOTOS);
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(await screen.findByText('Editar asignación')).toBeInTheDocument();
    expect(screen.getByText(/Servicio en curso/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Llevar camilla')).toBeInTheDocument();
  });

  it('una finalizada no se edita', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue(BASE);
    montar();

    await screen.findByText('Fin en base');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('el técnico responsable no ve el botón', async () => {
    comoUsuario({ id: 2, username: 'jlopez', roles: ['tecnico'], permissions: [] });
    asignacionesService.get.mockResolvedValue(ACTIVA_CON_FOTOS);
    montar();

    await screen.findByText('Fin previsto en base');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});

describe('AsignacionDetalle — llegada a evento/servicio', () => {
  const ACTIVA_TRAS_INICIO = {
    ...BASE, estado: 'activa', finalizado_at: null, llegada_servicio_at: null,
    responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }],
    personal: [],
    progreso: { inicio: { completado: 7, total: 7, completo: true }, fin: { completado: 0, total: 7 } },
  };

  function comoTecnico() {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 2, username: 'jlopez', roles: ['tecnico'], permissions: [],
    }));
  }

  beforeEach(() => { vi.clearAllMocks(); comoTecnico(); });

  it('con las fotos de inicio hechas ofrece la llegada, sin impedir finalizar', async () => {
    // Opcional a propósito: quien se olvide de pulsarla tiene que poder cerrar.
    asignacionesService.get.mockResolvedValue(ACTIVA_TRAS_INICIO);
    montar();

    expect(await screen.findByRole('button', { name: 'Inicio evento/servicio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalizar asignación' })).toBeInTheDocument();
  });

  // Un solo botón principal cada vez (2026-10-12): mientras falta el evento,
  // ese es el azul y «Finalizar» queda en secundario, sin desaparecer.
  it('con el evento por marcar, «Finalizar asignación» va en secundario', async () => {
    asignacionesService.get.mockResolvedValue(ACTIVA_TRAS_INICIO);
    montar();

    expect(await screen.findByRole('button', { name: 'Inicio evento/servicio' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Finalizar asignación' })).toHaveClass('btn-secondary');
  });

  it('con el evento terminado, «Finalizar asignación» vuelve a ser el principal', async () => {
    asignacionesService.get.mockResolvedValue({
      ...ACTIVA_TRAS_INICIO,
      llegada_servicio_at: '2026-09-21T06:40:00.000Z', fin_servicio_at: '2026-09-21T12:00:00.000Z',
    });
    montar();

    expect(await screen.findByRole('button', { name: 'Finalizar asignación' })).toHaveClass('btn-primary');
  });

  it('la barra de pasos marca el que toca y la etiqueta dice «En curso», no «Activa»', async () => {
    asignacionesService.get.mockResolvedValue(ACTIVA_TRAS_INICIO);
    montar();

    const barra = await screen.findByTestId('pasos-asignacion');
    const actual = barra.querySelector('[aria-current="step"]');
    expect(actual).toHaveTextContent('Inicio evento/servicio');
    expect(screen.getByText('En curso')).toBeInTheDocument();
    expect(screen.queryByText('Activa')).not.toBeInTheDocument();
  });

  it('sin pulsar el inicio, la tarjeta lo dice así y su botón es «Empezar»', async () => {
    asignacionesService.get.mockResolvedValue({
      ...ACTIVA_TRAS_INICIO, inicio_real_at: null,
      progreso: { inicio: { completado: 0, total: 7, completo: false }, fin: { completado: 0, total: 7 } },
    });
    montar();

    expect(await screen.findByRole('button', { name: 'Empezar' })).toBeInTheDocument();
    expect(screen.getByText('Sin iniciar')).toBeInTheDocument();
    expect(screen.queryByText('Faltan fotos de inicio')).not.toBeInTheDocument();
  });

  it('al pulsarla registra la llegada y el botón desaparece', async () => {
    asignacionesService.get.mockResolvedValue(ACTIVA_TRAS_INICIO);
    asignacionesService.registrarLlegada.mockResolvedValue({
      ...ACTIVA_TRAS_INICIO, llegada_servicio_at: '2026-09-21T06:40:00.000Z',
    });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Inicio evento/servicio' }));
    await waitFor(() => expect(asignacionesService.registrarLlegada).toHaveBeenCalledWith(5));
    expect(await screen.findByRole('button', { name: 'Finalizar asignación' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inicio evento/servicio' })).not.toBeInTheDocument();
  });

  // §8 del mapa, «La navegación hacia atrás»: la revisión de fin se abre a
  // pantalla completa con `?paso=fin`, y el «atrás» del móvil vuelve al detalle
  it('el «atrás» del móvil desde la revisión de fin vuelve al detalle', async () => {
    function Atras() {
      const { search } = useLocation();
      const navigate = useNavigate();
      return <><p data-testid="url">{search}</p><button onClick={() => navigate(-1)}>atrás del móvil</button></>;
    }
    asignacionesService.get.mockResolvedValue(ACTIVA_TRAS_INICIO);
    render(
      <MemoryRouter initialEntries={['/trabajos/1?ver=5']}>
        <NotificationProvider>
          <AuthProvider>
            <AsignacionDetalle id={5} onClose={() => {}} desdeTrabajo />
            <Atras />
          </AuthProvider>
        </NotificationProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Finalizar asignación' }));
    expect(screen.getByText('revisión de fin')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('?ver=5&paso=fin');

    fireEvent.click(screen.getByRole('button', { name: 'atrás del móvil' }));
    await waitFor(() => expect(screen.queryByText('revisión de fin')).not.toBeInTheDocument());
    expect(screen.getByTestId('url')).toHaveTextContent(/^\?ver=5$/);
    expect(screen.getByRole('button', { name: 'Finalizar asignación' })).toBeInTheDocument();
  });

  it('cancelar la revisión vuelve al detalle sin dejar un «atrás» de más', async () => {
    asignacionesService.get.mockResolvedValue(ACTIVA_TRAS_INICIO);
    render(
      <MemoryRouter initialEntries={['/trabajos/1?ver=5&paso=fin']}>
        <NotificationProvider>
          <AuthProvider>
            <AsignacionDetalle id={5} onClose={() => {}} desdeTrabajo />
          </AuthProvider>
        </NotificationProvider>
      </MemoryRouter>
    );
    // Un `?paso=` que no puso la app (un enlace) no salta a mitad del flujo
    const finalizar = await screen.findByRole('button', { name: 'Finalizar asignación' });
    expect(screen.queryByText('revisión de fin')).not.toBeInTheDocument();
    fireEvent.click(finalizar);
    expect(screen.getByText('revisión de fin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'cancelar la revisión' }));
    await waitFor(() => expect(screen.queryByText('revisión de fin')).not.toBeInTheDocument());
  });

  it('sin las fotos de inicio no ofrece la llegada', async () => {
    asignacionesService.get.mockResolvedValue({
      ...ACTIVA_TRAS_INICIO,
      progreso: { inicio: { completado: 3, total: 7, completo: false }, fin: { completado: 0, total: 7 } },
    });
    montar();

    await screen.findByText('Faltan fotos de inicio');
    expect(screen.queryByRole('button', { name: 'Inicio evento/servicio' })).not.toBeInTheDocument();
  });

  it('en una finalizada, el admin ve la hora de llegada y lo que tardó desde el inicio', async () => {
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'],
    }));
    asignacionesService.get.mockResolvedValue({ ...BASE, llegada_servicio_at: '2026-09-21T06:40:00.000Z' });
    montar();

    const etiqueta = await etiquetaDato('Inicio evento/servicio');
    expect(etiqueta.nextElementSibling).toHaveTextContent(formatDateTime('2026-09-21T06:40:00.000Z'));
    expect(etiqueta.nextElementSibling).toHaveTextContent('33 min desde el inicio');
  });

  it('una finalizada sin llegada registrada (anterior al botón) sale con guion', async () => {
    asignacionesService.get.mockResolvedValue({ ...BASE, llegada_servicio_at: null });
    montar();

    const etiqueta = await etiquetaDato('Inicio evento/servicio');
    expect(etiqueta.nextElementSibling).toHaveTextContent('—');
  });
});

describe('AsignacionDetalle — fin del evento/servicio', () => {
  const TRAS_LLEGADA = {
    ...BASE, estado: 'activa', finalizado_at: null,
    llegada_servicio_at: '2026-09-21T06:40:00.000Z', fin_servicio_at: null,
    responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }],
    personal: [],
    progreso: { inicio: { completado: 7, total: 7, completo: true }, fin: { completado: 0, total: 7 } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 2, username: 'jlopez', roles: ['tecnico'], permissions: [],
    }));
  });

  it('sin llegada no lo ofrece', async () => {
    asignacionesService.get.mockResolvedValue({ ...TRAS_LLEGADA, llegada_servicio_at: null });
    montar();

    await screen.findByRole('button', { name: 'Inicio evento/servicio' });
    expect(screen.queryByRole('button', { name: 'Fin evento/servicio' })).not.toBeInTheDocument();
  });

  it('tras la llegada lo ofrece, sin impedir finalizar la asignación', async () => {
    asignacionesService.get.mockResolvedValue(TRAS_LLEGADA);
    montar();

    expect(await screen.findByRole('button', { name: 'Fin evento/servicio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalizar asignación' })).toBeInTheDocument();
  });

  it('al pulsarlo lo registra, el botón desaparece y sale el tiempo en el evento', async () => {
    asignacionesService.get.mockResolvedValue(TRAS_LLEGADA);
    asignacionesService.registrarFinServicio.mockResolvedValue({
      ...TRAS_LLEGADA, fin_servicio_at: '2026-09-21T09:10:00.000Z',
    });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Fin evento/servicio' }));
    await waitFor(() => expect(asignacionesService.registrarFinServicio).toHaveBeenCalledWith(5, null));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Fin evento/servicio' })).not.toBeInTheDocument());
    const etiqueta = await etiquetaDato('Fin evento/servicio');
    expect(etiqueta.nextElementSibling).toHaveTextContent(formatDateTime('2026-09-21T09:10:00.000Z'));
    expect(etiqueta.nextElementSibling).toHaveTextContent('2h 30min en el evento');
  });

  // Antes de fecha_fin el motivo es obligatorio, y se pide aquí, no al
  // finalizar la asignación.
  it('antes de la hora prevista exige el motivo y lo manda', async () => {
    const futuro = new Date(Date.now() + 3600000).toISOString();
    asignacionesService.get.mockResolvedValue({ ...TRAS_LLEGADA, fecha_fin: futuro });
    asignacionesService.registrarFinServicio.mockResolvedValue({
      ...TRAS_LLEGADA, fecha_fin: futuro, fin_servicio_at: '2026-09-21T09:10:00.000Z', motivo_fin: 'Traslado cancelado',
    });
    montar();

    const boton = await screen.findByRole('button', { name: 'Fin evento/servicio' });
    expect(boton).toBeDisabled();
    const campo = screen.getByPlaceholderText(/terminas antes de lo previsto/);
    // Mientras se escribe no se avisa de nada; solo al intentar enviarlo.
    fireEvent.change(campo, { target: { value: '  ok  ' } });
    expect(boton).toBeEnabled();
    expect(screen.queryByText(/al menos 5 caracteres/)).not.toBeInTheDocument();
    fireEvent.click(boton);
    expect(screen.getByText(/al menos 5 caracteres/)).toBeInTheDocument();
    // Una letra repetida no se explica: mensaje genérico, sin pista de la regla.
    fireEvent.change(campo, { target: { value: 'aaaaa' } });
    expect(screen.queryByText(/al menos 5 caracteres/)).not.toBeInTheDocument();
    fireEvent.click(boton);
    expect(screen.getByText('Escribe un motivo válido')).toBeInTheDocument();
    expect(asignacionesService.registrarFinServicio).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: '  Traslado cancelado ' } });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    await waitFor(() => expect(asignacionesService.registrarFinServicio).toHaveBeenCalledWith(5, 'Traslado cancelado'));
    expect(await screen.findByText('Traslado cancelado')).toBeInTheDocument();
  });

  // El reloj del móvil puede ir adelantado: si el servidor exige el motivo,
  // el campo aparece aunque la pantalla creyera que ya era la hora.
  it('si el servidor exige el motivo, enseña el campo', async () => {
    asignacionesService.get.mockResolvedValue(TRAS_LLEGADA);
    asignacionesService.registrarFinServicio.mockRejectedValue({ response: { status: 400, data: {
      message: 'Hay que explicar el motivo', errors: [{ field: 'motivo_fin', msg: 'obligatorio' }],
    } } });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Fin evento/servicio' }));
    expect(await screen.findByPlaceholderText(/terminas antes de lo previsto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fin evento/servicio' })).toBeDisabled();
  });

  it('pasada la hora prevista no pide motivo', async () => {
    asignacionesService.get.mockResolvedValue(TRAS_LLEGADA);
    montar();

    expect(await screen.findByRole('button', { name: 'Fin evento/servicio' })).toBeEnabled();
    expect(screen.queryByPlaceholderText(/terminas antes de lo previsto/)).not.toBeInTheDocument();
  });

  it('una finalizada sin fin del evento/servicio registrado sale con guion', async () => {
    asignacionesService.get.mockResolvedValue({ ...BASE, fin_servicio_at: null });
    montar();

    const etiqueta = await etiquetaDato('Fin evento/servicio');
    expect(etiqueta.nextElementSibling).toHaveTextContent('—');
  });
});

describe('AsignacionDetalle — fotos de inicio subidas tarde', () => {
  const CON_TARDIA = {
    ...BASE,
    evidencias: [
      { id: 1, tipo_imagen: 'frontal', momento: 'inicio', image_url: 'a.jpg',
        uploaded_at: '2026-09-21T06:10:00.000Z', retraso_min: 3, tardia: false },
      { id: 2, tipo_imagen: 'trasera', momento: 'inicio', image_url: 'b.jpg',
        uploaded_at: '2026-09-21T07:42:00.000Z', retraso_min: 95, tardia: true },
    ],
    fotos_inicio_tarde: { fotos: 1, max_retraso_min: 95, umbral_min: 30 },
  };

  function comoUsuario(u) {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify(u));
  }

  it('gestión ve el aviso y la marca en la foto tardía', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue(CON_TARDIA);
    montar();

    const aviso = await screen.findByTestId('aviso-fotos-inicio-tarde');
    expect(aviso).toHaveTextContent('1 foto se subió más de 30 min después del inicio de la asignación');
    expect(aviso).toHaveTextContent('hasta 1h 35min después');
    // Solo la tardía lleva la marca
    expect(screen.getByText('+1h 35min')).toBeInTheDocument();
    expect(screen.queryByText('+3 min')).not.toBeInTheDocument();
  });

  it('el técnico no ve nada', async () => {
    comoUsuario({ id: 2, username: 'jlopez', roles: ['tecnico'], permissions: [] });
    asignacionesService.get.mockResolvedValue({
      ...CON_TARDIA, responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }],
    });
    montar();

    await screen.findByText('Fin previsto en base');
    expect(screen.queryByTestId('aviso-fotos-inicio-tarde')).not.toBeInTheDocument();
    expect(screen.queryByText('+1h 35min')).not.toBeInTheDocument();
  });

  it('sin fotos tardías no hay aviso', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue({ ...CON_TARDIA, fotos_inicio_tarde: null });
    montar();

    await screen.findByText('Fin previsto en base');
    expect(screen.queryByTestId('aviso-fotos-inicio-tarde')).not.toBeInTheDocument();
  });
});

// El backend solo manda `revisar_fin_evento` a admin, gestor y superadmin que
// no van en la ambulancia ni coordinan su trabajo: la ficha pinta lo que llega.
describe('AsignacionDetalle — revisión del fin del evento', () => {
  const CON_MARCA = {
    ...BASE,
    llegada_servicio_at: '2026-09-21T08:00:00.000Z', fin_servicio_at: '2026-09-21T14:19:00.000Z',
    revisar_fin_evento: { motivo: 'pegado', minutos: 4, umbral_min: 15 },
  };

  it('enseña el aviso bajo el fin del evento', async () => {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] }));
    asignacionesService.get.mockResolvedValue(CON_MARCA);
    montar();

    const aviso = await screen.findByTestId('aviso-revisar-fin-evento');
    expect(aviso).toHaveTextContent('A revisar');
    expect(aviso).toHaveTextContent('Se pulsó 4 min antes de finalizar la asignación');
    expect(aviso).toHaveTextContent('umbral: 15 min');
  });

  it('sin «Fin evento/servicio» lo dice, y si tampoco hubo llegada también', async () => {
    asignacionesService.get.mockResolvedValue({
      ...CON_MARCA, llegada_servicio_at: null, fin_servicio_at: null,
      revisar_fin_evento: { motivo: 'sin_fin', umbral_min: 15 },
    });
    montar();

    const aviso = await screen.findByTestId('aviso-revisar-fin-evento');
    expect(aviso).toHaveTextContent('Se finalizó la asignación sin pulsar «Fin evento/servicio»');
    expect(aviso).toHaveTextContent('tampoco consta el inicio del evento/servicio');
  });

  it('sin la marca no hay aviso', async () => {
    asignacionesService.get.mockResolvedValue({ ...CON_MARCA, revisar_fin_evento: undefined });
    montar();

    await screen.findByText('Fin previsto en base');
    expect(screen.queryByTestId('aviso-revisar-fin-evento')).not.toBeInTheDocument();
  });
});

// ── v33: la asignación dentro de su trabajo ──────────────────
describe('AsignacionDetalle — su trabajo', () => {
  const TRABAJO = {
    id: 40, nombre: 'Maratón', descripcion: 'Cobertura de la carrera', ubicacion: 'Retiro',
    coordinador: { id: 9, nombre: 'Carla', apellidos: 'Ruiz' },
  };
  const conTrabajo = (extra = {}) => ({
    ...BASE, estado: 'activa', finalizado_at: null, trabajo_id: 40, trabajo: TRABAJO,
    responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }],
    personal: [{ id: 3, nombre: 'Eva', apellidos: 'Gil', username: 'egil' }],
    ...extra,
  });
  const comoUsuario = (u) => localStorage.setItem(PREFIJO + 'user', JSON.stringify(u));
  const montarEnRouter = (props = {}) => render(
    <MemoryRouter>
      <NotificationProvider>
        <AuthProvider>
          <AsignacionDetalle id={5} onClose={() => {}} {...props} />
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    flags.activos = ['menu_mis_trabajos'];
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
  });

  it('enseña el trabajo (título, ubicación, descripción, coordinador) y enlaza a él', async () => {
    comoUsuario({ id: 3, username: 'egil', roles: ['enfermero'], permissions: [] });
    asignacionesService.get.mockResolvedValue(conTrabajo());
    montarEnRouter();

    const bloque = await screen.findByTestId('trabajo-de-asignacion');
    expect(bloque).toHaveTextContent('Maratón');
    expect(bloque).toHaveTextContent('Retiro');
    expect(bloque).toHaveTextContent('Cobertura de la carrera');
    expect(bloque).toHaveTextContent('Coordina Carla Ruiz');
    expect(screen.getByRole('link', { name: /Ver trabajo/ })).toHaveAttribute('href', '/trabajos/40?asignacion=5');
  });

  it('el equipo se llama «Equipo», no «Personal» (D8)', async () => {
    comoUsuario({ id: 3, username: 'egil', roles: ['enfermero'], permissions: [] });
    asignacionesService.get.mockResolvedValue(conTrabajo());
    montarEnRouter();

    expect(await screen.findByText('Equipo')).toBeInTheDocument();
    expect(screen.getByText(/Vas en el/)).toHaveTextContent('Vas en el equipo de esta ambulancia');
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
  });

  it('sin la pantalla de trabajos, o abierto desde el propio trabajo, no enlaza', async () => {
    comoUsuario({ id: 3, username: 'egil', roles: ['enfermero'], permissions: [] });
    asignacionesService.get.mockResolvedValue(conTrabajo());
    flags.activos = [];
    const { unmount } = montarEnRouter();
    await screen.findByTestId('trabajo-de-asignacion');
    expect(screen.queryByRole('link', { name: /Ver trabajo/ })).not.toBeInTheDocument();
    unmount();

    flags.activos = ['menu_mis_trabajos'];
    montarEnRouter({ desdeTrabajo: true });
    await screen.findByTestId('trabajo-de-asignacion');
    expect(screen.queryByRole('link', { name: /Ver trabajo/ })).not.toBeInTheDocument();
  });

  it('al coordinador le explica que la ve pero no la opera (D2)', async () => {
    comoUsuario({ id: 9, username: 'carla', roles: [], permissions: [] });
    asignacionesService.get.mockResolvedValue(conTrabajo());
    montarEnRouter();

    expect(await screen.findByText(/Coordinas este trabajo/)).toBeInTheDocument();
  });

  it('con varios coordinadores (v35): los nombra a todos y el segundo también la ve como coordinador', async () => {
    comoUsuario({ id: 10, username: 'pablo', roles: [], permissions: [] });
    asignacionesService.get.mockResolvedValue(conTrabajo({ trabajo: { ...TRABAJO,
      coordinadores: [{ id: 9, nombre: 'Carla', apellidos: 'Ruiz' }, { id: 10, nombre: 'Pablo', apellidos: 'Gil' }] } }));
    montarEnRouter();

    const bloque = await screen.findByTestId('trabajo-de-asignacion');
    expect(bloque).toHaveTextContent('Coordinan Carla Ruiz, Pablo Gil');
    expect(screen.getByText(/Coordinas este trabajo/)).toBeInTheDocument();
  });

  it('una asignación sin trabajo no pinta el bloque', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue({ ...BASE, trabajo: null });
    montarEnRouter();

    await screen.findByText('Fin previsto en base');
    expect(screen.queryByTestId('trabajo-de-asignacion')).not.toBeInTheDocument();
  });
});

// Jornadas por día (v39): «Inicio/Fin de jornada» sustituyen a la pareja del evento
describe('AsignacionDetalle — jornadas por día', () => {
  const H = 3600000;
  const en = (h) => new Date(Date.now() + h * H).toISOString();
  const jornada = (id, desdeH, hastaH, over = {}) => ({
    id, inicio: en(desdeH), fin: en(hastaH), inicio_real_at: null, fin_real_at: null, cierre_auto: false, ...over,
  });
  const ACTIVA = {
    ...BASE, estado: 'activa', finalizado_at: null, llegada_servicio_at: null, fin_servicio_at: null,
    fecha_inicio: en(-30), fecha_fin: en(40), inicio_real_at: en(-30),
    responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }], personal: [],
    progreso: { inicio: { completado: 7, total: 7, completo: true }, fin: { completado: 0, total: 7 } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({ id: 2, username: 'jlopez', roles: ['tecnico'], permissions: [] }));
  });

  it('ofrece «Inicio de jornada» y no los botones del evento; la barra tiene tres pasos', async () => {
    asignacionesService.get.mockResolvedValue({ ...ACTIVA,
      jornadas: [jornada(10, -26, -16, { inicio_real_at: en(-26), fin_real_at: en(-16) }), jornada(11, 0.2, 10)] });
    asignacionesService.iniciarJornada.mockResolvedValue({ ...ACTIVA, jornadas: [] });
    montar();

    const boton = await screen.findByRole('button', { name: 'Inicio de jornada' });
    expect(boton).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Inicio evento/servicio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalizar asignación' })).toHaveClass('btn-secondary');
    const barra = screen.getByTestId('pasos-asignacion');
    expect(barra.querySelectorAll('li')).toHaveLength(3);
    expect(barra.querySelector('[aria-current="step"]')).toHaveTextContent('1 de 2');
    expect(screen.getByTestId('lista-jornadas')).toBeInTheDocument();

    fireEvent.click(boton);
    await waitFor(() => expect(asignacionesService.iniciarJornada).toHaveBeenCalledWith(5, 11));
  });

  it('con una en curso: «Fin de jornada», y no deja finalizar la asignación', async () => {
    asignacionesService.get.mockResolvedValue({ ...ACTIVA,
      jornadas: [jornada(11, -2, 0.2, { inicio_real_at: en(-2) })] });
    asignacionesService.finalizarJornada.mockResolvedValue({ ...ACTIVA, jornadas: [] });
    montar();

    const boton = await screen.findByRole('button', { name: 'Fin de jornada' });
    expect(screen.queryByRole('button', { name: 'Finalizar asignación' })).not.toBeInTheDocument();
    fireEvent.click(boton);
    await waitFor(() => expect(asignacionesService.finalizarJornada).toHaveBeenCalledWith(5, 11, null));
  });

  it('más de 30 min antes del fin previsto pide el motivo y lo manda', async () => {
    asignacionesService.get.mockResolvedValue({ ...ACTIVA,
      jornadas: [jornada(11, -2, 3, { inicio_real_at: en(-2) })] });
    asignacionesService.finalizarJornada.mockResolvedValue({ ...ACTIVA, jornadas: [] });
    montar();

    const boton = await screen.findByRole('button', { name: 'Fin de jornada' });
    expect(boton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/por qué terminas antes/), { target: { value: 'Se suspende la tarde' } });
    fireEvent.click(boton);
    await waitFor(() => expect(asignacionesService.finalizarJornada).toHaveBeenCalledWith(5, 11, 'Se suspende la tarde'));
  });

  it('con la siguiente ya disponible y la anterior olvidada, avisa de que se cerrará sola', async () => {
    asignacionesService.get.mockResolvedValue({ ...ACTIVA,
      jornadas: [jornada(10, -26, -16, { inicio_real_at: en(-26) }), jornada(11, 0.2, 10)] });
    montar();

    expect(await screen.findByRole('button', { name: 'Inicio de jornada' })).toBeInTheDocument();
    expect(screen.getByText(/se cerrará sola a su hora prevista/)).toBeInTheDocument();
  });

  it('antes de la media hora previa, el botón espera y dice desde cuándo', async () => {
    asignacionesService.get.mockResolvedValue({ ...ACTIVA, jornadas: [jornada(11, 5, 15)] });
    montar();

    expect(await screen.findByRole('button', { name: /^Inicio de jornada · desde/ })).toBeDisabled();
  });

  it('la lista marca la que se cerró sola para revisar', async () => {
    asignacionesService.get.mockResolvedValue({ ...ACTIVA, estado: 'finalizada', finalizado_at: en(-1),
      jornadas: [jornada(10, -26, -16, { inicio_real_at: en(-26), fin_real_at: en(-16), cierre_auto: true })] });
    montar();

    expect(await screen.findByText('Se cerró sola · a revisar')).toBeInTheDocument();
  });
});

