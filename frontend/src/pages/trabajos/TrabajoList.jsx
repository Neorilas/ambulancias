import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { trabajosService } from '../../services/trabajos.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { EstadoBadge, TipoBadge } from '../../components/common/StatusBadge.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import CalendarioTrab from '../../components/calendar/CalendarioTrab.jsx';
import { formatDateTime } from '../../utils/dateUtils.js';
import { esDiaValido } from '../../utils/calendario.js';
import { useEstadoEnUrl, useBuscadorEnUrl, paginaDeUrl } from '../../hooks/useNavegacion.js';
import TrabajoForm from './TrabajoForm.jsx';

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function TrabajoList() {
  const { canManageTrabajos, canDeleteAny } = useAuth();
  const { notify } = useNotification();
  const navigate   = useNavigate();

  // Vista, página, filtros y el mes y el día del calendario van en la URL
  // para que «‹» desde la ficha de un trabajo vuelva a donde se estaba: en
  // estado de React, al volver se remontaba en «Lista» y en la página 1, sin
  // filtros. También es lo que hace funcionar `/trabajos?estado=activo` del
  // Dashboard, que antes se ignoraba
  const [url, cambiarUrl] = useEstadoEnUrl({
    vista: 'lista', mes: '', dia: '', page: '1', search: '', estado: '', tipo: '', revisar: '',
  });
  // `?revisar=fin_evento`: solo los trabajos con «Tiempos que no cuadran»
  // por el fin del evento (backend, `asignaciones_a_revisar`). Es para la
  // oficina, los mismos que abren esta pantalla; el backend vuelve a mirar el
  // rol y no cuenta los trabajos que coordina quien pregunta.
  const revisarFinEvento = url.revisar === 'fin_evento';
  const page    = paginaDeUrl(url.page);
  const filters = { search: url.search, estado: url.estado, tipo: url.tipo };
  // El buscador escribe en local y llega a la URL ya reposado (hook)
  const [texto, setTexto] = useBuscadorEnUrl(url.search, (v) => cambiarUrl({ search: v, page: 1 }));

  const [trabajos,   setTrabajos]   = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading,    setLoading]    = useState(false);
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
        revisar: revisarFinEvento ? 'fin_evento' : undefined,
      });
      setTrabajos(resp.data || []);
      setPagination(resp.pagination);
    } catch { notify.error('Error al cargar trabajos'); }
    finally { setLoading(false); }
  }, [page, url.search, url.estado, url.tipo, revisarFinEvento]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await trabajosService.delete(deleteId);
      notify.success('Trabajo eliminado');
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null); // cerrar dialog para que el toast sea visible
      notify.error(err.response?.data?.message || 'Error al eliminar trabajo');
    } finally {
      setDeleting(false);
    }
  };

  const view   = url.vista === 'calendario' ? 'calendar' : 'list';
  const mesCal = MES_RE.test(url.mes) ? url.mes : null;
  const diaCal = esDiaValido(url.dia) ? url.dia : null;
  const setView = (v) => cambiarUrl({ vista: v === 'calendar' ? 'calendario' : 'lista' });
  const setPage = (fn) => cambiarUrl({ page: fn(page) });
  const setFilter = (k, v) => cambiarUrl({ [k]: v, page: 1 });

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-[19px] font-semibold text-neutral-900">Trabajos</h1>
          <p className="text-neutral-500 text-sm">{pagination?.total ?? 0} trabajos</p>
        </div>
        <div className="flex gap-2">
          {/* Toggle vista */}
          <div className="flex rounded-md border border-neutral-200 overflow-hidden bg-white">
            <button
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              className={`px-3 h-8 text-[12.5px] font-medium border-r border-neutral-200 ${view === 'list' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
            >
              Lista
            </button>
            <button
              onClick={() => setView('calendar')}
              aria-pressed={view === 'calendar'}
              className={`px-3 h-8 text-[12.5px] font-medium ${view === 'calendar' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
            >
              Calendario
            </button>
          </div>
          {canManageTrabajos() && (
            <button onClick={() => setShowForm(true)} className="btn-primary">
              Nuevo trabajo
            </button>
          )}
        </div>
      </div>

      {view === 'calendar' ? (
        <div className="card">
          <CalendarioTrab
            mes={mesCal}
            dia={diaCal}
            onCambiarMes={(mes) => cambiarUrl({ mes })}
            onCambiarDia={(dia) => cambiarUrl({ dia })}
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
              value={texto}
              onChange={e => setTexto(e.target.value)}
            />
            <select className="input w-auto" value={filters.estado} onChange={e => setFilter('estado', e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="programado">Programado</option>
              <option value="activo">Activo</option>
              <option value="pendiente_cierre">Pendiente de cierre</option>
              <option value="finalizado">Finalizado</option>
              <option value="finalizado_anticipado">Fin. anticipado</option>
            </select>
            <select className="input w-auto" value={filters.tipo} onChange={e => setFilter('tipo', e.target.value)}>
              <option value="">Todos los tipos</option>
              <option value="traslado">Traslado</option>
              <option value="cobertura_evento">Cobertura evento</option>
              <option value="otro">Otro</option>
            </select>
            <button
              type="button"
              onClick={() => cambiarUrl({ revisar: revisarFinEvento ? '' : 'fin_evento', page: 1 })}
              aria-pressed={revisarFinEvento}
              title="Trabajos con alguna ambulancia en la que «Fin evento/servicio» no se pulsó, o se pulsó justo antes de finalizar (probablemente ya en base)"
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                ${revisarFinEvento
                  ? 'bg-bad-600 text-white border-bad-600'
                  : 'bg-white text-neutral-600 border-neutral-300 hover:border-bad-500'
                }`}
            >
              Tiempos que no cuadran
            </button>
          </div>

          {loading ? <PageLoading /> : (
            <>
              {trabajos.length === 0 ? (
                <div className="empty">
                  <p className="empty-title">Sin trabajos</p>
                  <p className="empty-hint">Ninguno coincide con los filtros actuales</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {trabajos.map(t => (
                    <div
                      key={t.id}
                      className={`card hover:shadow-md transition-shadow cursor-pointer border-l-4 ${
                        t.estado === 'activo'     ? 'border-l-green-500' :
                        t.estado === 'programado' ? 'border-l-yellow-400' :
                        t.estado === 'pendiente_cierre' ? 'border-l-yellow-400' :
                        t.estado === 'finalizado' ? 'border-l-neutral-300' :
                        'border-l-red-300'
                      }`}
                      onClick={() => navigate(`/trabajos/${t.id}`)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {t.estado === 'activo' && (
                              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok-500 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-ok-500" />
                              </span>
                            )}
                            <span className="font-semibold text-neutral-900">{t.nombre}</span>
                            <EstadoBadge estado={t.estado} />
                            <TipoBadge tipo={t.tipo} />
                            {/* Ambulancias con el fin del evento a revisar
                                (backend; null a quien no le toca verlo). El
                                texto lo eligió el usuario (2026-10-11); el
                                número de ambulancias va en el `title` */}
                            {Number(t.asignaciones_a_revisar) > 0 && (
                              <span className="badge-red whitespace-nowrap" data-testid="trabajo-a-revisar"
                                    title={`${Number(t.asignaciones_a_revisar) === 1 ? '1 ambulancia' : `${t.asignaciones_a_revisar} ambulancias`} en las que «Fin evento/servicio» no se pulsó, o se pulsó justo antes de finalizar (probablemente ya en base). El detalle, dentro de cada ambulancia`}>
                                Tiempos que no cuadran
                              </span>
                            )}
                          </div>
                          {/* Las fechas destacan (2026-10-10): el listado va
                              ordenado por ellas y es lo primero que se busca.
                              Jerarquía título > fecha > resto: a 15 px y en
                              negrita la mono pesaba tanto como el título.
                              Cada fecha entera en su línea: en el móvil no
                              cabe el par y se partía la de fin por la hora */}
                          <p className="text-[13px] font-medium text-neutral-800 mt-1 data" data-testid="fechas-trabajo">
                            <span className="whitespace-nowrap">{formatDateTime(t.fecha_inicio)} →</span>{' '}
                            <span className="whitespace-nowrap">{formatDateTime(t.fecha_fin)}</span>
                          </p>
                          <p className="text-xs text-neutral-500 mt-0.5 data">{t.identificador}</p>
                          <p className="text-xs text-neutral-400 mt-0.5">
                            {t.num_vehiculos} ambulancia(s) · {t.num_usuarios} persona(s)
                            {t.coordinadores_nombres && (
                              <> · {Number(t.num_coordinadores) > 1 ? 'Coordinan' : 'Coordina'} {t.coordinadores_nombres}</>
                            )}
                          </p>
                        </div>
                        {canDeleteAny() && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(t.id); }}
                            className="btn-ghost text-xs px-2 py-1 text-bad-600 hover:bg-bad-50 flex-shrink-0"
                          >
                            ✕
                          </button>
                        )}
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
          // Recién creado, a su ficha: es donde se añaden más ambulancias, y
          // `recienCreado` le pone el aviso con «Añadir otro trabajo»
          onSaved={(nuevo) => {
            setShowForm(false);
            if (nuevo?.id) navigate(`/trabajos/${nuevo.id}`, { state: { recienCreado: true } });
            else load();
          }}
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
