import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge } from '../../components/common/StatusBadge.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { formatDateTime, formatDateTimeShort, duration } from '../../utils/dateUtils.js';
import { ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS, ESTADO_LABELS } from '../../utils/constants.js';
import {
  estaCerrado, misAmbulancias, siguientePaso, textoEstadoAmbulancia, nombresDe,
} from '../../utils/trabajos.js';
import TrabajoForm from './TrabajoForm.jsx';
import AsignacionForm from '../asignaciones/AsignacionForm.jsx';
import AsignacionDetalle from '../asignaciones/AsignacionDetalle.jsx';

/**
 * Ficha de un trabajo (v33, el trabajo padre). La ve todo el que va en
 * cualquiera de sus ambulancias, su coordinador y gestión; qué ve cada uno de
 * cada ambulancia lo recorta el backend (`vistaParaUsuario`):
 *  - la suya, entera; de las demás, solo cuál es y quién va (decisión 6);
 *  - el coordinador y gestión, todas (D2).
 *
 * Aquí no se opera ninguna ambulancia: «Tu ambulancia» y cada tarjeta abren el
 * detalle de la asignación de siempre, que es donde están el inicio, las
 * fotos, la llegada y el cierre (D7).
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
        <span className={ASIGNACION_ESTADO_COLORS[a.estado] || 'badge-gray'}>
          {ASIGNACION_ESTADO_LABELS[a.estado] || a.estado}
        </span>
      </div>
      <p className="text-sm text-neutral-700">{textoEstadoAmbulancia(a)}</p>
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
        </div>
        {a.detalle && (
          <span className={ASIGNACION_ESTADO_COLORS[a.estado] || 'badge-gray'}>
            {ASIGNACION_ESTADO_LABELS[a.estado] || a.estado}
          </span>
        )}
      </div>
      {a.detalle && (
        <div className="text-xs text-neutral-500 flex flex-wrap gap-x-4 gap-y-0.5">
          <span>{textoEstadoAmbulancia(a)}</span>
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
  const { canManageTrabajos } = useAuth();
  const { notify } = useNotification();

  const [trabajo,        setTrabajo]        = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [showEdit,       setShowEdit]       = useState(false);
  const [nuevaAmbulancia, setNuevaAmbulancia] = useState(false);
  const [detalleId,      setDetalleId]      = useState(null);
  const [confirmCerrar,  setConfirmCerrar]  = useState(false);
  const [cerrando,       setCerrando]       = useState(false);

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
      navigate(-1);
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

  const cerrado      = estaCerrado(trabajo.estado);
  const gestion      = canManageTrabajos();
  const ambulancias  = trabajo.asignaciones || [];
  const mias         = misAmbulancias(trabajo);
  const vehiculosV25 = trabajo.vehiculos || [];
  const coordinador  = nombresDe(trabajo.coordinador ? [trabajo.coordinador] : []);

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

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      {/* Cabecera */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost btn-icon mt-1" aria-label="Volver">‹</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[19px] font-semibold text-neutral-900">{trabajo.nombre}</h1>
            <EstadoBadge estado={trabajo.estado} />
            <TipoBadge tipo={trabajo.tipo} />
          </div>
          <p className="text-neutral-500 text-sm mt-0.5 data">{trabajo.identificador}</p>
        </div>
        {gestion && !cerrado && (
          <button onClick={() => setShowEdit(true)} className="btn-secondary text-sm">Editar</button>
        )}
      </div>

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
              Falta que lo cierre {coordinador || 'el coordinador'}.
            </p>
          )}
        </div>
      )}

      {cerrado && trabajo.cerrado_at && (
        <div className="card bg-ok-50 border-ok-200 text-sm text-ok-600">
          {ESTADO_LABELS[trabajo.estado]} · cerrado el {formatDateTime(trabajo.cerrado_at)}
        </div>
      )}

      {/* Tu ambulancia (D7): lo primero para quien va en el trabajo */}
      {mias.map(a => (
        <TuAmbulancia key={a.id} a={a} onAbrir={() => setDetalleId(a.id)} />
      ))}

      {/* Ficha: la ve todo el que va en el trabajo */}
      <div className="card space-y-4">
        {trabajo.descripcion && (
          <p className="text-sm text-neutral-700 whitespace-pre-line">{trabajo.descripcion}</p>
        )}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {trabajo.ubicacion && (
            <div className="col-span-2">
              <p className="text-neutral-500 text-xs">Ubicación</p>
              <p className="font-medium">{trabajo.ubicacion}</p>
            </div>
          )}
          <div>
            <p className="text-neutral-500 text-xs">Inicio</p>
            <p className="font-medium">{formatDateTime(trabajo.fecha_inicio)}</p>
          </div>
          <div>
            <p className="text-neutral-500 text-xs">Fin previsto</p>
            <p className="font-medium">{formatDateTime(trabajo.fecha_fin)}</p>
          </div>
          <div>
            <p className="text-neutral-500 text-xs">Duración</p>
            <p className="font-medium">{duration(trabajo.fecha_inicio, trabajo.fecha_fin)}</p>
          </div>
          <div>
            <p className="text-neutral-500 text-xs">Coordina</p>
            <p className="font-medium">{coordinador || '—'}</p>
          </div>
        </div>
      </div>

      {/* Ambulancias */}
      {(ambulancias.length > 0 || (gestion && !cerrado && !vehiculosV25.length)) && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">Ambulancias</h2>
            {gestion && !cerrado && !vehiculosV25.length && (
              <button onClick={() => setNuevaAmbulancia(true)} className="btn-secondary text-xs px-2 py-1">
                + Añadir ambulancia
              </button>
            )}
          </div>
          {ambulancias.map(a => (
            <Ambulancia key={a.id} a={a} resaltada={a.id === resaltada} refResaltada={refResaltada}
              onAbrir={() => setDetalleId(a.id)} />
          ))}
        </div>
      )}

      {/* Trabajo del modelo anterior (v25): solo lectura. Su ciclo por
          vehículo sigue en el backend hasta la fase 6, sin pantalla. */}
      {vehiculosV25.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-neutral-900">Vehículos</h2>
          <p className="text-xs text-neutral-500">Trabajo creado con el modelo anterior: solo consulta.</p>
          {vehiculosV25.map(v => (
            <div key={v.vehicle_id} className="p-3 bg-neutral-50 rounded-lg text-sm">
              <p className="font-medium">{nombreVehiculo(v)} <span className="data text-xs text-neutral-500">{v.matricula}</span></p>
              <p className="text-xs text-neutral-600">
                {ESTADO_LABELS[v.estado] || v.estado} · Responsable: {nombresDe(v.responsables) || '—'}
              </p>
            </div>
          ))}
          {trabajo.usuarios?.length > 0 && (
            <p className="text-xs text-neutral-600">Equipo: {nombresDe(trabajo.usuarios)}</p>
          )}
        </div>
      )}

      {showEdit && (
        <TrabajoForm
          trabajo={trabajo}
          onSaved={() => { setShowEdit(false); load(); }}
          onClose={() => setShowEdit(false)}
        />
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
          onClose={() => { setDetalleId(null); load(); }}
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
