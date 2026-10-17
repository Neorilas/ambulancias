import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HorarioJornadas from '../../../components/trabajos/HorarioJornadas.jsx';

/** El editor con su estado, como lo usa un formulario. */
function Envoltorio({ inicial = [], alCambiar = () => {}, ...props }) {
  const [h, setH] = useState(inicial);
  return (
    <HorarioJornadas value={h} onChange={(nuevo) => { setH(nuevo); alCambiar(nuevo); }}
      fechaInicio="2026-10-20T08:00" fechaFin="2026-10-22T23:00" {...props} />
  );
}

describe('HorarioJornadas', () => {
  it('sin horario lo dice, y «Rellenar» pone un tramo por día', async () => {
    const alCambiar = vi.fn();
    render(<Envoltorio alCambiar={alCambiar} />);
    expect(screen.getByText(/Sin horario por días/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Rellenar los 3 días' }));
    const h = alCambiar.mock.calls.at(-1)[0];
    expect(h.map(d => d.dia)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(h[0].tramos).toEqual([{ desde: '09:00', hasta: '21:00' }]);
    expect(screen.getByText('Mar 20/10')).toBeInTheDocument();
    // Ya no falta ningún día: el bloque de rellenar desaparece
    expect(screen.queryByRole('button', { name: /Rellenar/ })).not.toBeInTheDocument();
  });

  it('turno partido: «+ Añadir tramo» empieza donde acaba el anterior', async () => {
    const alCambiar = vi.fn();
    render(<Envoltorio alCambiar={alCambiar}
      inicial={[{ dia: '2026-10-21', tramos: [{ desde: '10:00', hasta: '14:00' }] }]} />);
    await userEvent.click(screen.getByRole('button', { name: /Añadir tramo/ }));
    expect(alCambiar.mock.calls.at(-1)[0][0].tramos).toEqual([
      { desde: '10:00', hasta: '14:00' }, { desde: '14:00', hasta: '' }]);
    expect(screen.getAllByRole('button', { name: 'Quitar tramo' })).toHaveLength(2);
    // Faltan los otros dos días
    expect(screen.getByRole('button', { name: 'Añadir los 2 días que faltan' })).toBeInTheDocument();
  });

  it('marca el tramo que pasa de medianoche', () => {
    render(<Envoltorio inicial={[{ dia: '2026-10-20', tramos: [{ desde: '20:00', hasta: '02:00' }] }]} />);
    expect(screen.getByText('(+1 día)')).toBeInTheDocument();
  });

  it('lo ya fichado no se puede tocar ni quitar', () => {
    render(<Envoltorio inicial={[{ dia: '2026-10-20', tramos: [{ desde: '10:00', hasta: '22:00', fichada: true }] }]} />);
    expect(screen.getByLabelText('Inicio del tramo 1 del Mar 20/10')).toBeDisabled();
    expect(screen.getByText('ya fichada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar día' })).not.toBeInTheDocument();
  });

  it('quitar un día lo saca del horario', async () => {
    const alCambiar = vi.fn();
    render(<Envoltorio alCambiar={alCambiar}
      inicial={[{ dia: '2026-10-20', tramos: [{ desde: '10:00', hasta: '22:00' }] }]} error="Algo va mal" />);
    expect(screen.getByText('Algo va mal')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar día' }));
    expect(alCambiar.mock.calls.at(-1)[0]).toEqual([]);
  });
});
