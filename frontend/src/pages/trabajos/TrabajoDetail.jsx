import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge } from '../../components/common/StatusBadge.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import Modal from '../../components/common/Modal.jsx';
import EnlaceMaps from '../../components/common/EnlaceMaps.jsx';
import { formatDateTime, formatDateTimeShort, duration } from '../../utils/dateUtils.js';
import { ESTADO_LABELS } from '../../utils/constants.js';
import { estadoVisible } from '../../utils/pasosAsignacion.js';
import PasosAsignacion from '../../components/common/PasosAsignacion.jsx';
import { horarioDesdeApi, etiquetaDia, textoTramos } from '../../utils/jornadas.js';
import {
  estaCerrado, misAmbulancias, siguientePaso, textoEstadoAmbulancia, nombresDe, coordinadoresDe,
  faltaParaProgramado, textoEvento,
} from '../../utils/trabajos.js';
import TrabajoForm from './TrabajoForm.jsx';
import TrabajoV25 from './TrabajoV25.jsx';
import AsignacionForm from '../asignaciones/AsignacionForm.jsx';
import AsignacionDetalle from '../asignaciones/AsignacionDetalle.jsx';
import { useVolver, usePanelEnUrl } from '../../hooks/useNavegacion.js';

/**
 * Ficha de un trabajo (v33, el trabajo padre). La ve todo el que va en
 * cualquiera de sus ambulancias o en su equipo, su coordinador y gestión; qué
 * ve cada uno de cada ambulancia lo recorta el backend (`vistaParaUsuario`):
 *  - la suya, entera; de las demás, solo cuál es y quién va (decisión 6);
 *  - quien está en el equipo del trabajo sin ambulancia, como las ajenas;
 *  - el coordinador y gestión, todas (D2).
 * Puede no llevar ninguna ambulancia (2026-10-10): se le añaden después.
 *
 * Aquí no se opera ninguna ambulancia: «Tu ambulancia» y cada tarjeta abren el
 * detalle de la asignación de siempre, que es donde están el inicio, las
 * fotos, la llegada y el cierre (D7).
 *
 * Un trabajo del modelo v25 (`v25: true` en la API) se pinta con `TrabajoV25`,
 * que sí opera sus vehículos: los dos modelos conviven hasta la fase 6 para
 * que los trabajos antiguos a medias se puedan terminar.
 */

const nombreVehiculo = (a) => a.vehiculo_alias || a.matricula;

