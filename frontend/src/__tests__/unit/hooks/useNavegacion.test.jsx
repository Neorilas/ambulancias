import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  hayAtrasEnLaApp, useVolver, useEstadoEnUrl, usePanelEnUrl, useBuscadorEnUrl, paginaDeUrl,
} from '../../../hooks/useNavegacion.js';

function Url() {
  const { pathname, search } = useLocation();
  return <p data-testid="url">{pathname}{search}</p>;
}

function Ficha() {
  const volver = useVolver('/listado');
  return <button onClick={volver}>‹</button>;
}

function montarFicha(entradas) {
  render(
    <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
      <Routes>
        <Route path="/ficha" element={<Ficha />} />
        <Route path="*" element={null} />
      </Routes>
      <Url />
    </MemoryRouter>
  );
}

describe('hayAtrasEnLaApp', () => {
  afterEach(() => window.history.replaceState(null, ''));

  it('la primera entrada del router no tiene nada detrás', () => {
    expect(hayAtrasEnLaApp({ key: 'default' })).toBe(false);
  });

  // Un `replace` cambia la key pero conserva el idx: sigue siendo la primera
  it('en el navegador manda el idx que guarda el router', () => {
    window.history.replaceState({ idx: 0 }, '');
    expect(hayAtrasEnLaApp({ key: 'abc' })).toBe(false);
    window.history.replaceState({ idx: 3 }, '');
    expect(hayAtrasEnLaApp({ key: 'abc' })).toBe(true);
  });
});

describe('useVolver', () => {
  it('con pantalla anterior, vuelve a ella tal cual (con su URL entera)', async () => {
    montarFicha(['/listado?page=3&estado=activo', '/ficha']);
    await userEvent.click(screen.getByRole('button', { name: '‹' }));
    expect(screen.getByTestId('url')).toHaveTextContent('/listado?page=3&estado=activo');
  });

  // Un aviso push abre la ficha en una ventana nueva: «‹» no hacía nada
  it('sin pantalla anterior, va a la alternativa', async () => {
    montarFicha(['/ficha']);
    await userEvent.click(screen.getByRole('button', { name: '‹' }));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/listado$/);
  });
});

describe('useEstadoEnUrl', () => {
  function Listado() {
    const [url, cambiar] = useEstadoEnUrl({ page: '1', estado: 'todas' });
    return (
      <>
        <p>página {url.page}, estado {url.estado}</p>
        <button onClick={() => cambiar({ estado: 'activa', page: 1 })}>activas</button>
        <button onClick={() => cambiar({ page: 2 })}>página 2</button>
        <button onClick={() => cambiar({ estado: 'todas' })}>todas</button>
      </>
    );
  }
  const montar = (ruta) => render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes><Route path="/l" element={<Listado />} /></Routes>
      <Url />
    </MemoryRouter>
  );

  it('sin nada en la URL, los valores por defecto', () => {
    montar('/l');
    expect(screen.getByText('página 1, estado todas')).toBeInTheDocument();
  });

  it('lo de por defecto no se escribe; lo demás de la URL se respeta', async () => {
    montar('/l?id=9');
    await userEvent.click(screen.getByRole('button', { name: 'página 2' }));
    expect(screen.getByTestId('url')).toHaveTextContent('/l?id=9&page=2');
    await userEvent.click(screen.getByRole('button', { name: 'activas' }));
    expect(screen.getByTestId('url')).toHaveTextContent('/l?id=9&estado=activa');
    await userEvent.click(screen.getByRole('button', { name: 'todas' }));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/l\?id=9$/);
  });
});

describe('usePanelEnUrl', () => {
  function Pantalla({ alCerrar, soloDesdeLaApp }) {
    const [abierto, abrir, cerrar] = usePanelEnUrl('ver', { alCerrar, soloDesdeLaApp });
    const navigate = useNavigate();
    return (
      <>
        <p>{abierto ? `panel ${abierto}` : 'sin panel'}</p>
        <button onClick={() => abrir(7)}>abrir</button>
        <button onClick={cerrar}>cerrar</button>
        <button onClick={() => navigate(-1)}>atrás</button>
      </>
    );
  }
  const montar = (entradas, props = {}) => render(
    <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
      <Routes>
        <Route path="/p" element={<Pantalla {...props} />} />
        <Route path="/antes" element={<p>pantalla anterior</p>} />
      </Routes>
      <Url />
    </MemoryRouter>
  );

  it('abrir pone el parámetro con push: «atrás» cierra el panel y no sale', async () => {
    const alCerrar = vi.fn();
    montar(['/antes', '/p?page=2'], { alCerrar });
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }));
    expect(screen.getByText('panel 7')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/p?page=2&ver=7');

    await userEvent.click(screen.getByRole('button', { name: 'atrás' }));
    expect(screen.getByText('sin panel')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/p\?page=2$/);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it('cerrar con su botón deshace la entrada: no queda un «atrás» de más', async () => {
    const alCerrar = vi.fn();
    montar(['/antes', '/p'], { alCerrar });
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }));
    await userEvent.click(screen.getByRole('button', { name: 'cerrar' }));
    expect(screen.getByText('sin panel')).toBeInTheDocument();
    expect(alCerrar).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'atrás' }));
    expect(screen.getByText('pantalla anterior')).toBeInTheDocument();
  });

  it('llegado con el parámetro desde fuera (un enlace), cerrar lo quita sin salir', async () => {
    montar(['/antes', '/p?ver=9']);
    expect(screen.getByText('panel 9')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'cerrar' }));
    expect(screen.getByText('sin panel')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/p$/);
  });

  // `navigate(-1)` no se aplica hasta el siguiente render: un segundo cerrar
  // en el mismo instante retrocedía otra vez y sacaba de la pantalla
  it('dos cerrar seguidos solo deshacen el panel una vez', async () => {
    function Doble() {
      const [abierto, abrir, cerrar] = usePanelEnUrl('ver');
      return (
        <>
          <p>{abierto ? `panel ${abierto}` : 'sin panel'}</p>
          <button onClick={() => abrir(7)}>abrir</button>
          <button onClick={() => { cerrar(); cerrar(); }}>cerrar dos veces</button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/antes', '/p']} initialIndex={1}>
        <Routes>
          <Route path="/p" element={<Doble />} />
          <Route path="/antes" element={<p>pantalla anterior</p>} />
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }));
    await userEvent.click(screen.getByRole('button', { name: 'cerrar dos veces' }));
    expect(screen.getByText('sin panel')).toBeInTheDocument();
    expect(screen.queryByText('pantalla anterior')).not.toBeInTheDocument();
  });

  it('con soloDesdeLaApp, un parámetro que no puso la app no abre nada', async () => {
    montar(['/p?ver=9'], { soloDesdeLaApp: true });
    expect(screen.getByText('sin panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }));
    expect(screen.getByText('panel 7')).toBeInTheDocument();
  });
});

