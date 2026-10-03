import React, { useState, useEffect, useCallback } from 'react';
import { useDebounce } from '../../hooks/useDebounce.js';
import { usersService } from '../../services/users.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { ActiveBadge, RolBadge } from '../../components/common/StatusBadge.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import UserForm from './UserForm.jsx';
import ResetPasswordModal from './ResetPasswordModal.jsx';
import { ROLES, ROL_LABELS, labelRol } from '../../utils/constants.js';

// Valor del filtro «Sin rol». Mismo literal que ROL_FILTRO_NINGUNO en
// backend (users.controller → listUsers); ningún rol real puede llamarse así.
const SIN_ROL = 'sin-rol';

/**
 * ¿A este usuario se le mandan avisos push?
 *
 * Mismo criterio que `suscripcionesDeAdmins` en el backend
 * (services/push.service.js): permiso de gestión o rol de mando. Si allí
 * cambia, aquí también — esta columna solo sirve si dice la verdad.
 */
const RECIBE_AVISOS = ['administrador', 'gestor', 'superadmin'];
const recibeAvisos = (u) => (u.roles || []).some(r => RECIBE_AVISOS.includes(r));

/** Cuántos dispositivos tiene este usuario con los avisos puestos. */
function AvisosCelda({ user }) {
  if (!recibeAvisos(user)) {
    return <span className="text-neutral-300 text-xs">&mdash;</span>;
  }
  const n = Number(user.dispositivos_push) || 0;
  if (n === 0) {
    return <span className="badge-yellow" title="No le sonará ningún aviso">Sin avisos</span>;
  }
  return (
    <span className="badge-green" title="Dispositivos con los avisos activados">
      {n} {n === 1 ? 'dispositivo' : 'dispositivos'}
    </span>
  );
}

