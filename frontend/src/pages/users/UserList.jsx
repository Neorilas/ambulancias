import React, { useState, useEffect, useCallback } from 'react';
import { usersService } from '../../services/users.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { ActiveBadge, RolBadge } from '../../components/common/StatusBadge.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { PageLoading } from '../../components/common/LoadingSpinner.jsx';
import UserForm from './UserForm.jsx';

export default function UserList() {
  const { isAdmin, canDeleteAny } = useAuth();
  const { notify } = useNotification();

  const [users,      setUsers]      = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [editUser,   setEditUser]   = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);
  const [deleting,   setDeleting]   = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await usersService.list({ page, search: search || undefined, limit: 15 });
      setUsers(resp.data || []);
      setPagination(resp.pagination);
    } catch (err) {
      notify.error('Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Buscar con debounce
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); }, 500);
    return () => clearTimeout(t);
  }, [search]);

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
          <h1 className="text-xl font-bold text-neutral-900">Usuarios</h1>
          <p className="text-neutral-500 text-sm">{pagination?.total ?? 0} usuarios registrados</p>
        </div>
        {isAdmin() && (
          <button onClick={() => { setEditUser(null); setShowForm(true); }} className="btn-primary">
            + Nuevo usuario
          </button>
        )}
      </div>

      {/* Buscador */}
      <input
        type="search"
        className="input"
        placeholder="Buscar por nombre, username, email..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Tabla */}
      {loading ? <PageLoading /> : (
        <>
          <div className="table-container card p-0 overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th className="hidden sm:table-cell">DNI</th>
                  <th>Roles</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-neutral-400">Sin resultados</td></tr>
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
                    <td><ActiveBadge activo={u.activo} /></td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => { setEditUser(u); setShowForm(true); }}
                          className="btn-ghost text-xs px-2 py-1"
                        >
                          Editar
                        </button>
                        {canDeleteAny() && (
                          <button
                            onClick={() => setDeleteId(u.id)}
                            className="btn-ghost text-xs px-2 py-1 text-red-600 hover:bg-red-50"
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
