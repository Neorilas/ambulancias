import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserCombobox } from '../../../components/common/ListaMiembros.jsx';

const USERS = [
  { id: 1, nombre: 'Ana',  apellidos: 'Ruiz', username: 'ana' },
  { id: 2, nombre: 'Luis', apellidos: 'Gil',  username: 'luis' },
  { id: 3, nombre: 'Eva',  apellidos: 'Paz',  username: 'eva' },
  { id: 4, nombre: 'Leo',  apellidos: 'Sanz', username: 'leo' },
];

const abrir = (props = {}) => {
  render(<UserCombobox users={USERS} value="" onChange={() => {}} {...props} />);
  fireEvent.focus(screen.getByPlaceholderText(/Buscar por nombre/));
};
// Lo que se ve en el desplegable, en orden: títulos (role=presentation, no se
// eligen) y personas
const desplegable = () => [...document.querySelectorAll('ul li')]
  .map(li => li.textContent.replace(/@\w+$/, '').trim());

// Pedido 2026-10-10: al añadir una ambulancia, arriba la gente ya asociada al
// trabajo y debajo, aparte, la que no pertenece a él.
describe('UserCombobox con gente del trabajo', () => {
  it('dos bloques con título: primero los asociados al trabajo, luego los que no', () => {
    abrir({ destacados: new Set([3, 2]) });
    expect(desplegable()).toEqual([
      'Asociados al trabajo', 'Luis Gil', 'Eva Paz',
      'No pertenecen al trabajo', 'Ana Ruiz', 'Leo Sanz',
    ]);
  });

  it('se elige igual a alguien que no pertenece al trabajo', () => {
    const elegidos = [];
    abrir({ destacados: new Set([3]), onChange: id => elegidos.push(id) });
    fireEvent.mouseDown(screen.getByText('Leo Sanz'));
    expect(elegidos).toEqual([4]);
  });

  it('los títulos no se pueden elegir', () => {
    const elegidos = [];
    abrir({ destacados: new Set([3]), onChange: id => elegidos.push(id) });
    fireEvent.mouseDown(screen.getByText('Asociados al trabajo'));
    expect(elegidos).toEqual([]);
  });

  it('al buscar, cada bloque se filtra y el que se queda vacío no sale', () => {
    abrir({ destacados: new Set([3]) });
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: 'le' } });
    expect(desplegable()).toEqual(['No pertenecen al trabajo', 'Leo Sanz']);
  });

  it('sin trabajo (asignación suelta), la lista de siempre, sin títulos', () => {
    abrir();
    expect(desplegable()).toEqual(['Ana Ruiz', 'Luis Gil', 'Eva Paz', 'Leo Sanz']);
  });
});
