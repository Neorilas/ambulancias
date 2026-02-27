import React, { useState, useEffect, useCallback } from 'react';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDate } from '../../utils/dateUtils.js';
import VehicleForm from './VehicleForm.jsx';

function VehicleCard({ vehicle, onEdit, onDelete, canEdit, canDelete }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-neutral-900">{vehicle.alias}</h3>
          <p className="text-sm text-neutral-500 font-mono">{vehicle.matricula}</p>
        </div>
        <span className="text-2xl">🚐</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-neutral-500 text-xs">Kilómetros</p>
          <p className="font-medium">{vehicle.kilometros_actuales?.toLocaleString()} km</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Última revisión</p>
          <p className="font-medium">{formatDate(vehicle.fecha_ultima_revision) || '—'}</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Último servicio</p>
          <p className="font-medium">{formatDate(vehicle.fecha_ultimo_servicio) || '—'}</p>
        </div>
      </div>
      {(canEdit || canDelete) && (
        <div className="flex gap-2 pt-1 border-t border-neutral-100">
          {canEdit && (
            <button onClick={() => onEdit(vehicle)} className="btn-secondary text-xs flex-1">
              Editar
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(vehicle.id)}
              className="btn-ghost text-xs text-red-600 hover:bg-red-50 flex-1"
            >
              Eliminar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function VehicleList() {
  const { canManageVehicles, canDeleteAny } = useAuth();
  const { notify } = useNotification();

  const [vehicles,   setVehicles]   = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [editVeh,    setEditVeh]    = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);
  const [deleting,   setDeleting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await vehiclesService.list({ page, search: search || undefined, limit: 12 });
      setVehicles(resp.data || []);
      setPagination(resp.pagination);
    } catch { notify.error('Error al cargar vehículos'); }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await vehiclesService.delete(deleteId);
      notify.success('Vehículo eliminado');
      setDeleteId(null);
      load();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al eliminar vehículo');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900">Vehículos</h1>
          <p className="text-neutral-500 text-sm">{pagination?.total ?? 0} vehículos en flota</p>
        </div>
        {canManageVehicles() && (
          <button onClick={() => { setEditVeh(null); setShowForm(true); }} className="btn-primary">
            + Nuevo vehículo
          </button>
        )}
      </div>

      <input
        type="search"
        className="input"
        placeholder="Buscar por matrícula o alias..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {loading ? <PageLoading /> : (
        <>
          {vehicles.length === 0 ? (
            <div className="card text-center py-12 text-neutral-400">
              <p className="text-4xl mb-3">🚐</p>
              <p>Sin vehículos registrados</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {vehicles.map(v => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  onEdit={(veh) => { setEditVeh(veh); setShowForm(true); }}
                  onDelete={setDeleteId}
                  canEdit={canManageVehicles()}
                  canDelete={canDeleteAny()}
                />
              ))}
            </div>
          )}

          {pagination?.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn-secondary" onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}>‹</button>
              <span className="text-sm">{page} / {pagination.totalPages}</span>
              <button className="btn-secondary" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}>›</button>
            </div>
          )}
        </>
      )}

      {showForm && (
        <VehicleForm
          vehicle={editVeh}
          onSaved={() => { setShowForm(false); setEditVeh(null); load(); }}
          onClose={() => { setShowForm(false); setEditVeh(null); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar vehículo"
        message="¿Seguro que deseas eliminar este vehículo? Se realizará un soft delete."
        confirmText="Eliminar"
        danger
        loading={deleting}
      />
    </div>
  );
}
