import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDate } from '../../utils/dateUtils.js';
import VehicleForm from './VehicleForm.jsx';

function calcProximaITV(fechaMatriculacion, fechaUltimaITV) {
  if (!fechaUltimaITV) return null;
  const matricula = fechaMatriculacion ? new Date(fechaMatriculacion) : null;
  const ultimaITV = new Date(fechaUltimaITV);
  const hoy = new Date();
  let meses = 12;
  if (matricula) {
    const edadAnios = (hoy - matricula) / (1000 * 60 * 60 * 24 * 365.25);
    if (edadAnios >= 5) meses = 6;
  }
  const proxima = new Date(ultimaITV);
  proxima.setMonth(proxima.getMonth() + meses);
  return proxima;
}

function calcProximaITS(fechaUltimaITS) {
  if (!fechaUltimaITS) return null;
  const proxima = new Date(fechaUltimaITS);
  proxima.setFullYear(proxima.getFullYear() + 1);
  return proxima;
}

function RevisionPill({ label, proxima, umbralAviso = 30 }) {
  if (!proxima) return null;
  const dias = Math.ceil((proxima - new Date()) / (1000 * 60 * 60 * 24));
  if (dias > umbralAviso) return null;
  const vencida = dias < 0;
  return (
    <span className={`text-xs border rounded-full px-2 py-0.5 font-medium ${
      vencida ? 'bg-red-100 text-red-700 border-red-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'
    }`}>
      {vencida ? `⚠ ${label} vencida` : `⚠ ${label} en ${dias}d`}
    </span>
  );
}

function VehicleCard({ vehicle, onEdit, onDelete, canEdit, canDelete }) {
  const navigate = useNavigate();
  const proximaITV = calcProximaITV(vehicle.fecha_matriculacion, vehicle.fecha_itv);
  const proximaITS = calcProximaITS(vehicle.fecha_its);
  const proximaTarjeta = vehicle.fecha_tarjeta_transporte
    ? new Date(vehicle.fecha_tarjeta_transporte)
    : null;

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
          <p className="text-neutral-500 text-xs">Última ITV</p>
          <p className="font-medium">{formatDate(vehicle.fecha_itv) || '—'}</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Última ITS</p>
          <p className="font-medium">{formatDate(vehicle.fecha_its) || '—'}</p>
        </div>
        <div>
          <p className="text-neutral-500 text-xs">Tarjeta transporte</p>
          <p className="font-medium">{formatDate(vehicle.fecha_tarjeta_transporte) || '—'}</p>
        </div>
      </div>
      {(proximaITV || proximaITS || proximaTarjeta) && (
        <div className="flex flex-wrap gap-1">
          <RevisionPill label="ITV" proxima={proximaITV} />
          <RevisionPill label="ITS" proxima={proximaITS} />
          <RevisionPill label="Tarjeta transporte" proxima={proximaTarjeta} umbralAviso={60} />
        </div>
      )}
      <div className="flex gap-2 pt-1 border-t border-neutral-100">
        <button
          onClick={() => navigate(`/vehiculos/${vehicle.id}/historial`)}
          className="btn-secondary text-xs flex-1"
        >
          📷 Historial
        </button>
        {canEdit && (
          <button onClick={() => onEdit(vehicle)} className="btn-ghost text-xs flex-1">Editar</button>
        )}
        {canDelete && (
          <button onClick={() => onDelete(vehicle.id)} className="btn-ghost text-xs text-red-600 hover:bg-red-50">
            ✕
          </button>
        )}
      </div>
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
