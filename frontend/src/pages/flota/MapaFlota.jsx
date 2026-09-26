import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { flotaService } from '../../services/flota.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import MapaLeaflet from '../../components/flota/MapaLeaflet.jsx';
import { formatHora } from '../../utils/dateUtils.js';
import {
  FILTROS,
  contarPorFiltro,
  estadoMeta,
  filtrarFlota,
  textoFuente,
  textoKilometros,
  textoUltimoDato,
  textoVelocidad,
} from '../../utils/flota.js';

/**
 * pages/flota/MapaFlota.jsx
 * Dónde está cada ambulancia, según el GPS de Cartrack, con lo que el GPS no
 * sabe: el alias de la ambulancia, su ficha y quién la lleva hoy.
 *
 * **Superadmin siempre; administradores solo si el superadmin ha encendido
 * `menu_flota`** en /admin (`App.jsx` para el menú, `routes/flota.routes.js`
 * para lo que manda de verdad). Es una pantalla que enseña dónde está un
 * vehículo en tiempo casi real, y por tanto dónde está la persona que lo
 * conduce: por eso quién la ve se amplía a mano y queda en `audit_logs`, en
 * vez de venir abierta de fábrica como el resto de la flota.
 */

/** Cada cuánto se vuelve a preguntar. Lo marca la caché del backend (30 s). */
const REFRESCO_MS = 30 * 1000;

// ── Piezas de la ficha ────────────────────────────────────────────────────

function Dato({ label, children }) {
  return (
    <div>
      <p className="micro">{label}</p>
      <p className="text-[13px] text-neutral-800">{children}</p>
    </div>
  );
}

function EstadoBadge({ estado }) {
  const { label, badge } = estadoMeta(estado);
  return <span className={badge}>{label}</span>;
}

