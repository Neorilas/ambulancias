import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge, RolBadge } from '../../components/common/StatusBadge.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDateTime, formatDateTimeShort, duration } from '../../utils/dateUtils.js';
import {
  estaCerrado, accionesVehiculo, vehiculosConAcciones, nombresResponsables,
} from '../../utils/trabajos.js';
import { getImageUrl } from '../../utils/imageUtils.js';
import Finalizacion from './Finalizacion.jsx';
import InicioTrabajo from './InicioTrabajo.jsx';
import TrabajoForm from './TrabajoForm.jsx';
import { IMAGEN_TIPO_LABELS } from '../../utils/constants.js';

const TIPO_LABELS = IMAGEN_TIPO_LABELS;
const MOMENTO_LABEL = { inicio: 'Inicio', fin: 'Fin', general: '' };
const MOMENTO_BADGE = {
  inicio:  'bg-blue-100 text-blue-700',
  fin:     'bg-ok-50 text-ok-600',
  general: 'bg-neutral-100 text-neutral-600',
};

// ── Lightbox modal ────────────────────────────────────────────────────────────
function Lightbox({ img, allImgs, onClose }) {
  const [idx, setIdx] = useState(() => allImgs.findIndex(i => i.id === img.id));

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, allImgs.length - 1));
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [allImgs.length, onClose]);

  const current = allImgs[idx];
  const url     = getImageUrl(current.image_url);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/92 flex flex-col items-center justify-center pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))] pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]"
      onClick={onClose}
    >
      {/* Imagen */}
      <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
        <img
          src={url}
          alt={TIPO_LABELS[current.tipo_imagen] || current.tipo_imagen}
          className="w-full max-h-[75dvh] object-contain rounded-lg select-none"
        />

        {/* Prev / Next */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(i => i - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/90 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition"
          >‹</button>
        )}
        {idx < allImgs.length - 1 && (
          <button
            onClick={() => setIdx(i => i + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/90 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition"
          >›</button>
        )}

        {/* Info */}
        <div className="mt-3 flex items-center justify-between text-white text-sm px-1">
          <div className="space-y-0.5">
            <p className="font-medium">{TIPO_LABELS[current.tipo_imagen] || current.tipo_imagen}</p>
            {current.matricula && (
              <p className="text-neutral-400 text-xs font-mono">{current.matricula}</p>
            )}
            <p className="text-neutral-400 text-xs font-mono">{formatDateTime(current.created_at)}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-neutral-400 text-xs">{idx + 1} / {allImgs.length}</span>
            {/* Descargar */}
            <a
              href={url}
              download
              onClick={e => e.stopPropagation()}
              className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition"
            >
              Descargar
            </a>
          </div>
        </div>
      </div>

      {/* Tira de miniaturas */}
      {allImgs.length > 1 && (
        <div className="flex gap-2 mt-4 overflow-x-auto max-w-full pb-1">
          {allImgs.map((im, i) => (
            <button
              key={im.id}
              onClick={e => { e.stopPropagation(); setIdx(i); }}
              className={`flex-shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition ${
                i === idx ? 'border-primary-400' : 'border-transparent opacity-50 hover:opacity-80'
              }`}
            >
              <img
                src={getImageUrl(im.image_url)}
                alt={im.tipo_imagen}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Cerrar */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl leading-none transition"
      >
        ×
      </button>
    </div>
  );
}

// ── Un vehículo del trabajo ────────────────────────────────────────────────────
// Quien tiene su `detalle` (gestión o responsable de ESE vehículo) ve km,
// progreso de fotos y sus botones; el resto del equipo, solo qué vehículo es,
// en qué estado va y quién lo lleva. El recorte lo hace el backend.
function VehiculoTrabajo({ v, ocupado, onActivar, onInicio, onFin }) {
  const acc = accionesVehiculo(v);
  const pi  = v.progreso_fotos?.inicio;
  const pf  = v.progreso_fotos?.fin;
  return (
    <div className="p-3 bg-neutral-50 rounded-lg space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">
            {v.vehiculo_alias || v.matricula}{' '}
            <span className="data text-neutral-500">({v.matricula})</span>
          </p>
          <p className="text-xs text-neutral-500">
            Responsable{v.responsables?.length > 1 ? 's' : ''}: {nombresResponsables(v) || '—'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {v.soy_responsable && (
            <span className="badge bg-idle-50 text-idle-600 text-xs">Tuyo</span>
          )}
          <EstadoBadge estado={v.estado} />
        </div>
      </div>

      {v.detalle && (
        <div className="text-xs text-neutral-500 space-y-0.5">
          <p>
            Km inicio: {v.kilometros_inicio?.toLocaleString() || '—'}
            {v.kilometros_fin ? ` → Km fin: ${v.kilometros_fin.toLocaleString()}` : ''}
          </p>
          {pi && pf && (
            <p>Fotos de inicio {pi.completado}/{pi.total} · de fin {pf.completado}/{pf.total}</p>
          )}
          {(v.inicio_real_at || v.finalizado_at) && (
            <p className="data">
              Inicio real {v.inicio_real_at ? formatDateTimeShort(v.inicio_real_at) : '—'}
              {' · '}Cierre {v.finalizado_at ? formatDateTimeShort(v.finalizado_at) : '—'}
            </p>
          )}
          {v.motivo_finalizacion_anticipada && (
            <p className="text-warn-700">Cierre anticipado: {v.motivo_finalizacion_anticipada}</p>
          )}
        </div>
      )}

      {(acc.activar || acc.fotosInicio || acc.finalizar) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {acc.activar && (
            <button onClick={onActivar} disabled={ocupado} className="btn-secondary text-xs">
              Inicio de servicio
            </button>
          )}
          {acc.fotosInicio && (
            <button onClick={onInicio} className="btn-primary text-xs">Fotos de inicio</button>
          )}
          {acc.finalizar && (
            <button onClick={onFin} className="btn-primary text-xs">Cerrar vehículo</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trabajo sin vehículos: lo lleva gestión a mano ────────────────────────────
function CicloSinVehiculos({ trabajo, onHecho }) {
  const { notify } = useNotification();
  const [motivo, setMotivo]   = useState('');
  const [ocupado, setOcupado] = useState(false);
  const anticipado = new Date() < new Date(trabajo.fecha_fin);

  const correr = async (fn, ok) => {
    setOcupado(true);
    try { await fn(); notify.success(ok); onHecho(); }
    catch (err) { notify.error(err.response?.data?.message || 'No se pudo completar'); }
    finally { setOcupado(false); }
  };

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-neutral-900">Trabajo sin vehículos</h2>
      <p className="text-sm text-neutral-500">
        No hay responsable de vehículo que lo active o lo cierre: lo hace gestión desde aquí.
      </p>
      {trabajo.estado === 'programado' ? (
        <button disabled={ocupado} className="btn-secondary text-sm"
          onClick={() => correr(() => trabajosService.activar(trabajo.id), 'Trabajo activado')}>
          Activar trabajo
        </button>
      ) : (
        <>
          {anticipado && (
            <textarea className="input min-h-20 resize-none" value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Motivo de la finalización anticipada (obligatorio)" />
          )}
          <button disabled={ocupado || (anticipado && !motivo.trim())} className="btn-primary text-sm"
            onClick={() => correr(
              () => trabajosService.finalize(trabajo.id,
                { motivo_finalizacion_anticipada: anticipado ? motivo : undefined }),
              'Trabajo finalizado')}>
            Finalizar trabajo
          </button>
        </>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function TrabajoDetail() {
  const { id }  = useParams();
  const navigate = useNavigate();
  const { canManageTrabajos } = useAuth();
  const { notify } = useNotification();

  const [trabajo,     setTrabajo]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  // { tipo: 'inicio' | 'fin', vehicleId } mientras se hacen las fotos de uno
  const [accion,      setAccion]      = useState(null);
  const [activando,   setActivando]   = useState(null);
  const [showEdit,    setShowEdit]    = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await trabajosService.get(id);
      setTrabajo(t);
    } catch {
      notify.error('Error al cargar el trabajo');
      navigate(-1);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <PageLoading />;
  if (!trabajo) return null;

  const finalizado    = estaCerrado(trabajo.estado);
  const vehiculos     = trabajo.vehiculos || [];
  const allEvidencias = trabajo.evidencias || [];
  const sinInicio     = vehiculosConAcciones(trabajo).filter(v => accionesVehiculo(v).fotosInicio);
  const cerrar        = () => { setAccion(null); load(); };

  const activarVehiculo = async (v) => {
    setActivando(v.vehicle_id);
    try {
      await trabajosService.activarVehiculo(trabajo.id, v.vehicle_id);
      notify.success(`${v.vehiculo_alias || v.matricula}: servicio iniciado`);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'No se pudo activar el vehículo');
    } finally {
      setActivando(null);
    }
  };

  if (accion?.tipo === 'fin') {
    return (
      <Finalizacion trabajo={trabajo} vehicleId={accion.vehicleId}
        onDone={cerrar} onCancel={() => setAccion(null)} />
    );
  }
  if (accion?.tipo === 'inicio') {
    return (
      <InicioTrabajo trabajo={trabajo} vehicleIdFilter={accion.vehicleId}
        onDone={cerrar} onCancel={() => setAccion(null)} />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost btn-icon mt-1">‹</button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[19px] font-semibold text-neutral-900">{trabajo.nombre}</h1>
            <EstadoBadge estado={trabajo.estado} />
            <TipoBadge tipo={trabajo.tipo} />
          </div>
          <p className="text-neutral-500 text-sm mt-0.5 data">{trabajo.identificador}</p>
        </div>
        {canManageTrabajos() && !finalizado && (
          <button onClick={() => setShowEdit(true)} className="btn-secondary text-sm">Editar</button>
        )}
      </div>

      {/* Ficha: la ve todo el equipo */}
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
            <p className="text-neutral-500 text-xs">Creado por</p>
            <p className="font-medium">{trabajo.creado_por_nombre} {trabajo.creado_por_apellidos}</p>
          </div>
        </div>
      </div>

      {/* Aviso persistente: faltan fotos de inicio de algún vehículo tuyo */}
      {sinInicio.length > 0 && (
        <div className="card bg-warn-50 border-warn-200 border-2 space-y-2">
          <p className="font-semibold text-warn-700">Faltan las fotos de inicio</p>
          <p className="text-sm text-warn-700">
            Antes de poder cerrar un vehículo hay que documentar cómo se recibió.
          </p>
          <ul className="text-xs text-warn-600 space-y-1">
            {sinInicio.map(v => (
              <li key={v.vehicle_id} className="flex items-center justify-between gap-2">
                <span>
                  · <strong>{v.vehiculo_alias || v.matricula}</strong>{' — '}
                  {v.progreso_fotos?.inicio?.completado || 0}/{v.progreso_fotos?.inicio?.total} subidas
                </span>
                <button onClick={() => setAccion({ tipo: 'inicio', vehicleId: v.vehicle_id })}
                  className="btn-primary text-xs whitespace-nowrap">
                  Subir ahora
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Motivo finalización anticipada (trabajo sin vehículos) */}
      {trabajo.motivo_finalizacion_anticipada && (
        <div className="card bg-warn-50 border-warn-200">
          <p className="text-xs font-semibold text-warn-700 mb-1">Motivo finalización anticipada:</p>
          <p className="text-sm text-warn-600">{trabajo.motivo_finalizacion_anticipada}</p>
        </div>
      )}

      {/* Vehículos */}
      {vehiculos.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-neutral-900">Vehículos</h2>
          {vehiculos.map(v => (
            <VehiculoTrabajo
              key={v.vehicle_id}
              v={v}
              ocupado={activando === v.vehicle_id}
              onActivar={() => activarVehiculo(v)}
              onInicio={() => setAccion({ tipo: 'inicio', vehicleId: v.vehicle_id })}
              onFin={() => setAccion({ tipo: 'fin', vehicleId: v.vehicle_id })}
            />
          ))}
        </div>
      )}

      {vehiculos.length === 0 && canManageTrabajos() && !finalizado && (
        <CicloSinVehiculos trabajo={trabajo} onHecho={load} />
      )}

      {/* Equipo */}
      {trabajo.usuarios?.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-neutral-900">Equipo</h2>
          <div className="space-y-2">
            {trabajo.usuarios.map(u => (
              <div key={u.user_id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{u.nombre} {u.apellidos}</p>
                  <p className="text-xs text-neutral-500">@{u.username}</p>
                </div>
                <div className="flex gap-1">
                  {u.roles?.map(r => <RolBadge key={r} rol={r} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidencias fotográficas */}
      {allEvidencias.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-neutral-900">Evidencias fotográficas</h2>
            <span className="text-xs text-neutral-400">{allEvidencias.length} foto{allEvidencias.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {allEvidencias.map(img => (
              <div key={img.id} className="space-y-1">
                {/* Botón → abre lightbox, NO nueva pestaña */}
                <button
                  onClick={() => setLightboxImg(img)}
                  className="w-full group relative overflow-hidden rounded-lg border border-neutral-200 hover:border-primary-400 transition-colors"
                >
                  <img
                    src={getImageUrl(img.image_url)}
                    alt={TIPO_LABELS[img.tipo_imagen] || img.tipo_imagen}
                    className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                  {/* Badge momento */}
                  {img.momento && img.momento !== 'general' && (
                    <span className={`absolute top-1 left-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${MOMENTO_BADGE[img.momento]}`}>
                      {MOMENTO_LABEL[img.momento]}
                    </span>
                  )}
                  {/* Overlay lupa */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity drop-shadow">Ampliar</span>
                  </div>
                </button>
                <p className="text-xs text-center text-neutral-500 capitalize">
                  {(TIPO_LABELS[img.tipo_imagen] || img.tipo_imagen)} · {img.matricula}
                </p>
                <p className="text-[11px] text-center text-neutral-400 font-mono">
                  {formatDateTimeShort(img.created_at)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showEdit && (
        <TrabajoForm
          trabajo={trabajo}
          onSaved={() => { setShowEdit(false); load(); }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {/* Lightbox */}
      {lightboxImg && (
        <Lightbox
          img={lightboxImg}
          allImgs={allEvidencias}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
}
