import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('un solo día que falta, en singular; y avisa en vivo de un tramo fuera de fechas', () => {
    render(<Envoltorio inicial={[
      { dia: '2026-10-20', tramos: [{ desde: '07:00', hasta: '22:00' }] },
      { dia: '2026-10-21', tramos: [{ desde: '10:00', hasta: '22:00' }] },
    ]} />);
    expect(screen.getByRole('button', { name: 'Añadir el día que falta' })).toBeInTheDocument();
    expect(screen.getByTestId('error-horario')).toHaveTextContent('se sale de las fechas');
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

  // Prueba local del 2026-10-19: teclear una hora de inicio igual a la de
  // fin dejaba el día sin hueco y la barra desaparecía con el campo dentro
  it('la barra no desaparece mientras se teclea una hora que no deja hueco', () => {
    render(<HorarioJornadas value={[]} onChange={vi.fn()}
      fechaInicio="2026-10-20T06:00" fechaFin="2026-10-20T23:00" />);
    fireEvent.change(screen.getByLabelText('Hora de inicio de cada día'), { target: { value: '21:00' } });
    expect(screen.getByLabelText('Hora de fin de cada día')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Con esas horas no cabe ningún día' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Hora de inicio de cada día'), { target: { value: '09:00' } });
    expect(screen.getByRole('button', { name: 'Rellenar el día' })).toBeEnabled();
  });

  // 2026-10-19, CHINCHILLA alargado un día: el día nuevo no salía en la lista
  describe('cada día de las fechas sale en la lista', () => {
    const DOS_DIAS = [
      { dia: '2026-10-20', tramos: [{ desde: '10:00', hasta: '14:00' }, { desde: '15:00', hasta: '23:00' }] },
    ];

    it('el día sin horario sale como tal y «Poner horario» copia el día anterior', async () => {
      const alCambiar = vi.fn();
      render(<Envoltorio alCambiar={alCambiar} inicial={DOS_DIAS}
        fechaInicio="2026-10-20T08:00" fechaFin="2026-10-21T23:30" />);
      expect(screen.getByTestId('dia-sin-horario-2026-10-21')).toHaveTextContent('Mié 21/10 · Sin horario');

      await userEvent.click(screen.getByRole('button', { name: '+ Poner horario este día' }));
      const h = alCambiar.mock.calls.at(-1)[0];
      expect(h.map(d => d.dia)).toEqual(['2026-10-20', '2026-10-21']);
      expect(h[1].tramos).toEqual(DOS_DIAS[0].tramos);
      expect(screen.queryByTestId('dia-sin-horario-2026-10-21')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Inicio del tramo 2 del Mié 21/10')).toHaveValue('15:00');
    });

    it('lo fichado del día anterior se copia como horas, no como fichado', async () => {
      const alCambiar = vi.fn();
      render(<Envoltorio alCambiar={alCambiar}
        inicial={[{ dia: '2026-10-20', tramos: [{ desde: '16:00', hasta: '23:00', fichada: true }] }]}
        fechaInicio="2026-10-20T08:00" fechaFin="2026-10-21T23:30" />);
      await userEvent.click(screen.getByRole('button', { name: '+ Poner horario este día' }));
      expect(alCambiar.mock.calls.at(-1)[0][1].tramos).toEqual([{ desde: '16:00', hasta: '23:00' }]);
    });

    it('sin horario ninguno no pinta los días: se empieza por «Rellenar»', () => {
      render(<Envoltorio />);
      expect(screen.queryByText(/Sin horario$/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Poner horario este día' })).not.toBeInTheDocument();
    });

    it('un trabajo que acaba de madrugada no enseña la barra apagada', () => {
      render(<Envoltorio inicial={DOS_DIAS} fechaInicio="2026-10-20T08:00" fechaFin="2026-10-21T02:30" />);
      expect(screen.queryByLabelText('Hora de inicio de cada día')).not.toBeInTheDocument();
      // pero el día sale, por si también se trabaja ese rato
      expect(screen.getByTestId('dia-sin-horario-2026-10-21')).toBeInTheDocument();
    });
  });
});