/** Fila de la lista lateral. */
function FilaVehiculo({ entrada, activa, onClick }) {
  const { color } = estadoMeta(entrada.estado);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-neutral-100 transition-colors
                  ${activa ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1 w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13.5px] font-medium text-neutral-900 truncate">
              {entrada.alias || entrada.matricula || 'Sin identificar'}
            </span>
            {entrada.gps?.velocidad > 0 && (
              <span className="font-mono text-[11px] text-neutral-500 shrink-0">
                {textoVelocidad(entrada.gps.velocidad)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-[11px] text-neutral-500 truncate">
              {entrada.matricula || '—'}
            </span>
            {entrada.ambigua && <span className="badge-red">Matrícula repetida</span>}
          </div>
          {entrada.asignacion && (
            <p className="text-[11px] text-neutral-500 truncate mt-0.5">
              {entrada.asignacion.responsable}
              {!entrada.asignacion.iniciada && ' · sin iniciar'}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

/** Ficha del vehículo seleccionado. */
function Ficha({ entrada, onCerrar }) {
  const gps = entrada.gps;

  return (
    <div className="card">
      <div className="card-header">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-neutral-900 truncate">
            {entrada.alias || entrada.matricula || 'Sin identificar'}
          </h3>
          <p className="font-mono text-[12px] text-neutral-500">{entrada.matricula || '—'}</p>
        </div>
        <button onClick={onCerrar} className="btn btn-ghost" aria-label="Cerrar ficha">Cerrar</button>
      </div>

      <div className="mb-3"><EstadoBadge estado={entrada.estado} /></div>

      {entrada.vinculo === 'solo-gps' && (
        <p className="text-[12px] text-warn-700 bg-warn-50 border border-warn-200 rounded p-2 mb-3">
          Este GPS no corresponde a ningún vehículo dado de alta en la aplicación.
        </p>
      )}
      {entrada.ambigua && (
        <p className="text-[12px] text-bad-700 bg-bad-50 border border-bad-200 rounded p-2 mb-3">
          Hay más de un registro con esta matrícula. No se vincula con el GPS hasta
          que se corrija: enlazar al azar pintaría una ambulancia con la posición de otra.
        </p>
      )}

      {gps ? (
        <div className="grid grid-cols-2 gap-3">
          <Dato label="Velocidad">{textoVelocidad(gps.velocidad)}</Dato>
          <Dato label="Contacto">
            {gps.contacto === null ? '—' : gps.contacto ? 'Puesto' : 'Quitado'}
          </Dato>
          <Dato label="Kilómetros (GPS)">{textoKilometros(gps.odometroKm)}</Dato>
          <Dato label="Kilómetros (ficha)">{textoKilometros(entrada.kilometrosApp)}</Dato>
          {gps.conductor && <Dato label="Conductor (Cartrack)">{gps.conductor}</Dato>}
          <div className="col-span-2">
            <Dato label="Último dato">
              {textoUltimoDato(gps.minutosDesdeDato)}
              {gps.actualizado && (
                <span className="text-neutral-400"> · {formatHora(gps.actualizado)}</span>
              )}
            </Dato>
          </div>
          {gps.ubicacion && (
            <div className="col-span-2"><Dato label="Ubicación">{gps.ubicacion}</Dato></div>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-neutral-500">
          Sin datos de GPS para este vehículo.
        </p>
      )}

      {/* Lo que Cartrack no tiene y nosotros sí: quién lo lleva. */}
      <div className="mt-4 pt-3 border-t border-neutral-100">
        <p className="micro mb-1">Asignación activa</p>
        {entrada.asignacion ? (
          <p className="text-[13px] text-neutral-800">
            {entrada.asignacion.responsable}
            {!entrada.asignacion.iniciada && (
              <span className="text-warn-700"> · activa, pero nadie ha iniciado el servicio</span>
            )}
          </p>
        ) : (
          <p className="text-[13px] text-neutral-500">Ninguna</p>
        )}
      </div>

      {entrada.vehiculoId && (
        <Link to={`/vehiculos/${entrada.vehiculoId}`} className="btn btn-secondary w-full mt-4">
          Ver ficha del vehículo
        </Link>
      )}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────

export default function MapaFlota() {
  const { notify } = useNotification();

  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionada, setSeleccionada] = useState(null);

  // `?vehiculo=<id>`: se llega desde la ficha de una ambulancia para verla a
  // ELLA. Se aplica una sola vez, con la primera carga: si se reaplicara en
  // cada refresco, el mapa volvería a saltar a ese vehículo cada 30 s aunque
  // el usuario ya estuviera mirando otro.
  const [params] = useSearchParams();
  const vehiculoPedido = Number(params.get('vehiculo')) || null;
  const pedidoAplicado = useRef(false);
  const fichaRef = useRef(null);
  const irAFicha = useRef(false);

  // El aviso de error se da UNA vez por racha: con un refresco cada 30 s, un
  // corte de Cartrack de media hora soltaría sesenta toasts.
  const yaAvisado = useRef(false);

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCargando(true);
    try {
      const data = await flotaService.getUbicaciones();
      setDatos(data);
      yaAvisado.current = false;
    } catch {
      if (!yaAvisado.current) {
        notify.error('No se pudo cargar la posición de la flota');
        yaAvisado.current = true;
      }
    } finally {
      setCargando(false);
    }
  }, [notify]);

  useEffect(() => { cargar(); }, [cargar]);

  // Refresco automático, EN PAUSA con la pestaña oculta. Sin la pausa, un
  // navegador con el mapa abierto de fondo seguiría gastando llamadas del cupo
  // de Cartrack toda la noche para nadie.
  useEffect(() => {
    let id = null;

    const arrancar = () => {
      if (id === null) id = setInterval(() => cargar({ silencioso: true }), REFRESCO_MS);
    };
    const parar = () => {
      if (id !== null) { clearInterval(id); id = null; }
    };
    const alCambiarVisibilidad = () => {
      if (document.hidden) { parar(); return; }
      // Al volver, lo que hay en pantalla puede llevar horas: se refresca ya.
      cargar({ silencioso: true });
      arrancar();
    };

    if (!document.hidden) arrancar();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      parar();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [cargar]);

  const flota = datos?.flota ?? [];
  const conteos = useMemo(() => contarPorFiltro(flota), [flota]);
  const visibles = useMemo(
    () => filtrarFlota(flota, { filtro, busqueda }),
    [flota, filtro, busqueda]
  );
  useEffect(() => {
    if (!vehiculoPedido || pedidoAplicado.current || !datos) return;
    pedidoAplicado.current = true;
    const entrada = (datos.flota || []).find(f => f.vehiculoId === vehiculoPedido);
    if (!entrada) return;
    setSeleccionada(entrada.clave);
    // Sin posición el mapa no se mueve y, en el móvil, la ficha queda debajo,
    // fuera de la vista: parecería que el enlace no ha hecho nada.
    irAFicha.current = entrada.gps?.lat == null;
  }, [datos, vehiculoPedido]);

  const elegida = useMemo(
    () => flota.find(f => f.clave === seleccionada) || null,
    [flota, seleccionada]
  );

  // Ya pintada la ficha (no antes: el nodo aún estaría vacío).
  useEffect(() => {
    if (!elegida || !irAFicha.current) return;
    irAFicha.current = false;
    fichaRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [elegida]);

  if (cargando && !datos) return <PageLoading />;

  const fuente = datos?.fuente;
  const sinGps = fuente && !fuente.configurado;

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Mapa de flota</h1>
          <p className="text-[12.5px] text-neutral-500">
            {textoFuente(fuente)}
            {fuente?.actualizado && !sinGps && (
              <span className="text-neutral-400"> · {formatHora(fuente.actualizado)}</span>
            )}
          </p>
        </div>
        <button onClick={() => cargar({ silencioso: true })} className="btn btn-secondary">
          Actualizar
        </button>
      </div>

      {sinGps && (
        <div className="card border-warn-200 bg-warn-50">
          <p className="text-[13px] text-warn-700">
            Este entorno no tiene configurado el acceso a Cartrack, así que no hay
            posiciones que enseñar. La lista de abajo es la flota dada de alta en la
            aplicación. Para activarlo hay que poner <code className="font-mono">CARTRACK_USER</code> y{' '}
            <code className="font-mono">CARTRACK_KEY</code> en el <code className="font-mono">.env</code> del
            servidor y reiniciar el backend.
          </p>
        </div>
      )}

      {fuente?.error && !sinGps && (
        <div className="card border-bad-200 bg-bad-50">
          <p className="text-[13px] text-bad-700">
            {fuente.origen === 'cache-vieja'
              ? 'Cartrack no responde: se está enseñando la última posición conocida de cada vehículo. Mira la hora del dato antes de fiarte.'
              : 'Cartrack no responde. Los vehículos salen sin posición hasta que vuelva.'}
          </p>
        </div>
      )}

      {/* Filtros + buscador */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map(f => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`h-[30px] px-2.5 rounded-md text-[12.5px] font-medium border transition-colors
              ${filtro === f.key
                ? 'bg-primary-50 text-primary-700 border-primary-200'
                : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'}`}
          >
            {f.label}
            <span className="ml-1.5 font-mono text-[11px] text-neutral-400">{conteos[f.key] ?? 0}</span>
          </button>
        ))}
        <input
          type="search"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar ambulancia, matrícula o responsable"
          className="input flex-1 min-w-[200px]"
        />
      </div>

      {/* Mapa + lista */}
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="order-2 lg:order-1 card p-0 overflow-hidden">
          <div className="max-h-[22rem] lg:max-h-[calc(100dvh-22rem)] overflow-y-auto">
            {visibles.length === 0 ? (
              <p className="p-4 text-[13px] text-neutral-500">
                Ningún vehículo encaja con este filtro.
              </p>
            ) : visibles.map(entrada => (
              <FilaVehiculo
                key={entrada.clave}
                entrada={entrada}
                activa={entrada.clave === seleccionada}
                onClick={() => setSeleccionada(entrada.clave)}
              />
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2 space-y-4">
          <div className="h-[45vh] lg:h-[calc(100dvh-22rem)] min-h-[18rem] rounded-lg overflow-hidden border border-neutral-200">
            <MapaLeaflet
              entradas={visibles}
              seleccionada={seleccionada}
              onSeleccionar={setSeleccionada}
            />
          </div>
          <div ref={fichaRef} className={elegida ? 'scroll-mt-20' : 'hidden'}>
            {elegida && <Ficha entrada={elegida} onCerrar={() => setSeleccionada(null)} />}
          </div>
        </div>
      </div>

      {/* Resumen del cruce: los fallos se cuentan, no se esconden */}
      {datos?.resumen && (
        <p className="text-[12px] text-neutral-500">
          {datos.resumen.vinculados} vinculados ·{' '}
          {datos.resumen.sinGps} sin GPS ·{' '}
          {datos.resumen.sinVehiculo} GPS sin vehículo en la app
          {datos.resumen.ambiguos > 0 && ` · ${datos.resumen.ambiguos} con matrícula repetida`}
          {' · sin señal a partir de '}{datos.minutosSinSenal} min
        </p>
      )}
    </div>
  );
}
