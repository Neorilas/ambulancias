import React, { useState } from 'react';
import Modal from '../../components/common/Modal.jsx';
import { usersService } from '../../services/users.service.js';
import { useNotification } from '../../context/NotificationContext.jsx';

export default function ResetPasswordModal({ user, onClose }) {
  const { notify } = useNotification();

  const [mode,     setMode]     = useState('auto');   // 'auto' | 'manual'
  const [manual,   setManual]   = useState('');
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [result,   setResult]   = useState(null);     // contraseña en claro devuelta
  const [copied,   setCopied]   = useState(false);

  const handleReset = async () => {
    setError('');
    if (mode === 'manual' && manual.trim().length < 8) {
      setError('Mínimo 8 caracteres');
      return;
    }
    setSaving(true);
    try {
      const payload = mode === 'manual' ? { password: manual } : {};
      const data = await usersService.resetPassword(user.id, payload);
      setResult(data.password);
    } catch (err) {
      notify.error(err.response?.data?.message || 'Error al resetear la contraseña');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error('No se pudo copiar al portapapeles');
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Resetear contraseña: ${user.username}`}
      size="md"
      footer={
        result ? (
          <button className="btn-primary" onClick={onClose}>Hecho</button>
        ) : (
          <>
            <button className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={handleReset} disabled={saving}>
              {saving ? 'Reseteando...' : 'Resetear contraseña'}
            </button>
          </>
        )
      }
    >
      {result ? (
        /* ── Resultado: mostrar la nueva contraseña ── */
        <div className="space-y-4">
          <div className="rounded-xl bg-green-50 border border-green-200 p-4">
            <p className="text-sm text-green-800 font-medium mb-2">
              Contraseña reseteada para <span className="font-semibold">{user.nombre} {user.apellidos}</span>
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-white rounded-lg border border-green-300 font-mono text-base tracking-wide break-all select-all">
                {result}
              </code>
              <button
                onClick={handleCopy}
                className="btn-secondary text-sm whitespace-nowrap px-3 py-2"
              >
                {copied ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
            ⚠️ Anótala y comunícasela al usuario ahora. No se podrá volver a mostrar.
            Las sesiones activas se han cerrado: deberá iniciar sesión con esta contraseña.
          </p>
        </div>
      ) : (
        /* ── Selección de modo ── */
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Se asignará una nueva contraseña a <span className="font-medium text-neutral-900">{user.nombre} {user.apellidos}</span> (@{user.username})
            y se cerrarán sus sesiones activas.
          </p>

          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-neutral-200 hover:border-primary-300 transition-colors">
              <input
                type="radio"
                name="reset-mode"
                checked={mode === 'auto'}
                onChange={() => { setMode('auto'); setError(''); }}
                className="mt-0.5 text-primary-600 focus:ring-primary-500"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-800">Generar automáticamente</span>
                <span className="block text-xs text-neutral-500">Crea una contraseña segura aleatoria (recomendado).</span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-neutral-200 hover:border-primary-300 transition-colors">
              <input
                type="radio"
                name="reset-mode"
                checked={mode === 'manual'}
                onChange={() => { setMode('manual'); setError(''); }}
                className="mt-0.5 text-primary-600 focus:ring-primary-500"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-neutral-800">Establecer manualmente</span>
                <span className="block text-xs text-neutral-500">Escribe tú la nueva contraseña.</span>
              </span>
            </label>
          </div>

          {mode === 'manual' && (
            <div>
              <input
                type="text"
                autoComplete="off"
                className={`input ${error ? 'input-error' : ''}`}
                placeholder="Nueva contraseña (mín. 8 caracteres)"
                value={manual}
                onChange={e => { setManual(e.target.value); setError(''); }}
              />
              {error && <p className="field-error">{error}</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
