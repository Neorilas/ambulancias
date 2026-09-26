import React, { useState, useEffect } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { usersService } from '../../services/users.service.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { ROLES, labelRol } from '../../utils/constants.js';

export default function UserForm({ user, onSaved, onClose }) {
  const isEdit = !!user;
  const { user: yo, isAdmin, isGestor, isSuperAdmin } = useAuth();
  const { notify } = useNotification();

  const [roles,     setRoles]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [errors,    setErrors]    = useState({});

  const [form, setForm] = useState({
    username:  user?.username  || '',
    password:  '',
    nombre:    user?.nombre    || '',
    apellidos: user?.apellidos || '',
    dni:       user?.dni       || '',
    email:     user?.email     || '',
    telefono:  user?.telefono  || '',
    direccion: user?.direccion || '',
    activo:    user?.activo    !== undefined ? !!user.activo : true,
    roles:     user?.roles     || [],
  });

  useEffect(() => {
    usersService.listRoles().then(setRoles).catch(console.error);
  }, []);

  const set = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => ({ ...e, [field]: '' }));
  };

  // Mismas reglas que el backend (users.controller.js): el rol superadmin solo
  // lo reparte otro superadmin, y un gestor solo reparte roles por debajo del
  // suyo (ni gestor ni administrador). Al gestor el backend ya le manda solo
  // esos roles en /users/roles; esto es la red de seguridad de la pantalla.
  const soloGestor = isGestor() && !isAdmin() && !isSuperAdmin();
  // Un gestor que se edita a sí mismo no toca ninguno de sus roles.
  const esMiFicha  = isEdit && user?.id === yo?.id;
  const rolBloqueado = (roleName) => {
    if (roleName === ROLES.SUPERADMIN)    return !isSuperAdmin();
    if (roleName === ROLES.ADMINISTRADOR || roleName === ROLES.GESTOR) return soloGestor;
    if (soloGestor && esMiFicha) return true;
    return false;
  };

  const toggleRole = (roleName) => {
    if (rolBloqueado(roleName)) return;

    setForm(f => ({
      ...f,
      roles: f.roles.includes(roleName)
        ? f.roles.filter(r => r !== roleName)
        : [...f.roles, roleName],
    }));
  };

  const validate = () => {
    const e = {};
    if (!isEdit && !form.username.trim()) e.username = 'Username requerido';
    if (!isEdit && !form.password.trim()) e.password = 'Contraseña requerida';
    if (!form.nombre.trim())    e.nombre    = 'Nombre requerido';
    if (!form.apellidos.trim()) e.apellidos = 'Apellidos requerido';
    if (!form.dni.trim())       e.dni       = 'DNI requerido';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        nombre:    form.nombre,
        apellidos: form.apellidos,
        dni:       form.dni,
        email:     form.email || null,
        telefono:  form.telefono || null,
        direccion: form.direccion || null,
        roles:     form.roles,
      };

      if (!isEdit) {
        payload.username = form.username;
        payload.password = form.password;
      } else {
        if (form.password) payload.password = form.password;
        if (isAdmin()) payload.activo = form.activo;
      }

      if (isEdit) {
        await usersService.update(user.id, payload);
        notify.success('Usuario actualizado correctamente');
      } else {
        await usersService.create(payload);
        notify.success('Usuario creado correctamente');
      }
      onSaved();
    } catch (err) {
      const msg = err.response?.data?.message || 'Error al guardar';
      const serverErrors = err.response?.data?.errors;
      if (serverErrors) {
        const errMap = {};
        serverErrors.forEach(e => { errMap[e.field] = e.message; });
        setErrors(errMap);
      } else {
        notify.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? `Editar: ${user.username}` : 'Nuevo usuario'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Guardando...' : (isEdit ? 'Actualizar' : 'Crear usuario')}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {!isEdit && (
            <div>
              <label className="label">Username <span className="text-bad-500">*</span></label>
              <input className={`input ${errors.username ? 'input-error' : ''}`}
                value={form.username} onChange={set('username')}
                autoCapitalize="none" autoComplete="off" />
              {errors.username && <p className="field-error">{errors.username}</p>}
            </div>
          )}
          <div>
            <label className="label">Nombre <span className="text-bad-500">*</span></label>
            <input className={`input ${errors.nombre ? 'input-error' : ''}`}
              value={form.nombre} onChange={set('nombre')} />
            {errors.nombre && <p className="field-error">{errors.nombre}</p>}
          </div>
          <div>
            <label className="label">Apellidos <span className="text-bad-500">*</span></label>
            <input className={`input ${errors.apellidos ? 'input-error' : ''}`}
              value={form.apellidos} onChange={set('apellidos')} />
            {errors.apellidos && <p className="field-error">{errors.apellidos}</p>}
          </div>
          <div>
            <label className="label">DNI <span className="text-bad-500">*</span></label>
            <input className={`input ${errors.dni ? 'input-error' : ''}`}
              value={form.dni} onChange={set('dni')} />
            {errors.dni && <p className="field-error">{errors.dni}</p>}
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className={`input ${errors.email ? 'input-error' : ''}`}
              value={form.email} onChange={set('email')} />
            {errors.email && <p className="field-error">{errors.email}</p>}
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input type="tel" className={`input ${errors.telefono ? 'input-error' : ''}`}
              value={form.telefono} onChange={set('telefono')} />
            {errors.telefono && <p className="field-error">{errors.telefono}</p>}
          </div>
        </div>

        <div>
          <label className="label">Dirección</label>
          <input className="input" value={form.direccion} onChange={set('direccion')} />
        </div>

        {/* Cambiar la contraseña de otro es de administrador (el backend la
            ignora si la manda un gestor); en el alta sí la pone el gestor. */}
        {(!isEdit || !soloGestor) && (
          <div>
            <label className="label">
              {isEdit ? 'Nueva contraseña (dejar en blanco para no cambiar)' : 'Contraseña'}
              {!isEdit && <span className="text-bad-500 ml-1">*</span>}
            </label>
            <input type="password" className={`input ${errors.password ? 'input-error' : ''}`}
              value={form.password} onChange={set('password')} />
            {errors.password && <p className="field-error">{errors.password}</p>}
            <p className="text-xs text-neutral-400 mt-1">
              Mínimo 10 caracteres y al menos dos tipos (minúsculas, mayúsculas, números o símbolos)
            </p>
          </div>
        )}

        {/* Roles */}
        <div>
          <label className="label">Roles</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {roles.map(r => {
              const selected = form.roles.includes(r.nombre);
              const disabled = rolBloqueado(r.nombre);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.nombre)}
                  disabled={disabled}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                    ${selected
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-neutral-600 border-neutral-300 hover:border-primary-400'
                    }
                    ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {labelRol(r.nombre)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Estado activo (solo admin) */}
        {isAdmin() && isEdit && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              checked={form.activo}
              onChange={set('activo')}
            />
            <span className="text-sm font-medium text-neutral-700">Usuario activo</span>
          </label>
        )}
      </form>
    </Modal>
  );
}
