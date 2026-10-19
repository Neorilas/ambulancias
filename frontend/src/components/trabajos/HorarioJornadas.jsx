import React, { useState } from 'react';
import {
  rellenarDias, pasaMedianoche, etiquetaDia, errorHorario, diasEntre,
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
 *
 * Con horario, **cada día de las fechas sale en la lista**: los que no tienen
 * tramo, como «Sin horario» con «+ Poner horario este día» (2026-10-19: al
 * alargar CHINCHILLA un día, el día nuevo no salía en ninguna parte y solo se
 * podía añadir con la barra de «Rellenar», que nadie veía como el sitio).
 */
export default function HorarioJornadas({ value, onChange, fechaInicio, fechaFin, error }) {
  const [desde, setDesde] = useState(DESDE_POR_DEFECTO);
  const [hasta, setHasta] = useState(HASTA_POR_DEFECTO);
  const horario = value || [];
  // Los que «Rellenar» añadiría de verdad (un día sin hueco tras recortarlo
  // a las horas del trabajo no cuenta)
  const faltan = rellenarDias(horario, fechaInicio, fechaFin, desde, hasta)
    .filter(d => !horario.some(h => h.dia === d.dia)).length;
  // La barra sale mientras haya días del rango sin ningún tramo, con
  // cualquier hora tecleada: si dependiera de `faltan`, al escribir una hora
  // que deja el día sin hueco (de 21:00 a 21:00) desaparecía la barra entera
  // y ya no se podía corregir (prueba local del 2026-10-19)
  const sinTramo = diasEntre(fechaInicio, fechaFin).filter(d => !horario.some(h => h.dia === d));
  // Sin tocar las horas, la barra solo sale si de verdad añadiría algún día:
  // si no, en un trabajo que acaba de madrugada (CHINCHILLA, a las 02:30) se
  // veía apagada desde el principio por ese último trozo de día
  const [tocada, setTocada] = useState(false);
  const conBarra = sinTramo.length > 0 && (faltan > 0 || tocada);
  // La lista: los días con horario y, si ya hay alguno, los del rango sin él
  const dias = horario.length
    ? [...horario.map((d, i) => ({ dia: d.dia, i })), ...sinTramo.map(dia => ({ dia, i: -1 }))]
      .sort((a, b) => (a.dia < b.dia ? -1 : 1))
    : [];
  // «+ Poner horario este día»: copia los tramos del día anterior más cercano
  // (lo normal es que se repitan), o lo que propondría «Rellenar», o vacío
  const ponerDia = (dia) => {
    const previo = [...horario].filter(d => d.dia < dia).sort((a, b) => (a.dia < b.dia ? 1 : -1))[0];
    const sugerido = rellenarDias([], fechaInicio, fechaFin, desde, hasta).find(d => d.dia === dia);
    const tramos = previo ? previo.tramos.map(({ desde: de, hasta: ha }) => ({ desde: de, hasta: ha }))
      : sugerido ? sugerido.tramos : [{ desde: '', hasta: '' }];
    onChange([...horario, { dia, tramos }].sort((a, b) => (a.dia < b.dia ? -1 : 1)));
  };

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
      {conBarra && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
          <div>
            <label className="label text-xs">Cada día de</label>
            <input type="time" className="input text-sm w-28" value={desde}
              onChange={e => { setDesde(e.target.value); setTocada(true); }} aria-label="Hora de inicio de cada día" />
          </div>
          <div>
            <label className="label text-xs">a</label>
            <input type="time" className="input text-sm w-28" value={hasta}
              onChange={e => { setHasta(e.target.value); setTocada(true); }} aria-label="Hora de fin de cada día" />
          </div>
          <button type="button" className="btn-secondary text-xs px-2 py-2" disabled={faltan === 0}
            onClick={() => onChange(rellenarDias(horario, fechaInicio, fechaFin, desde, hasta))}>
            {faltan === 0 ? 'Con esas horas no cabe ningún día'
              : horario.length
                ? (faltan === 1 ? 'Añadir el día que falta' : `Añadir los ${faltan} días que faltan`)
                : (faltan === 1 ? 'Rellenar el día' : `Rellenar los ${faltan} días`)}
          </button>
        </div>
      )}

      {horario.length === 0 && (
        <p className="text-xs text-neutral-500">
          Sin horario por días: se ficha como siempre, con «Inicio» y «Fin evento/servicio».
        </p>
      )}

      {dias.map(({ dia, i }) => {
        if (i < 0) {
          return (
            <div key={dia} className="rounded-lg border border-dashed border-neutral-300 p-2 flex flex-wrap items-center justify-between gap-2"
              data-testid={`dia-sin-horario-${dia}`}>
              <span className="text-sm">
                <span className="font-medium text-neutral-800">{etiquetaDia(dia)}</span>
                <span className="text-neutral-500"> · Sin horario</span>
              </span>
              <button type="button" onClick={() => ponerDia(dia)}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                + Poner horario este día
              </button>
            </div>
          );
        }
        const d = horario[i];
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
      {/* El del formulario al guardar, o el de ahora mismo: un tramo que se
          sale de las fechas o pisa a otro se dice mientras se escribe */}
      {(error || errorHorario(horario, fechaInicio, fechaFin)) && (
        <p className="field-error" data-testid="error-horario">{error || errorHorario(horario, fechaInicio, fechaFin)}</p>
      )}
    </div>
  );
}
