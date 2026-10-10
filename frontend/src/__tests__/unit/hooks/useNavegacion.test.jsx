import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import {
  hayAtrasEnLaApp, useVolver, useEstadoEnUrl, paginaDeUrl,
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

describe('paginaDeUrl', () => {
  it('un número de página válido, o la 1', () => {
    expect(paginaDeUrl('3')).toBe(3);
    expect(paginaDeUrl('0')).toBe(1);
    expect(paginaDeUrl('-2')).toBe(1);
    expect(paginaDeUrl('abc')).toBe(1);
    expect(paginaDeUrl(null)).toBe(1);
  });
});
