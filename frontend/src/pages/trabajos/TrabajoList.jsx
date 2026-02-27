import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge } from '../../components/common/StatusBadge.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import CalendarioTrab from '../../components/calendar/CalendarioTrab.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import TrabajoForm from './TrabajoForm.jsx';

export default function TrabajoList() {
  const { canManageTrabajos, canDeleteAny } = useAuth();
  const { notify } = useNotification();
  const navigate   = useNavigate();

  const [trabajos,   setTrabajos]   = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [filters,    setFilters]    = useState({ search: '', estado: '', tipo: '' });
  const [loading,    setLoading]    = useState(false);
  const [view,       setView]       = useState('list'); // 'list' | 'calendar'
  const [showForm,   setShowForm]   = useState(false);
  const [deleteId,   setDeleteId]   = useState(null);
  const [deleting,   setDeleting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await trabajosService.list({
        page,
        limit: 15,
        search: filters.search || undefined,
        estado: filters.estado || undefined,
        tipo:   filters.tipo   || undefined,
      });
      setTrabajos(resp.data || []);
      setPagination(resp.pagination);
    } catch { notify.error('Error al cargar trabajos'); }
    finally { setLoading(false); }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await trabajosService.delete(deleteId);
      notify.success('Trabajo eliminado');
      setDeleteId(null);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al eliminar trabajo');
    } finally {
      setDeleting(false);
    }
  };

  const setFilter = (k, v) => {
    setFilters(f => ({ ...f, [k]: v }));
    setPage(1);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900">Trabajos</h1>
          <p className="text-neutral-500 text-sm">{pagination?.total ?? 0} trabajos</p>
        </div>
        <div className="flex gap-2">
          {/* Toggle vista */}
          <div className="flex rounded-lg border border-neutral-200 overflow-hidden">
            <button
              onClick={() => setView('list')}
              className={`px-3 py-2 text-sm ${view === 'list' ? 'bg-primary-600 text-white' : 'hover:bg-neutral-50'}`}
            >
              📋 Lista
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-2 text-sm ${view === 'calendar' ? 'bg-primary-600 text-white' : 'hover:bg-neutral-50'}`}
            >
              📅 Calendario
            </button>
          </div>
          {canManageTrabajos() && (
            <button onClick={() => setShowForm(true)} className="btn-primary">
              + Nuevo
            </button>
          )}
        </div>
      </div>

      {view === 'calendar' ? (
        <div className="card">
          <CalendarioTrab
            onSelectTrabajo={(t) => navigate(`/trabajos/${t.id}`)}
          />
        </div>
      ) : (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              className="input flex-1 min-w-40"
              placeholder="Buscar..."
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
            />
            <select className="input w-auto" value={filters.estado} onChange={e => setFilter('estado', e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="programado">Programado</option>
              <option value="activo">Activo</option>
              <option value="finalizado">Finalizado</option>
              <option value="finalizado_anticipado">Fin. anticipado</option>
            </select>
            <select className="input w-auto" value={filters.tipo} onChange={e => setFilter('tipo', e.target.value)}>
              <option value="">Todos los tipos</option>
              <option value="traslado">Traslado</option>
              <option value="cobertura_evento">Cobertura evento</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          {loading ? <PageLoading /> : (
            <>
              {trabajos.length === 0 ? (
                <div className="card text-center py-12 text-neutral-400">
                  <p className="text-4xl mb-3">📋</p>
                  <p>Sin trabajos que mostrar</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {trabajos.map(t => (
                    <div key={t.id} className="card hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              to={`/trabajos/${t.id}`}
                              className="font-semibold text-neutral-900 hover:text-primary-600 hover:underline"
                            >
                              {t.nombre}
                            </Link>
                            <EstadoBadge estado={t.estado} />
                            <TipoBadge tipo={t.tipo} />
                          </div>
                          <p className="text-xs text-neutral-500 mt-1">
                            {t.identificador} · {formatDateTime(t.fecha_inicio)} → {formatDateTime(t.fecha_fin)}
                          </p>
                          <p className="text-xs text-neutral-400 mt-0.5">
                            {t.num_vehiculos} vehículo(s) · {t.num_usuarios} persona(s)
                          </p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <Link to={`/trabajos/${t.id}`} className="btn-secondary text-xs px-2 py-1">
                            Ver
                          </Link>
                          {canDeleteAny() && (
                            <button
                              onClick={() => setDeleteId(t.id)}
                              className="btn-ghost text-xs px-2 py-1 text-red-600 hover:bg-red-50"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pagination?.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button className="btn-secondary" onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}>‹ Anterior</button>
                  <span className="text-sm">{page} / {pagination.totalPages}</span>
                  <button className="btn-secondary" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}>Siguiente ›</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {showForm && (
        <TrabajoForm
          onSaved={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar trabajo"
        message="¿Seguro que deseas eliminar este trabajo?"
        confirmText="Eliminar"
        danger
        loading={deleting}
      />
    </div>
  );
}
