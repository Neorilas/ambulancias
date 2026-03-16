import React, { useState, useEffect, useCallback } from 'react';
import { asignacionesService } from '../../services/asignaciones.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS } from '../../utils/constants.js';
import AsignacionForm from './AsignacionForm.jsx';
import AsignacionDetalle from './AsignacionDetalle.jsx';

const ESTADOS = ['', 'programada', 'activa', 'finalizada', 'cancelada'];

export default function AsignacionList() {
  const { notify } = useNotification();

  const [asignaciones, setAsignaciones] = useState([]);
  const [pagination,   setPagination]   = useState(null);
  const [page,         setPage]         = useState(1);
  const [estado,       setEstado]       = useState('');
  const [loading,      setLoading]      = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [editItem,     setEditItem]     = useState(null);
  const [deleteId,     setDeleteId]     = useState(null);
  const [deleting,     setDeleting]     = useState(false);
  const [detalleId,    setDetalleId]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (estado) params.estado = estado;
      const resp = await asignacionesService.list(params);
      setAsignaciones(resp.data || []);
      setPagination(resp.pagination);
    } catch {
      notify.error('Error al cargar asignaciones');
    } finally {
      setLoading(false);
    }
  }, [page, estado]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await asignacionesService.delete(deleteId);
      notify.success('Asignación eliminada');
      setDeleteId(null);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  const handleActivar = async (id) => {
    try {
      await asignacionesService.activar(id);
      notify.success('Asignación activada');
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al activar');
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900">Asignaciones de vehículos</h1>
          <p className="text-neutral-500 text-sm">{pagination?.total ?? 0} asignaciones</p>
        </div>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary">
          + Nueva asignación
        </button>
      </div>

      {/* Filtro estado */}
      <div className="flex gap-2 flex-wrap">
        {ESTADOS.map(e => (
          <button
            key={e}
            onClick={() => { setEstado(e); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
              ${estado === e
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-neutral-600 border-neutral-300 hover:border-primary-400'
              }`}
          >
            {e ? ASIGNACION_ESTADO_LABELS[e] : 'Todas'}
          </button>
        ))}
      </div>

      {/* Tabla */}
      {loading ? <PageLoading /> : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vehículo</th>
                    <th>Responsable</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Km inicio</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {asignaciones.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-neutral-400">Sin asignaciones</td></tr>
                  ) : asignaciones.map(a => (
                    <tr key={a.id} className="cursor-pointer" onClick={() => setDetalleId(a.id)}>
                      <td>
                        <p className="font-medium text-neutral-900">{a.matricula}</p>
                        {a.vehiculo_alias && <p className="text-xs text-neutral-500">{a.vehiculo_alias}</p>}
                      </td>
                      <td>
                        <p className="text-sm text-neutral-700">{a.responsable_nombre}</p>
                        <p className="text-xs text-neutral-400">@{a.responsable_username}</p>
                      </td>
                      <td className="text-sm text-neutral-600 whitespace-nowrap">{formatDateTime(a.fecha_inicio)}</td>
                      <td className="text-sm text-neutral-600 whitespace-nowrap">{formatDateTime(a.fecha_fin)}</td>
                      <td className="text-sm text-neutral-600">{a.km_inicio != null ? `${a.km_inicio.toLocaleString()} km` : '—'}</td>
                      <td>
                        <span className={ASIGNACION_ESTADO_COLORS[a.estado] || 'badge-gray'}>
                          {ASIGNACION_ESTADO_LABELS[a.estado] || a.estado}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {a.estado === 'programada' && (
                            <button
                              onClick={() => handleActivar(a.id)}
                              className="btn-ghost text-xs px-2 py-1 text-blue-600 hover:bg-blue-50"
                            >
                              Activar
                            </button>
                          )}
                          {(a.estado === 'programada' || a.estado === 'activa') && (
                            <button
                              onClick={() => { setEditItem(a); setShowForm(true); }}
                              className="btn-ghost text-xs px-2 py-1"
                            >
                              Editar
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteId(a.id)}
                            className="btn-ghost text-xs px-2 py-1 text-red-600 hover:bg-red-50"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginación */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn-secondary text-sm" onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}>‹ Anterior</button>
              <span className="text-sm text-neutral-600">{page} / {pagination.totalPages}</span>
              <button className="btn-secondary text-sm" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}>Siguiente ›</button>
            </div>
          )}
        </>
      )}

      {/* Modal formulario */}
      {showForm && (
        <AsignacionForm
          asignacion={editItem}
          onSaved={() => { setShowForm(false); setEditItem(null); load(); }}
          onClose={() => { setShowForm(false); setEditItem(null); }}
        />
      )}

      {/* Panel detalle */}
      {detalleId && (
        <AsignacionDetalle
          id={detalleId}
          onClose={() => { setDetalleId(null); load(); }}
        />
      )}

      {/* Confirmar borrado */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar asignación"
        message="¿Seguro que deseas eliminar esta asignación?"
        confirmText="Eliminar"
        danger
        loading={deleting}
      />
    </div>
  );
}
