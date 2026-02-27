import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge, RolBadge } from '../../components/common/StatusBadge.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDateTime, duration } from '../../utils/dateUtils.js';
import { TRABAJO_ESTADOS } from '../../utils/constants.js';
import Finalizacion from './Finalizacion.jsx';
import TrabajoForm from './TrabajoForm.jsx';

export default function TrabajoDetail() {
  const { id }  = useParams();
  const navigate = useNavigate();
  const { canManageTrabajos, isAdmin, user } = useAuth();
  const { notify } = useNotification();

  const [trabajo,   setTrabajo]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [showFin,   setShowFin]   = useState(false);
  const [showEdit,  setShowEdit]  = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const t = await trabajosService.get(id);
      setTrabajo(t);
    } catch (err) {
      notify.error('Error al cargar el trabajo');
      navigate('/trabajos');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;
  if (!trabajo) return null;

  const finalizado = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO].includes(trabajo.estado);
  const soyResponsable = trabajo.vehiculos?.some(v => v.responsable_user_id === user?.id);

  if (showFin) {
    return (
      <Finalizacion
        trabajo={trabajo}
        onDone={() => { setShowFin(false); load(); }}
        onCancel={() => setShowFin(false)}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/trabajos')} className="btn-ghost btn-icon mt-1">‹</button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-neutral-900">{trabajo.nombre}</h1>
            <EstadoBadge estado={trabajo.estado} />
            <TipoBadge tipo={trabajo.tipo} />
          </div>
          <p className="text-neutral-500 text-sm mt-0.5">{trabajo.identificador}</p>
        </div>
        <div className="flex gap-2">
          {canManageTrabajos() && !finalizado && (
            <button onClick={() => setShowEdit(true)} className="btn-secondary text-sm">Editar</button>
          )}
          {!finalizado && (soyResponsable || canManageTrabajos()) && (
            <button onClick={() => setShowFin(true)} className="btn-primary text-sm">
              Finalizar
            </button>
          )}
        </div>
      </div>

      {/* Fechas */}
      <div className="card grid grid-cols-2 gap-4 text-sm">
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

      {/* Motivo finalización anticipada */}
      {trabajo.motivo_finalizacion_anticipada && (
        <div className="card bg-yellow-50 border-yellow-200">
          <p className="text-xs font-semibold text-yellow-800 mb-1">Motivo finalización anticipada:</p>
          <p className="text-sm text-yellow-700">{trabajo.motivo_finalizacion_anticipada}</p>
        </div>
      )}

      {/* Vehículos */}
      {trabajo.vehiculos?.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-neutral-900">Vehículos asignados</h2>
          {trabajo.vehiculos.map(v => (
            <div key={v.vehicle_id} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg">
              <div>
                <p className="font-medium text-sm">{v.alias} <span className="font-mono text-neutral-500">({v.matricula})</span></p>
                <p className="text-xs text-neutral-500">Responsable: {v.responsable_nombre}</p>
                <p className="text-xs text-neutral-400">
                  Km inicio: {v.kilometros_inicio?.toLocaleString() || '—'}
                  {v.kilometros_fin ? ` → Km fin: ${v.kilometros_fin.toLocaleString()}` : ''}
                </p>
              </div>
              <span className="text-2xl">🚐</span>
            </div>
          ))}
        </div>
      )}

      {/* Personal */}
      {trabajo.usuarios?.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-neutral-900">Personal asignado</h2>
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
      {trabajo.evidencias?.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-neutral-900">Evidencias fotográficas</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {trabajo.evidencias.map(img => (
              <div key={img.id} className="space-y-1">
                <a href={img.image_url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={img.image_url}
                    alt={img.tipo_imagen}
                    className="w-full aspect-video object-cover rounded-lg border hover:opacity-90 transition-opacity"
                  />
                </a>
                <p className="text-xs text-center text-neutral-500 capitalize">
                  {img.tipo_imagen.replace('_', ' ')} · {img.matricula}
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
    </div>
  );
}