export default function UserList() {
  const { user: yo, isAdmin, isSuperAdmin, isGestor, canDeleteAny, impersonar } = useAuth();
  const { notify } = useNotification();

  const canResetPassword = isAdmin() || isSuperAdmin();
  // El gestor da de alta y edita usuarios, pero solo por debajo de su rol: a
  // gestores y administradores no los toca (salvo su propia ficha). La regla
  // de verdad está en el backend (users.controller → motivoGestor).
  const soloGestor = isGestor() && !isAdmin() && !isSuperAdmin();
  const puedeCrear = isAdmin() || isSuperAdmin() || isGestor();
  const ROLES_MANDO = [ROLES.SUPERADMIN, ROLES.ADMINISTRADOR, ROLES.GESTOR];
  const puedeEditar = (u) => !soloGestor || u.id === yo?.id
    || !(u.roles || []).some(r => ROLES_MANDO.includes(r));

  const [users,      setUsers]      = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [rolFiltro,  setRolFiltro]  = useState('');
  // Opciones del filtro: los roles conocidos más los creados desde la app.
  // GET /users/roles al gestor solo le da los que puede repartir, por eso se
  // parte de ROL_LABELS: filtrar por administrador también le sirve a él.
  const [rolesFiltro, setRolesFiltro] = useState(Object.keys(ROL_LABELS));
  const [loading,    setLoading]    = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [editUser,   setEditUser]   = useState(null);
  const [resetUser,  setResetUser]  = useState(null);
  const [impersonandoId, setImpersonandoId] = useState(null);

  // «Ver como»: solo superadmin, a cualquiera activo salvo otro superadmin y
  // uno mismo (el backend lo vuelve a comprobar en /admin/impersonar).
  const puedeVerComo = (u) => isSuperAdmin() && u.id !== yo?.id && u.activo
    && !(u.roles || []).includes(ROLES.SUPERADMIN);

  const verComo = async (u) => {
    setImpersonandoId(u.id);
    try {
      await impersonar(u.id);
    } catch (err) {
      notify.error(err.response?.data?.message || 'No se ha podido entrar como ese usuario');
      setImpersonandoId(null);
    }
  };
  const [deleteId,   setDeleteId]   = useState(null);
  const [deleting,   setDeleting]   = useState(false);

  // El "debounce" de antes sólo retrasaba el reset de página: la petición
  // seguía saliendo con cada tecla porque `search` estaba en las dependencias.
  const busqueda = useDebounce(search, 400);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await usersService.list({
        page, search: busqueda || undefined, role: rolFiltro || undefined, limit: 15,
      });
      setUsers(resp.data || []);
      setPagination(resp.pagination);
    } catch (err) {
      notify.error('Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }, [page, busqueda, rolFiltro]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => { setPage(1); }, [busqueda]);

  useEffect(() => {
    usersService.listRoles()
      .then(roles => setRolesFiltro(prev => [...new Set([...prev, ...roles.map(r => r.nombre)])]))
      .catch(() => {}); // sin la lista de la BD quedan los roles conocidos
  }, []);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await usersService.delete(deleteId);
      notify.success('Usuario eliminado');
      setDeleteId(null);
      loadUsers();
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al eliminar usuario');
    } finally {
      setDeleting(false);
    }
  };

  const handleFormSaved = () => {
    setShowForm(false);
    setEditUser(null);
    loadUsers();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-[19px] font-semibold text-neutral-900">Usuarios</h1>
          <p className="text-neutral-500 text-sm">
            {pagination?.total ?? 0}{' '}
            {(pagination?.total ?? 0) === 1 ? 'usuario' : 'usuarios'}{' '}
            {busqueda || rolFiltro
              ? ((pagination?.total ?? 0) === 1 ? 'encontrado' : 'encontrados')
              : ((pagination?.total ?? 0) === 1 ? 'registrado' : 'registrados')}
          </p>
        </div>
        {puedeCrear && (
          <button onClick={() => { setEditUser(null); setShowForm(true); }} className="btn-primary">
            + Nuevo usuario
          </button>
        )}
      </div>

      {/* Buscador y filtro por rol */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="search"
          className="input sm:flex-1"
          placeholder="Buscar por nombre, username, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="input sm:w-52"
          aria-label="Filtrar por rol"
          value={rolFiltro}
          // Página y filtro en el mismo render: con el setPage(1) en un efecto
          // aparte salían dos peticiones (página vieja y página 1) y ganaba la
          // última en llegar, que podía ser la vacía.
          onChange={e => { setRolFiltro(e.target.value); setPage(1); }}
        >
          <option value="">Todos los roles</option>
          {rolesFiltro.map(r => <option key={r} value={r}>{labelRol(r)}</option>)}
          <option value={SIN_ROL}>Sin rol</option>
        </select>
      </div>

      {/* Tabla */}
      {loading ? <PageLoading /> : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th className="hidden sm:table-cell">DNI</th>
                  <th>Roles</th>
                  <th className="hidden md:table-cell">Avisos</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-neutral-400">Sin resultados</td></tr>
                ) : users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div>
                        <p className="font-medium text-neutral-900">{u.nombre} {u.apellidos}</p>
                        <p className="text-xs text-neutral-500">@{u.username}</p>
                        {u.email && <p className="text-xs text-neutral-400">{u.email}</p>}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell text-neutral-500 text-sm">{u.dni}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(u.roles || []).map(r => <RolBadge key={r} rol={r} />)}
                      </div>
                    </td>
                    <td className="hidden md:table-cell"><AvisosCelda user={u} /></td>
                    <td><ActiveBadge activo={u.activo} /></td>
                    <td>
                      <div className="flex justify-end gap-2">
                        {puedeVerComo(u) && (
                          <button
                            onClick={() => verComo(u)}
                            disabled={impersonandoId !== null}
                            className="btn-ghost text-xs px-2 py-1"
                            title="Ver y usar la app como este usuario"
                          >
                            {impersonandoId === u.id ? 'Entrando…' : 'Ver como'}
                          </button>
                        )}
                        {puedeEditar(u) && (
                          <button
                            onClick={() => { setEditUser(u); setShowForm(true); }}
                            className="btn-ghost text-xs px-2 py-1"
                          >
                            Editar
                          </button>
                        )}
                        {canResetPassword && (
                          <button
                            onClick={() => setResetUser(u)}
                            className="btn-ghost text-xs px-2 py-1 text-warn-600 hover:bg-warn-50"
                          >
                            Resetear clave
                          </button>
                        )}
                        {canDeleteAny() && (
                          <button
                            onClick={() => setDeleteId(u.id)}
                            className="btn-ghost text-xs px-2 py-1 text-bad-600 hover:bg-bad-50"
                          >
                            Eliminar
                          </button>
                        )}
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
              <button
                className="btn-secondary text-sm"
                onClick={() => setPage(p => p - 1)}
                disabled={!pagination.hasPrev}
              >‹ Anterior</button>
              <span className="text-sm text-neutral-600">
                {page} / {pagination.totalPages}
              </span>
              <button
                className="btn-secondary text-sm"
                onClick={() => setPage(p => p + 1)}
                disabled={!pagination.hasNext}
              >Siguiente ›</button>
            </div>
          )}
        </>
      )}

      {/* Modal de formulario */}
      {showForm && (
        <UserForm
          user={editUser}
          onSaved={handleFormSaved}
          onClose={() => { setShowForm(false); setEditUser(null); }}
        />
      )}

      {/* Modal de reseteo de contraseña */}
      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
        />
      )}

      {/* Confirmación de borrado */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Eliminar usuario"
        message="¿Seguro que deseas eliminar este usuario? Se realizará un soft delete."
        confirmText="Eliminar"
        danger
        loading={deleting}
      />
    </div>
  );
}