// ── «Tu ambulancia»: lo primero que ve quien va en el trabajo ─────────────────
function TuAmbulancia({ a, onAbrir }) {
  const paso = a.mi_rol === 'responsable' ? siguientePaso(a) : null;
  return (
    <div className="card pl-5 space-y-2" data-testid="tu-ambulancia">
      <span className={a.estado === 'activa' ? 'stripe-activa' : 'stripe-programada'} />
      <p className="micro text-primary-600">Tu ambulancia</p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="veh-name">{nombreVehiculo(a)}</span>
        <span className="data text-[13px] text-neutral-500">{a.matricula}</span>
        <span className={estadoVisible(a).clase}>{estadoVisible(a).texto}</span>
      </div>
      {/* «Sin iniciar» ya lo dice la etiqueta: no repetirlo debajo */}
      {textoEstadoAmbulancia(a) !== estadoVisible(a).texto && (
        <p className="text-sm text-neutral-700">{textoEstadoAmbulancia(a)}</p>
      )}
      {/* Los mismos pasos que arriba de su ficha, para ver qué toca sin abrirla */}
      {a.detalle && <div className="pt-1"><PasosAsignacion asig={a} /></div>}
      {a.mi_rol === 'equipo' && (
        // El equipo ve lo mismo sin botón de acción, para que no parezca que
        // falla: la operan sus responsables (§5 del plan).
        <p className="text-sm text-neutral-600">
          Vas en el equipo. Lo lleva <strong>{nombresDe(a.responsables) || 'su responsable'}</strong>.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        {paso ? (
          <button onClick={onAbrir} className="btn-primary flex-1 sm:flex-none">{paso}</button>
        ) : (
          <button onClick={onAbrir} className="btn-secondary flex-1 sm:flex-none">Ver detalle</button>
        )}
      </div>
    </div>
  );
}

// ── Una ambulancia del trabajo ────────────────────────────────────────────────
function Ambulancia({ a, resaltada, onAbrir, refResaltada }) {
  const pi = a.progreso_fotos?.inicio;
  const pf = a.progreso_fotos?.fin;
  const contenido = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-neutral-900">
            {nombreVehiculo(a)} <span className="data text-xs text-neutral-500">{a.matricula}</span>
          </p>
          <p className="text-xs text-neutral-600 mt-0.5">
            {(a.responsables?.length || 0) > 1 ? 'Responsables' : 'Responsable'}: {nombresDe(a.responsables) || '—'}
          </p>
          {a.personal?.length > 0 && (
            <p className="text-xs text-neutral-500">Equipo: {nombresDe(a.personal)}</p>
          )}
          {a.detalle && a.horario_propio && (
            <p className="text-xs text-neutral-500" data-testid="horario-propio">Con horario por días propio</p>
          )}
        </div>
        {a.detalle && (
          <span className={estadoVisible(a).clase}>{estadoVisible(a).texto}</span>
        )}
      </div>
      {a.detalle && (
        <div className="text-xs text-neutral-500 flex flex-wrap gap-x-4 gap-y-0.5">
          {textoEstadoAmbulancia(a) !== estadoVisible(a).texto && <span>{textoEstadoAmbulancia(a)}</span>}
          <span className="data">{formatDateTimeShort(a.fecha_inicio)} → {formatDateTimeShort(a.fecha_fin)}</span>
          {pi && <span>Fotos inicio {pi.completado}/{pi.total}</span>}
          {pf && a.estado !== 'programada' && <span>Fotos fin {pf.completado}/{pf.total}</span>}
        </div>
      )}
    </>
  );
  const clases = `w-full text-left p-3 rounded-lg space-y-2 border transition-colors ${
    resaltada ? 'border-primary-400 bg-primary-50' : 'border-transparent bg-neutral-50'
  }`;
  // Solo se abre la que se puede ver entera: de las ajenas, el backend no
  // manda más que quién va.
  return a.detalle ? (
    <button type="button" ref={resaltada ? refResaltada : undefined} onClick={onAbrir}
      className={`${clases} hover:border-primary-300`}>
      {contenido}
    </button>
  ) : (
    <div ref={resaltada ? refResaltada : undefined} className={clases}>{contenido}</div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────
export default function TrabajoDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const { canManageTrabajos } = useAuth();
  const { notify } = useNotification();
  // Abierta desde un aviso push o un enlace no hay pantalla anterior: «‹»
  // lleva al listado de trabajos (gestión) o a la portada
  const volver = useVolver(canManageTrabajos() ? '/trabajos' : '/');

  const [trabajo,        setTrabajo]        = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [showEdit,       setShowEdit]       = useState(false);
  const [nuevaAmbulancia, setNuevaAmbulancia] = useState(false);
  // El detalle de una ambulancia se abre encima, con `?ver=<id>` puesto con
  // push: el «atrás» del móvil lo cierra y deja en el trabajo, en vez de
  // sacar a la pantalla anterior. Se cierre como se cierre, se recarga
  const [verUrl, abrirDetalle, cerrarDetalle] = usePanelEnUrl('ver', { alCerrar: () => load() });
  const detalleId = Number(verUrl) || null;
  const [confirmCerrar,  setConfirmCerrar]  = useState(false);
  const [cerrando,       setCerrando]       = useState(false);
  const [confirmVolver,  setConfirmVolver]  = useState(false);
  const [volviendo,      setVolviendo]      = useState(false);
  const [otroTrabajo,    setOtroTrabajo]    = useState(false);

  // Se llega aquí recién creado desde el alta (`TrabajoList` o el «Añadir
  // otro trabajo» de esta misma ficha): el aviso deja encadenar otra alta sin
  // volver al listado. Va en el estado de la navegación y no en la URL para
  // que un enlace compartido no lo arrastre. El nuevo SUSTITUYE a esta ficha
  // en el historial: con varias altas seguidas, «‹» vuelve al listado y no
  // recorre una a una las fichas recién creadas.
  const recienCreado = !!location.state?.recienCreado;
  const irANuevo = (nuevo) => {
    setOtroTrabajo(false);
    if (nuevo?.id) navigate(`/trabajos/${nuevo.id}`, { replace: true, state: { recienCreado: true } });
  };

  // `?asignacion=N`: los avisos, la alarma, la ficha del vehículo y el mapa
  // traen aquí con esa ambulancia señalada (D10). Se resalta y se lleva a la
  // vista; no se abre sola, para que se vea en qué trabajo está.
  const resaltada = Number(params.get('asignacion')) || null;
  const refResaltada = useRef(null);

  const load = useCallback(async () => {
    try {
      setTrabajo(await trabajosService.get(id));
    } catch (err) {
      notify.error(err.response?.status === 403
        ? 'No tienes acceso a este trabajo'
        : 'Error al cargar el trabajo');
      volver();
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (trabajo && resaltada) refResaltada.current?.scrollIntoView?.({ block: 'center' });
  }, [trabajo, resaltada]);

  if (loading) return <PageLoading />;
  if (!trabajo) return null;
  // Recarga con la pantalla de carga, como antes de la fase 4: sin ella, tras
  // cerrar un vehículo seguía un momento con «Cerrar vehículo» activo y otra
  // pulsación daba 400 (revisión del 2026-10-10)
  if (trabajo.v25) {
    return <TrabajoV25 trabajo={trabajo} onRecargar={() => { setLoading(true); return load(); }} />;
  }

  const cerrado      = estaCerrado(trabajo.estado);
  const gestion      = canManageTrabajos();
  const ambulancias  = trabajo.asignaciones || [];
  const mias         = misAmbulancias(trabajo);
  const coordinan    = coordinadoresDe(trabajo);
  const coordinador  = nombresDe(coordinan);
  const equipo       = trabajo.usuarios || [];
  // En el equipo del trabajo pero en ninguna ambulancia (todavía, o nunca)
  const soloEquipo   = trabajo.mi_rol === 'equipo' && !mias.length;
  // Previsto (v41): lo que le falta para pasar a programado ([] si no lo es)
  const falta        = faltaParaProgramado(trabajo);

  const cerrarTrabajo = async () => {
    setCerrando(true);
    try {
      setTrabajo(await trabajosService.cerrar(trabajo.id));
      notify.success('Trabajo cerrado');
      setConfirmCerrar(false);
    } catch (err) {
      notify.error(err.response?.data?.message || 'No se pudo cerrar el trabajo');
      setConfirmCerrar(false);
      load();
    } finally {
      setCerrando(false);
    }
  };

  // Deshacer una activación por error (2026-10-16, TRB-2026-0040). El backend
  // solo lo ofrece a gestión y con nadie empezado; si hay algo que arreglar
  // antes (la hora de inicio ya pasada), lo dice en `motivo`.
  const volverOfrecido = trabajo.volver_a_programado;
  const volverAProgramado = async () => {
    setVolviendo(true);
    try {
      setTrabajo(await trabajosService.volverAProgramado(trabajo.id));
      notify.success('El trabajo vuelve a estar programado');
    } catch (err) {
      notify.error(err.response?.data?.message || 'No se pudo volver a programado', 12000);
      load();
    } finally {
      setVolviendo(false);
      setConfirmVolver(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      {/* Cabecera */}
      <div className="flex items-start gap-3">
        <button onClick={volver} className="btn-ghost btn-icon mt-1" aria-label="Volver">‹</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[19px] font-semibold text-neutral-900">{trabajo.nombre}</h1>
            <EstadoBadge estado={trabajo.estado} />
            <TipoBadge tipo={trabajo.tipo} />
          </div>
          <p className="text-neutral-500 text-sm mt-0.5 data">{trabajo.identificador}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          {volverOfrecido && (
            <button onClick={() => setConfirmVolver(true)} className="btn-secondary text-sm"
              data-testid="volver-a-programado">
              Volver a programado
            </button>
          )}
          {gestion && !cerrado && (
            <button onClick={() => setShowEdit(true)} className="btn-secondary text-sm">Editar</button>
          )}
        </div>
      </div>

      {/* Previsto (v41): qué le falta para pasar a programado, que pasa
          solo en cuanto lo tiene */}
      {falta.length > 0 && (
        <div className="card bg-bad-50 border-bad-200 text-sm text-bad-700" data-testid="trabajo-previsto">
          <p className="font-semibold">Trabajo previsto</p>
          <p className="mt-0.5">
            Le falta {falta.map(f => (f === 'coordinador' ? 'el coordinador' : 'al menos una ambulancia')).join(' y ')}.
            Pasa a programado solo, en cuanto {falta.length > 1 ? 'los tenga' : 'lo tenga'}
            {gestion
              ? `: ${[falta.includes('coordinador') && 'el coordinador se pone con «Editar»',
                      falta.includes('ambulancia') && 'las ambulancias se añaden abajo'].filter(Boolean).join(' y ')}.`
              : '.'}
          </p>
        </div>
      )}

      {recienCreado && gestion && (
        <div className="card bg-ok-50 border-ok-200 flex flex-col sm:flex-row sm:items-center gap-3"
          data-testid="trabajo-creado">
          <p className="flex-1 text-sm text-ok-600">
            Trabajo creado. Las ambulancias que falten se añaden abajo, cuando se sepan.
          </p>
          <button onClick={() => setOtroTrabajo(true)} className="btn-primary">Añadir otro trabajo</button>
        </div>
      )}

      {/* Pendiente de cierre (D3): lo cierra el coordinador */}
      {trabajo.estado === 'pendiente_cierre' && (
        <div className="card bg-warn-50 border-warn-200 border-2 space-y-2">
          <p className="font-semibold text-warn-700">Todas las ambulancias han terminado</p>
          {trabajo.puede_cerrar ? (
            <>
              <p className="text-sm text-warn-700">
                Revisa que todo esté en orden y cierra el trabajo. Mientras no lo cierres,
                sigue en la portada de quienes han ido.
              </p>
              <button onClick={() => setConfirmCerrar(true)} className="btn-primary">Cerrar trabajo</button>
            </>
          ) : (
            <p className="text-sm text-warn-700">
              Falta que lo cierre {coordinan.length > 1
                ? `uno de sus coordinadores (${coordinador})` : coordinador || 'el coordinador'}.
            </p>
          )}
        </div>
      )}

      {/* Sin ambulancias que cerrar: el coordinador lo da por hecho cuando
          ya ha empezado (antes, si no se va a hacer, se elimina) */}
      {trabajo.puede_cerrar && trabajo.estado !== 'pendiente_cierre' && (
        <div className="card space-y-2">
          <p className="text-sm text-neutral-700">
            Este trabajo no lleva ninguna ambulancia en marcha. Si ya se ha hecho, ciérralo.
          </p>
          <button onClick={() => setConfirmCerrar(true)} className="btn-secondary">Cerrar trabajo</button>
        </div>
      )}

      {cerrado && trabajo.cerrado_at && (
        <div className="card bg-ok-50 border-ok-200 text-sm text-ok-600">
          {ESTADO_LABELS[trabajo.estado]} · cerrado el {formatDateTime(trabajo.cerrado_at)}
        </div>
      )}

      {/* Tu ambulancia (D7): lo primero para quien va en el trabajo */}
      {mias.map(a => (
        <TuAmbulancia key={a.id} a={a} onAbrir={() => abrirDetalle(a.id)} />
      ))}
      {soloEquipo && !cerrado && (
        <div className="card bg-neutral-50 border-neutral-200 text-sm text-neutral-600" data-testid="solo-equipo">
          Estás en el equipo de este trabajo. Si te ponen en una ambulancia, la verás aquí.
        </div>
      )}

      {/* Ficha: la ve todo el que va en el trabajo */}
      <div className="card space-y-4">
        {trabajo.descripcion && (
          <p className="text-sm text-neutral-700 whitespace-pre-line">{trabajo.descripcion}</p>
        )}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {(trabajo.ubicacion || trabajo.ubicacion_url) && (
            <div className="col-span-2">
              <p className="text-neutral-500 text-xs">Ubicación</p>
              {trabajo.ubicacion && <p className="font-medium">{trabajo.ubicacion}</p>}
              <EnlaceMaps trabajo={trabajo} className="mt-1.5" />
            </div>
          )}
          {/* El trabajo va de la salida de base a la vuelta, y el evento dentro (v42) */}
          {textoEvento(trabajo) && (
            <div className="col-span-2" data-testid="evento-trabajo">
              <p className="text-neutral-500 text-xs">Evento</p>
              <p className="font-medium">{textoEvento(trabajo)}</p>
            </div>
          )}
          <div>
            <p className="text-neutral-500 text-xs">Salida de base</p>
            <p className="font-medium">{formatDateTime(trabajo.fecha_inicio)}</p>
          </div>
          <div>
            <p className="text-neutral-500 text-xs">Vuelta a base</p>
            <p className="font-medium">{formatDateTime(trabajo.fecha_fin)}</p>
          </div>
          <div>
            <p className="text-neutral-500 text-xs">Duración</p>
            <p className="font-medium">{duration(trabajo.fecha_inicio, trabajo.fecha_fin)}</p>
          </div>
          <div>
            <p className="text-neutral-500 text-xs">{coordinan.length > 1 ? 'Coordinan' : 'Coordina'}</p>
            <p className="font-medium">{coordinador || '—'}</p>
          </div>
          {/* Horario por días (v39): cada día se ficha con «Inicio/Fin de jornada» */}
          {trabajo.horario?.length > 0 && (
            <div className="col-span-2" data-testid="horario-trabajo">
              <p className="text-neutral-500 text-xs">Horario por días</p>
              <ul className="font-medium space-y-0.5">
                {horarioDesdeApi(trabajo.horario).map(d => (
                  <li key={d.dia}>
                    {etiquetaDia(d.dia)}: <span className="data">{textoTramos(d.tramos)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Equipo del trabajo: la gente asignada, vaya o no en una ambulancia */}
      {(equipo.length > 0 || (gestion && !cerrado)) && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-neutral-900">Equipo del trabajo</h2>
          {equipo.length ? (
            <p className="text-sm text-neutral-700">{nombresDe(equipo)}</p>
          ) : (
            <p className="text-sm text-neutral-500">Sin nadie asignado todavía. Se añade desde «Editar».</p>
          )}
        </div>
      )}

      {/* Ambulancias */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-neutral-900">Ambulancias</h2>
          {gestion && !cerrado && (
            <button onClick={() => setNuevaAmbulancia(true)} className="btn-secondary text-xs px-2 py-1">
              + Añadir ambulancia
            </button>
          )}
        </div>
        {ambulancias.length === 0 && (
          <p className="text-sm text-neutral-500">
            Aún no lleva ninguna ambulancia{gestion && !cerrado ? ': añádelas cuando se sepan, con su responsable' : ''}.
          </p>
        )}
        {ambulancias.map(a => (
          <Ambulancia key={a.id} a={a} resaltada={a.id === resaltada} refResaltada={refResaltada}
            onAbrir={() => abrirDetalle(a.id)} />
        ))}
      </div>

      {showEdit && (
        <TrabajoForm
          trabajo={trabajo}
          onSaved={() => { setShowEdit(false); load(); }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {otroTrabajo && (
        <TrabajoForm onSaved={irANuevo} onClose={() => setOtroTrabajo(false)} />
      )}

      {nuevaAmbulancia && (
        <AsignacionForm
          trabajo={trabajo}
          onSaved={() => { setNuevaAmbulancia(false); load(); }}
          onClose={() => setNuevaAmbulancia(false)}
        />
      )}

      {detalleId && (
        <AsignacionDetalle
          id={detalleId}
          desdeTrabajo
          onClose={cerrarDetalle}
        />
      )}

      {/* Con algo que arreglar antes, se explica qué y no se ofrece seguir */}
      {volverOfrecido?.motivo ? (
        <Modal isOpen={confirmVolver} onClose={() => setConfirmVolver(false)}
          title="Antes hay que cambiar la hora" size="sm"
          footer={
            <button className="btn-primary w-full sm:w-auto" onClick={() => setConfirmVolver(false)}>
              Entendido
            </button>
          }>
          <p className="text-neutral-600 text-sm" data-testid="motivo-volver">{volverOfrecido.motivo}</p>
        </Modal>
      ) : (
        <ConfirmDialog
          isOpen={confirmVolver}
          onClose={() => setConfirmVolver(false)}
          onConfirm={volverAProgramado}
          title="Volver a programado"
          message={'Nadie ha empezado todavía el servicio en este trabajo. Sus ambulancias activas ' +
            'vuelven a programadas y se activarán solas a su hora de inicio.'}
          confirmText="Volver a programado"
          loading={volviendo}
        />
      )}

      <ConfirmDialog
        isOpen={confirmCerrar}
        onClose={() => setConfirmCerrar(false)}
        onConfirm={cerrarTrabajo}
        title="Cerrar trabajo"
        message="Todas las ambulancias han terminado. Al cerrarlo desaparece de la portada de quienes han ido y ya no se puede modificar."
        confirmText="Cerrar trabajo"
        loading={cerrando}
      />
    </div>
  );
}
