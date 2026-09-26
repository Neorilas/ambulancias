import React, { useState, useEffect, useCallback } from 'react';
import { useDebounce } from '../../hooks/useDebounce.js';
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

/**
 * Incidencias sin resolver (pendientes o en revisión) del vehículo. Rojo si
 * alguna es grave, ámbar si no; lleva directo a la pestaña Incidencias.
 * El backend solo manda el recuento a quien puede ver las incidencias: sin el
 * campo no se pinta nada.
 */
export function IncidenciasAbiertas({ vehicle }) {
  const abiertas = vehicle.incidencias_abiertas;
  if (abiertas == null) return null;
  if (abiertas === 0) return <span className="text-[12.5px] text-neutral-400 whitespace-nowrap">Sin incidencias</span>;

  const grave = vehicle.incidencias_gravedad_max === 'grave';
  return (
    <Link
      to={`/vehiculos/${vehicle.id}?tab=incidencias`}
      onClick={e => e.stopPropagation()}
      className={`${grave ? 'badge-red' : 'badge-yellow'} whitespace-nowrap hover:underline`}
    >
      {abiertas} abierta{abiertas !== 1 ? 's' : ''}{grave ? ' · grave' : ''}
    </Link>
  );
}

/** Fila de la tabla (escritorio). Toda la fila abre la ficha del vehículo. */
function VehicleRow({ vehicle, onEdit, onDelete, canEdit, canDelete, verIncidencias }) {
  const navigate = useNavigate();
  const proximaITV = calcProximaITV(vehicle.fecha_matriculacion, vehicle.fecha_itv);
  const proximaITS = calcProximaITS(vehicle.fecha_its);
  const proximaTarjeta = vehicle.fecha_tarjeta_transporte
    ? new Date(vehicle.fecha_tarjeta_transporte)
    : null;

  return (
    <tr className="cursor-pointer hover:bg-neutral-50" onClick={() => navigate(`/vehiculos/${vehicle.id}`)}>
      <td className="name">
        {/* Sigue siendo un enlace para poder abrirlo en otra pestaña */}
        <Link to={`/vehiculos/${vehicle.id}`} className="hover:text-primary-700"
          onClick={e => e.stopPropagation()}>
          {vehicle.alias}
        </Link>
      </td>
      <td className="data text-[13px] text-neutral-500">{vehicle.matricula}</td>
      <td className="num">
        {vehicle.kilometros_actuales != null ? vehicle.kilometros_actuales.toLocaleString() : '—'}
      </td>
      <td><Due proxima={proximaITV} /></td>
      <td><Due proxima={proximaITS} /></td>
      <td><Due proxima={proximaTarjeta} umbralAviso={60} /></td>
      {verIncidencias && <td><IncidenciasAbiertas vehicle={vehicle} /></td>}
      <td>
        {/* Los botones hacen lo suyo, no abren la ficha */}
        <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
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

/** Tarjeta (móvil): los mismos datos, apilados. Toda la tarjeta abre la ficha. */
function VehicleCard({ vehicle, onEdit, onDelete, canEdit, canDelete }) {
  const navigate = useNavigate();
  const proximaITV = calcProximaITV(vehicle.fecha_matriculacion, vehicle.fecha_itv);
  const proximaITS = calcProximaITS(vehicle.fecha_its);
  const proximaTarjeta = vehicle.fecha_tarjeta_transporte
    ? new Date(vehicle.fecha_tarjeta_transporte)
    : null;

  return (
    <div className="card cursor-pointer" onClick={() => navigate(`/vehiculos/${vehicle.id}`)}>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <Link
          to={`/vehiculos/${vehicle.id}`}
          className="veh-name hover:text-primary-700"
          onClick={e => e.stopPropagation()}
        >
          {vehicle.alias}
        </Link>
        <span className="data text-[13px] text-neutral-500">{vehicle.matricula}</span>
        {vehicle.incidencias_abiertas > 0 && (
          <span className="ml-auto"><IncidenciasAbiertas vehicle={vehicle} /></span>
        )}
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

      <div className="flex gap-2 mt-3.5 pt-3 border-t border-neutral-100"
        onClick={e => e.stopPropagation()}>
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
  const { canManageVehicles, canDeleteAny, canAccessGestion } = useAuth();
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
  const [soloIncidencias, setSoloIncidencias] = useState(false);

  // Buscar sobre el texto ya reposado: si no, cada tecla era una petición.
  const busqueda = useDebounce(search, 400);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await vehiclesService.list({
        page, search: busqueda || undefined, limit: 25,
        incidencias: soloIncidencias ? 'abiertas' : undefined,
      });
      setVehicles(resp.data || []);
      setPagination(resp.pagination);
    } catch { notify.error('Error al cargar vehículos'); }
    finally { setLoading(false); }
  }, [page, busqueda, soloIncidencias]);

  useEffect(() => { load(); }, [load]);

  // Al cambiar la búsqueda hay que volver a la primera página, o se pide una
  // página que el nuevo filtro ya no tiene y la lista sale vacía.
  useEffect(() => { setPage(1); }, [busqueda]);

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
  // Admin, gestor y superadmin: los que pueden abrir las incidencias en la ficha.
  const verIncidencias = canAccessGestion();
  const canEdit = canManageVehicles();
  const canDelete = canDeleteAny();

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <h1 className="text-[19px] font-semibold text-neutral-900">Vehículos</h1>
          <p className="text-neutral-500 text-[13px] mt-0.5">
            {pagination?.total ?? 0} {soloIncidencias ? 'con incidencias abiertas' : 'en flota'}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditVeh(null); setShowForm(true); }} className="btn-primary">
            Nuevo vehículo
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="search"
          className="input flex-1"
          placeholder="Buscar por nombre o matrícula…"
          value={search}
          onChange={e => { setPage(1); setSearch(e.target.value); }}
        />
        {verIncidencias && (
          <button
            type="button"
            aria-pressed={soloIncidencias}
            onClick={() => { setPage(1); setSoloIncidencias(v => !v); }}
            className={soloIncidencias ? 'btn-primary whitespace-nowrap' : 'btn-secondary whitespace-nowrap'}
          >
            Solo con incidencias
          </button>
        )}
      </div>

      {loading ? <PageLoading /> : (
        <>
          {vehicles.length === 0 ? (
            <div className="empty">
              <p className="empty-title">Sin vehículos</p>
              <p className="empty-hint">
                {soloIncidencias
                  ? 'Ningún vehículo tiene incidencias sin resolver'
                  : search ? 'Ninguno coincide con la búsqueda' : 'Todavía no hay vehículos registrados'}
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
                        <th>Ambulancia</th>
                        <th>Matrícula</th>
                        <th className="text-right">Km</th>
                        <th>Próxima ITV</th>
                        <th>Próxima ITS</th>
                        <th>Tarjeta transporte</th>
                        {verIncidencias && <th>Incidencias</th>}
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
                          verIncidencias={verIncidencias}
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
