import React, { useEffect, useState } from 'react';
import { flotaService } from '../../services/flota.service.js';
import { formatDateTime } from '../../utils/dateUtils.js';
import MapaRecorrido from './MapaRecorrido.jsx';
import { COLOR_RUTA, COLOR_SALIDA, COLOR_FINAL, horaDeRecorrido } from '../../utils/flota.js';

/**
 * components/flota/RecorridoServicio.jsx
 * La sección «Recorrido» del detalle de un servicio: por dónde ha ido la
 * ambulancia, según el GPS de Cartrack.
 *
 * Se carga AL PULSAR, no al abrir el panel: el detalle se abre muchas veces al
 * día para mirar fotos o fichar, y cada apertura no tiene por qué costar una
 * llamada a Cartrack (hasta varias páginas de 1000 eventos). Con el servicio
 * en curso se refresca cada minuto, solo con la pestaña visible.
 *
 * Quién la ve lo decide quien la monta (mismo acceso que /flota); el backend
 * lo vuelve a comprobar en `GET /flota/recorrido/:id`.
 */

const REFRESCO_EN_CURSO_MS = 60 * 1000;

function Leyenda({ color, texto }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {texto}
    </span>
  );
}

export default function RecorridoServicio({ asignacionId }) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);

  const cargar = (silencioso = false) => {
    if (!silencioso) setCargando(true);
    return flotaService.getRecorrido(asignacionId)
      .then((d) => { setDatos(d); setFallo(false); })
      .catch(() => { if (!silencioso) setFallo(true); })
      .finally(() => { if (!silencioso) setCargando(false); });
  };

  useEffect(() => {
    if (abierto) cargar();
  }, [abierto, asignacionId]);

  const enCurso = Boolean(datos?.ventana?.enCurso);
  useEffect(() => {
    if (!abierto || !enCurso) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') cargar(true);
    }, REFRESCO_EN_CURSO_MS);
    return () => clearInterval(t);
  }, [abierto, enCurso, asignacionId]);

  const recorrido = datos?.recorrido;
  const hayRuta = datos?.estado === 'ok' && recorrido?.tramos?.length > 0;

  let aviso = null;
  if (fallo) aviso = 'No se ha podido cargar el recorrido.';
  else if (datos?.estado === 'sin_empezar') aviso = 'El servicio aún no ha empezado: no hay recorrido que enseñar.';
  else if (datos?.estado === 'sin_gps') {
    aviso = datos.fuente?.configurado === false
      ? 'Este entorno no tiene el GPS configurado.'
      : 'Esta ambulancia no tiene GPS vinculado en Cartrack (o su matrícula sale dos veces).';
  } else if (datos?.fuente?.error) aviso = 'El GPS no contesta ahora mismo. Prueba en un rato.';
  else if (datos?.estado === 'ok' && !hayRuta) aviso = 'Cartrack no tiene puntos de esta ambulancia en el horario del servicio.';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-900 text-sm">
          <span className="inline-block bg-primary-50 text-primary-700 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2">
            RECORRIDO
          </span>
          Por dónde ha ido la ambulancia
        </h3>
        {!abierto ? (
          <button type="button" onClick={() => setAbierto(true)} className="btn-secondary text-xs whitespace-nowrap">
            Ver recorrido
          </button>
        ) : (
          <button type="button" onClick={() => setAbierto(false)} className="text-xs text-neutral-500 hover:text-neutral-700">
            Ocultar
          </button>
        )}
      </div>

      {abierto && (
        <>
          {cargando && !datos && (
            <p className="text-xs text-neutral-500">Pidiendo la ruta al GPS…</p>
          )}
          {aviso && !cargando && <p className="text-xs text-neutral-500">{aviso}</p>}

          {hayRuta && (
            <>
              <div className="h-64 sm:h-72 rounded-lg overflow-hidden border border-neutral-200">
                <MapaRecorrido recorrido={recorrido} enCurso={enCurso} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                <span className="font-mono font-medium text-neutral-800">{recorrido.km.toLocaleString('es-ES')} km</span>
                <Leyenda color={COLOR_SALIDA} texto={`Salida ${horaDeRecorrido(recorrido.inicio.at)}`} />
                <Leyenda color={COLOR_FINAL} texto={`${enCurso ? 'Última posición' : 'Final'} ${horaDeRecorrido(recorrido.fin.at)}`} />
                <Leyenda color={COLOR_RUTA} texto={enCurso ? 'En curso · se actualiza cada minuto' : 'Ruta'} />
              </div>
              {recorrido.tramos.length > 1 && (
                <p className="text-xs text-neutral-500">
                  La línea se corta donde el GPS estuvo sin cobertura: no se dibuja un camino que no se ha visto.
                </p>
              )}
            </>
          )}

          {datos?.ventana && (hayRuta || datos.ventana.recortado) && (
            <p className="text-[11px] text-neutral-400 font-mono">
              {formatDateTime(datos.ventana.desde)} – {enCurso ? 'ahora' : formatDateTime(datos.ventana.hasta)}
              {datos.ventana.recortado && ` · solo los últimos ${datos.ventana.maxDias} días`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