describe('useBuscadorEnUrl', () => {
  function Buscador({ alEscribir }) {
    const [url, cambiar] = useEstadoEnUrl({ q: '', page: '1' });
    const [texto, setTexto] = useBuscadorEnUrl(url.q, (q) => { alEscribir(q); cambiar({ q, page: 1 }); }, 50);
    const navigate = useNavigate();
    return (
      <>
        <input aria-label="buscar" value={texto} onChange={e => setTexto(e.target.value)} />
        <button onClick={() => navigate(-1)}>atrás</button>
      </>
    );
  }
  const montar = (entradas, alEscribir = vi.fn()) => {
    render(
      <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
        <Routes><Route path="/l" element={<Buscador alEscribir={alEscribir} />} /></Routes>
        <Url />
      </MemoryRouter>
    );
    return alEscribir;
  };

  it('al montar no escribe: la página de la URL se respeta al volver', async () => {
    const alEscribir = montar(['/l?q=uvi&page=3']);
    expect(screen.getByLabelText('buscar')).toHaveValue('uvi');
    await new Promise(r => setTimeout(r, 80));
    expect(alEscribir).not.toHaveBeenCalled();
    expect(screen.getByTestId('url')).toHaveTextContent('/l?q=uvi&page=3');
  });

  it('el campo va al momento y la URL recibe el texto reposado, una vez', async () => {
    const alEscribir = montar(['/l?page=3']);
    await userEvent.type(screen.getByLabelText('buscar'), 'uvi');
    expect(screen.getByLabelText('buscar')).toHaveValue('uvi');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/l\?q=uvi$/));
    expect(alEscribir).toHaveBeenCalledTimes(1);
  });

  // Un móvil lento: la URL aplica una escritura cuando ya ha salido la
  // siguiente. Su llegada no es un cambio «de fuera» y no puede devolver el
  // campo al texto anterior
  it('una escritura que llega tarde no pisa lo tecleado después', async () => {
    function Lento() {
      const [url, cambiar] = useEstadoEnUrl({ q: '' });
      const cambiarRef = { current: cambiar };
      cambiarRef.current = cambiar;
      const [texto, setTexto] = useBuscadorEnUrl(url.q, (q) => setTimeout(() => cambiarRef.current({ q }), 120), 30);
      return <input aria-label="buscar" value={texto} onChange={e => setTexto(e.target.value)} />;
    }
    render(
      <MemoryRouter initialEntries={['/l']}>
        <Routes><Route path="/l" element={<Lento />} /></Routes>
        <Url />
      </MemoryRouter>
    );
    const campo = screen.getByLabelText('buscar');
    await userEvent.type(campo, 'ab');
    await new Promise(r => setTimeout(r, 60));   // sale «ab», aún sin llegar
    await userEvent.type(campo, 'c');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/l?q=ab'));
    expect(campo).toHaveValue('abc');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/l?q=abc'));
    expect(campo).toHaveValue('abc');
  });

  it('si la URL cambia por fuera (atrás), el campo la sigue', async () => {
    montar(['/l?q=svb', '/l?q=uvi']);
    expect(screen.getByLabelText('buscar')).toHaveValue('uvi');
    await userEvent.click(screen.getByRole('button', { name: 'atrás' }));
    expect(screen.getByLabelText('buscar')).toHaveValue('svb');
  });
});

describe('paginaDeUrl', () => {
  it('un número de página válido, o la 1', () => {
    expect(paginaDeUrl('3')).toBe(3);
    expect(paginaDeUrl('0')).toBe(1);
    expect(paginaDeUrl('-2')).toBe(1);
    expect(paginaDeUrl('abc')).toBe(1);
    expect(paginaDeUrl(null)).toBe(1);
    expect(paginaDeUrl('Infinity')).toBe(1);
  });
});
