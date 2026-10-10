import React, { useState, useEffect } from 'react';
import { trabajosService } from '../../services/trabajos.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { diaEnEspana, formatDiaCalendario, formatHora, formatDateTimeShort } from '../../utils/dateUtils.js';
import {
  cuadriculaMes, sumarMes, diasDeEntrada, entradasDelDia, situacionEntrada, textoPapel,
  diaAlCambiarDeMes, SITUACIONES,
} from '../../utils/calendario.js';

/**
 * «Mis trabajos» en forma de calendario: lo suyo del mes, también lo ya
 * cerrado (`GET /trabajos/mi-calendario`). El día elegido lo lleva quien lo
 * monta (`dia`, en la URL), para que al volver de la ficha de un trabajo se
 * vuelva al mismo día. Como la lista, no ejecuta nada: cada entrada abre su
 * trabajo (`onAbrir`).
 */

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const conMayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function horario(e) {
  const [primero, ultimo] = diasDeEntrada(e);
  return primero === ultimo
    ? `${formatHora(e.fecha_inicio)} – ${formatHora(e.fecha_fin)}`
    : `${formatDateTimeShort(e.fecha_inicio)} → ${formatDateTimeShort(e.fecha_fin)}`;
}

function Entrada({ e, onAbrir }) {
  return (
    <button
      onClick={() => onAbrir(e)}
      className="w-full text-left rounded-lg border border-neutral-200 bg-white px-3 py-2.5 hover:bg-neutral-50 transition-colors"
      data-testid="entrada-calendario"
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-[7px] w-2 h-2 rounded-full shrink-0 ${SITUACIONES[situacionEntrada(e)].punto}`} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[15px] text-neutral-900">{e.nombre}</p>
          <p className="text-[13px] font-medium text-neutral-800 data">{horario(e)}</p>
          <p className="text-[12px] text-neutral-500 mt-0.5">
            {textoPapel(e)}{e.ubicacion ? ` · ${e.ubicacion}` : ''}
          </p>
        </div>
        <span className="text-neutral-400 self-center" aria-hidden="true">›</span>
      </div>
    </button>
  );
}

export default function CalendarioPersonal({ dia, onCambiarDia, onAbrir }) {
  const { notify } = useNotification();
  const mes = dia.slice(0, 7);
  const [entradas, setEntradas] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    // Si se pasa de mes rápido, solo vale la respuesta del último pedido
    let vigente = true;
    setCargando(true);
    trabajosService.miCalendario({ year: Number(mes.slice(0, 4)), month: Number(mes.slice(5, 7)) })
      .then(data => { if (vigente) setEntradas(data || []); })
      .catch(() => { if (vigente) { setEntradas([]); notify.error('Error al cargar el calendario'); } })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [mes]);

  const hoy    = diaEnEspana(new Date());
  const delDia = cargando ? [] : entradasDelDia(entradas, dia);
  const irAMes = (n) => onCambiarDia(diaAlCambiarDeMes(sumarMes(mes, n), hoy));

  // En el PC el mes se queda del ancho de un móvil y el día va a su derecha,
  // como en `CalendarioTrab`: a todo el ancho las celdas salían de ~140 px
  return (
    <div className="card lg:grid lg:grid-cols-[28rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
      <div className="space-y-3 w-full max-w-md">
        {/* Mes */}
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => irAMes(-1)} className="btn-ghost btn-icon" aria-label="Mes anterior">‹</button>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-neutral-900">
              {conMayuscula(formatDiaCalendario(`${mes}-01`, 'MMMM yyyy'))}
            </h2>
            {!hoy.startsWith(mes) && (
              <button onClick={() => onCambiarDia(hoy)} className="text-[12px] font-medium text-primary-600 hover:underline">
                Hoy
              </button>
            )}
          </div>
          <button onClick={() => irAMes(1)} className="btn-ghost btn-icon" aria-label="Mes siguiente">›</button>
        </div>

        {/* Cuadrícula: se pinta ya, y los puntos llegan con los datos */}
        <div className={`transition-opacity ${cargando ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-neutral-400 pb-1">
            {DIAS_SEMANA.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cuadriculaMes(mes).map((d, i) => {
              if (!d) return <div key={`hueco-${i}`} />;
              const suyas   = cargando ? [] : entradasDelDia(entradas, d);
              const elegido = d === dia;
              const esHoy   = d === hoy;
              return (
                <button
                  key={d}
                  onClick={() => onCambiarDia(d)}
                  aria-pressed={elegido}
                  aria-label={`${formatDiaCalendario(d, "d 'de' MMMM")}${suyas.length ? `, ${suyas.length} ${suyas.length === 1 ? 'trabajo' : 'trabajos'}` : ''}`}
                  className={`h-12 flex flex-col items-center justify-center gap-1 rounded-lg text-[13px] transition-colors
                    ${elegido ? 'bg-neutral-900 text-white font-semibold'
                      : esHoy ? 'ring-1 ring-primary-500 text-primary-700 font-semibold'
                      : suyas.length ? 'text-neutral-900 font-medium hover:bg-neutral-100'
                      : 'text-neutral-500 hover:bg-neutral-100'}`}
                >
                  <span className="data leading-none">{Number(d.slice(8))}</span>
                  <span className="flex gap-0.5 h-1.5">
                    {suyas.slice(0, 3).map(e => (
                      <span key={`${e.trabajo_id}-${e.asignacion_id}`}
                        className={`w-1.5 h-1.5 rounded-full ${SITUACIONES[situacionEntrada(e)].punto}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500">
          {Object.entries(SITUACIONES).map(([clave, { texto, punto }]) => (
            <span key={clave} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${punto}`} />{texto}
            </span>
          ))}
        </div>
      </div>

      {/* El día elegido */}
      <div className="border-t border-neutral-100 pt-3 mt-3 space-y-2 lg:border-t-0 lg:pt-0 lg:mt-0">
        <p className="text-[13px] font-semibold text-neutral-700">
          {conMayuscula(formatDiaCalendario(dia, "EEEE, d 'de' MMMM"))}
        </p>
        {cargando ? null : delDia.length > 0 ? (
          delDia.map(e => <Entrada key={`${e.trabajo_id}-${e.asignacion_id}`} e={e} onAbrir={onAbrir} />)
        ) : (
          <p className="text-[13px] text-neutral-400">
            {entradas.length ? 'Nada este día' : 'Este mes no tienes trabajos'}
          </p>
        )}
      </div>
    </div>
  );
}
