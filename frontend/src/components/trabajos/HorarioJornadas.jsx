import React, { useState } from 'react';
import {
  rellenarDias, pasaMedianoche, etiquetaDia, diasEntre,
  DESDE_POR_DEFECTO, HASTA_POR_DEFECTO,
} from '../../utils/jornadas.js';

/**
 * Editor del horario por días (v39): un bloque por día con sus tramos. El
 * turno partido es opcional («+ Añadir tramo»). Un tramo que acaba a una hora
 * anterior a la de inicio pasa de medianoche y se marca «(+1 día)».
 *
 * `value` es el horario del formulario (`utils/jornadas.js`). Los tramos ya
 * fichados (`fichada`) no se pueden tocar: su hora real es la evidencia del
 * servicio y el backend no los borra aunque se quiten de aquí.
 */
export default function HorarioJornadas({ value, onChange, fechaInicio, fechaFin, error }) {
  const [desde, setDesde] = useState(DESDE_POR_DEFECTO);
  const [hasta, setHasta] = useState(HASTA_POR_DEFECTO);
  const horario = value || [];
  const diasPosibles = diasEntre(fechaInicio, fechaFin);
  const faltan = diasPosibles.filter(d => !horario.some(h => h.dia === d)).length;

  const cambiarTramo = (i, k, campo, valor) => onChange(horario.map((d, j) => (j !== i ? d : {
    ...d, tramos: d.tramos.map((t, m) => (m === k ? { ...t, [campo]: valor } : t)),
  })));
  const anadirTramo = (i) => onChange(horario.map((d, j) => {
    if (j !== i) return d;
    const ultimo = d.tramos[d.tramos.length - 1];
    return { ...d, tramos: [...d.tramos, { desde: ultimo?.hasta || desde, hasta: '' }] };
  }));
  const quitarTramo = (i, k) => onChange(horario
    .map((d, j) => (j !== i ? d : { ...d, tramos: d.tramos.filter((_, m) => m !== k) }))
    .filter(d => d.tramos.length));
  const quitarDia = (i) => onChange(horario.filter((_, j) => j !== i));

  return (
    <div className="space-y-3" data-testid="horario-jornadas">
      {/* Rellenar: una hora para todos los días; luego se retoca cada uno */}
      {faltan > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
          <div>
            <label className="label text-xs">Cada día de</label>
            <input type="time" className="input text-sm w-28" value={desde}
              onChange={e => setDesde(e.target.value)} aria-label="Hora de inicio de cada día" />
          </div>
          <div>
            <label className="label text-xs">a</label>
            <input type="time" className="input text-sm w-28" value={hasta}
              onChange={e => setHasta(e.target.value)} aria-label="Hora de fin de cada día" />
          </div>
          <button type="button" className="btn-secondary text-xs px-2 py-2"
            onClick={() => onChange(rellenarDias(horario, fechaInicio, fechaFin, desde, hasta))}>
            {horario.length ? `Añadir los ${faltan} días que faltan` : `Rellenar los ${faltan} días`}
          </button>
        </div>
      )}

      {horario.length === 0 && (
        <p className="text-xs text-neutral-500">
          Sin horario por días: se ficha como siempre, con «Inicio» y «Fin evento/servicio».
        </p>
      )}

      {horario.map((d, i) => {
        const conFichadas = d.tramos.some(t => t.fichada);
        return (
          <div key={d.dia} className="rounded-lg border border-neutral-200 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-800">{etiquetaDia(d.dia)}</span>
              {!conFichadas && (
                <button type="button" onClick={() => quitarDia(i)}
                  className="text-bad-500 hover:text-bad-600 text-xs">Quitar día</button>
              )}
            </div>
            {d.tramos.map((t, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <input type="time" className="input text-sm w-28" value={t.desde} disabled={t.fichada}
                  aria-label={`Inicio del tramo ${k + 1} del ${etiquetaDia(d.dia)}`}
                  onChange={e => cambiarTramo(i, k, 'desde', e.target.value)} />
                <span className="text-neutral-500 text-sm">a</span>
                <input type="time" className="input text-sm w-28" value={t.hasta} disabled={t.fichada}
                  aria-label={`Fin del tramo ${k + 1} del ${etiquetaDia(d.dia)}`}
                  onChange={e => cambiarTramo(i, k, 'hasta', e.target.value)} />
                {pasaMedianoche(t) && <span className="text-xs text-neutral-500">(+1 día)</span>}
                {t.fichada ? (
                  <span className="text-xs text-neutral-500">ya fichada</span>
                ) : d.tramos.length > 1 && (
                  <button type="button" onClick={() => quitarTramo(i, k)}
                    className="text-bad-500 hover:text-bad-600 text-xs">Quitar tramo</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => anadirTramo(i)}
              className="text-xs text-primary-600 hover:text-primary-700">
              + Añadir tramo (turno partido)
            </button>
          </div>
        );
      })}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
