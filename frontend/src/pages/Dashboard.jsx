import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { trabajosService } from '../services/trabajos.service.js';
import { vehiclesService } from '../services/vehicles.service.js';
import { usersService } from '../services/users.service.js';
import { EstadoBadge } from '../components/common/StatusBadge.jsx';
import { formatDateTime } from '../utils/dateUtils.js';
import { PageLoading } from '../components/common/LoadingSpinner.jsx';

function StatCard({ label, value, icon, to, color = 'bg-white' }) {
  const content = (
    <div className={`card ${color} flex items-center gap-4`}>
      <div className="text-3xl">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-neutral-900">{value ?? '–'}</p>
        <p className="text-sm text-neutral-500">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export default function Dashboard() {
  const { user, isAdmin, isGestor, canManageUsers, isOperacional } = useAuth();
  const [stats,   setStats]   = useState(null);
  const [recent,  setRecent]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [trabResp] = await Promise.all([
        trabajosService.list({ limit: 5 }),
      ]);
      setRecent(trabResp.data || []);

      // Stats solo para admin/gestor
      if (canManageUsers()) {
        const [usersResp, vehResp, allTrab] = await Promise.all([
          usersService.list({ limit: 1 }),
          vehiclesService.list({ limit: 1 }),
          trabajosService.list({ limit: 1, estado: 'activo' }),
        ]);
        setStats({
          usuarios:  usersResp.pagination?.total || 0,
          vehiculos: vehResp.pagination?.total   || 0,
          activos:   allTrab.pagination?.total   || 0,
        });
      }
    } catch (err) {
      console.error('Error cargando dashboard:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Saludo */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">
          {saludo}, {user?.nombre} 👋
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Tarjetas de estadísticas (admin/gestor) */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Trabajos activos" value={stats.activos}  icon="🚑" to="/trabajos?estado=activo" />
          <StatCard label="Vehículos"        value={stats.vehiculos} icon="🚐" to="/vehiculos" />
          <StatCard label="Usuarios"         value={stats.usuarios}  icon="👥" to="/usuarios" />
        </div>
      )}

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link to="/mis-trabajos" className="card flex flex-col items-center gap-2 py-5 hover:shadow-md transition-shadow text-center">
          <span className="text-3xl">📋</span>
          <span className="text-sm font-medium text-neutral-700">Mis trabajos</span>
        </Link>
        <Link to="/trabajos" className="card flex flex-col items-center gap-2 py-5 hover:shadow-md transition-shadow text-center">
          <span className="text-3xl">📅</span>
          <span className="text-sm font-medium text-neutral-700">Calendario</span>
        </Link>
        {canManageUsers() && (
          <>
            <Link to="/vehiculos" className="card flex flex-col items-center gap-2 py-5 hover:shadow-md transition-shadow text-center">
              <span className="text-3xl">🚐</span>
              <span className="text-sm font-medium text-neutral-700">Vehículos</span>
            </Link>
            <Link to="/usuarios" className="card flex flex-col items-center gap-2 py-5 hover:shadow-md transition-shadow text-center">
              <span className="text-3xl">👥</span>
              <span className="text-sm font-medium text-neutral-700">Usuarios</span>
            </Link>
          </>
        )}
      </div>

      {/* Últimos trabajos */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-neutral-900">Últimos trabajos</h2>
          <Link to="/trabajos" className="text-primary-600 text-sm font-medium hover:underline">Ver todos</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-neutral-400 text-sm py-4 text-center">Sin trabajos recientes</p>
        ) : (
          <div className="space-y-2">
            {recent.map(t => (
              <Link
                key={t.id}
                to={`/trabajos/${t.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-neutral-50 transition-colors border border-neutral-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{t.nombre}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t.identificador} · {formatDateTime(t.fecha_inicio)}
                  </p>
                </div>
                <EstadoBadge estado={t.estado} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
