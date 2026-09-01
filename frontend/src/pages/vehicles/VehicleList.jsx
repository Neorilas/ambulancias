import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { vehiclesService } from '../../services/vehicles.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import { formatDate } from '../../utils/dateUtils.js';
import { calcProximaITV, calcProximaITS, diasHasta } from '../../utils/vehicleAlerts.js';
import VehicleForm from './VehicleForm.jsx';

/**
 * Fecha de próxima revisión con su estado.
 * Rojo si está vencida, ámbar si entra en el umbral de aviso, neutra si falta mucho.
 */
function Due({ proxima, umbralAviso = 30 }) {
  if (!proxima) return <span className="text-neutral-400">—</span>;
  const dias = diasHasta(proxima);
  const fecha = formatDate(proxima);

  if (dias < 0) {
    return <span className="data text-[12.5px] font-semibold text-bad-600">Vencida · {fecha}</span>;
  }
  if (dias <= umbralAviso) {
    return <span className="data text-[12.5px] font-semibold text-warn-600">en {dias} d · {fecha}</span>;
  }
  return <span className="data text-[12.5px] text-neutral-600">{fecha}</span>;
}

/** Fila de la tabla (escritorio) */
function VehicleRow({ vehicle, onEdit, onDelete, canEdit, canDelete }) {
  const proximaITV = calcProximaITV(vehicle.fecha_matriculacion, vehicle.fecha_itv);
  const proximaITS = calcProximaITS(vehicle.fecha_its);
  const proximaTarjeta = vehicle.fecha_tarjeta_transporte
    ? new Date(vehicle.fecha_tarjeta_transporte)
    : null;

  return (
    <tr>
      <td className="id">
        <Link to={`/vehiculos/${vehicle.id}`} className="hover:text-primary-700">
          {vehicle.matricula}
        </Link>
      </td>
      <td className="text-neutral-900">{vehicle.alias || '—'}</td>
      <td className="num">
        {vehicle.kilometros_actuales != null ? vehicle.kilometros_actuales.toLocaleString() : '—'}
      </td>
      <td><Due proxima={proximaITV} /></td>
      <td><Due proxima={proximaITS} /></td>
      <td><Due proxima={proximaTarjeta} umbralAviso={60} /></td>
      <td>
        <div className="flex justify-end gap-1">
          <Link to={`/vehiculos/${vehicle.id}/historial`} className="btn-ghost btn-sm">Historial</Link>
          {canEdit && (
            <button onClick={() => onEdit(vehicle)} className="btn-ghost btn-sm">Editar</button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(vehicle.id)}
              className="btn-ghost btn-sm text-bad-600 hover:bg-bad-50"
            >
              Eliminar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Tarjeta (móvil): los mismos datos, apilados */
function VehicleCard({ vehicle, onEdit, onDelete, canEdit, canDelete }) {
  const navigate = useNavigate();
  const proximaITV = calcProximaITV(vehicle.fecha_matriculacion, vehicle.fecha_itv);
  const proximaITS = calcProximaITS(vehicle.fecha_its);
  const proximaTarjeta = vehicle.fecha_tarjeta_transporte
    ? new Date(vehicle.fecha_tarjeta_transporte)
    : null;

  return (
    <div className="card">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <Link to={`/vehiculos/${vehicle.id}`} className="plate hover:text-primary-700">
          {vehicle.matricula}
        </Link>
        <span className="text-[13.5px] font-medium text-neutral-500">{vehicle.alias}</span>
      </div>

      <div className="kv-row">
        <span>
          <span className="kv-k">Kilómetros</span>
          <span className="kv-v data">
            {vehicle.kilometros_actuales != null ? vehicle.kilometros_actuales.toLocaleString() : '—'}
          </span>
        </span>
        <span>
          <span className="kv-k">Próxima ITV</span>
          <span className="kv-v"><Due proxima={proximaITV} /></span>
        </span>
        <span>
          <span className="kv-k">Próxima ITS</span>
          <span className="kv-v"><Due proxima={proximaITS} /></span>
        </span>
        <span>
          <span className="kv-k">Tarjeta transporte</span>
          <span className="kv-v"><Due proxima={proximaTarjeta} umbralAviso={60} /></span>
        </span>
      </div>

      <div className="flex gap-2 mt-3.5 pt-3 border-t border-neutral-100">
        <button
          onClick={() => navigate(`/vehiculos/${vehicle.id}/historial`)}
          className="btn-secondary btn-sm flex-1"
        >
          Historial
        </button>
        {canEdit && (
          <button onClick={() => onEdit(vehicle)} className="btn-ghost btn-sm flex-1">Editar</button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(vehicle.id)}
            className="btn-ghost btn-sm text-bad-600 hover:bg-bad-50"
          >
            Eliminar
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
      const resp = await vehiclesService.list({ page, search: search || undefined, limit: 25 });
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

  const onEdit = (veh) => { setEditVeh(veh); setShowForm(true); };
  const canEdit = canManageVehicles();
  const canDelete = canDeleteAny();

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[19px] font-semibold text-neutral-900">Vehículos</h1>
          <p className="text-neutral-500 text-[13px] mt-0.5">
            {pagination?.total ?? 0} en flota
          </p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditVeh(null); setShowForm(true); }} className="btn-primary">
            Nuevo vehículo
          </button>
        )}
      </div>

      <input
        type="search"
        className="input"
        placeholder="Buscar matrícula o alias…"
        value={search}
        onChange={e => { setPage(1); setSearch(e.target.value); }}
      />

      {loading ? <PageLoading /> : (
        <>
          {vehicles.length === 0 ? (
            <div className="empty">
              <p className="empty-title">Sin vehículos</p>
              <p className="empty-hint">
                {search ? 'Ninguno coincide con la búsqueda' : 'Todavía no hay vehículos registrados'}
              </p>
            </div>
          ) : (
            <>
              {/* Escritorio: tabla — deja comparar ITV/ITS en columna */}
              <div className="hidden md:block card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Matrícula</th>
                        <th>Alias</th>
                        <th className="text-right">Km</th>
                        <th>Próxima ITV</th>
                        <th>Próxima ITS</th>
                        <th>Tarjeta transporte</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles.map(v => (
                        <VehicleRow
                          key={v.id}
                          vehicle={v}
                          onEdit={onEdit}
                          onDelete={setDeleteId}
                          canEdit={canEdit}
                          canDelete={canDelete}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Móvil: tarjetas */}
              <div className="md:hidden space-y-3">
                {vehicles.map(v => (
                  <VehicleCard
                    key={v.id}
                    vehicle={v}
                    onEdit={onEdit}
                    onDelete={setDeleteId}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                ))}
              </div>
            </>
          )}

          {pagination?.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button className="btn-secondary btn-sm" onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}>
                Anterior
              </button>
              <span className="text-[12.5px] text-neutral-500 data">{page} / {pagination.totalPages}</span>
              <button className="btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}>
                Siguiente
              </button>
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
