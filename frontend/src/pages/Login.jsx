import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotification } from '../context/NotificationContext.jsx';
import InstallPWAButton from '../components/common/InstallPWAButton.jsx';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass,  setShowPass]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [errors,    setErrors]    = useState({});

  const { login, isAuthenticated } = useAuth();
  const { notify }  = useNotification();
  const navigate    = useNavigate();
  const location    = useLocation();
  const from        = location.state?.from?.pathname || '/dashboard';

  // Si ya autenticado, redirigir
  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated]);

  const validate = () => {
    const e = {};
    if (!username.trim()) e.username = 'Username requerido';
    if (!password)        e.password = 'Contraseña requerida';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate() || loading) return;

    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err.response?.data?.message || 'Error al iniciar sesión';
      notify.error(msg);

      if (err.response?.status === 429) {
        setErrors({ general: msg });
      } else {
        setErrors({ general: 'Credenciales incorrectas' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-primary-600 p-4">
      {/* Logo / Hero */}
      <div className="text-center mb-8">
        <img
          src="https://vapss.net/wp-content/uploads/2024/12/cropped-cropped-vapss-banner-2.webp"
          alt="VAPSS"
          className="h-16 mx-auto mb-4 object-contain drop-shadow-lg"
          onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }}
        />
        <h1 className="text-2xl font-bold text-white hidden">VAPSS</h1>
        <p className="text-primary-200 text-sm mt-1">Sistema interno de operaciones · v1.0</p>
      </div>

      {/* Card de login */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-slide-up">
        <h2 className="text-xl font-semibold text-neutral-900 mb-6 text-center">
          Iniciar sesión
        </h2>

        {errors.general && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Username */}
          <div>
            <label className="label">Usuario</label>
            <input
              type="text"
              className={`input ${errors.username ? 'input-error' : ''}`}
              placeholder="Introduce tu usuario"
              value={username}
              onChange={e => { setUsername(e.target.value); setErrors(v => ({...v, username: ''})); }}
              autoCapitalize="none"
              autoComplete="username"
              autoFocus
              disabled={loading}
            />
            {errors.username && <p className="field-error">{errors.username}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="label">Contraseña</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className={`input pr-10 ${errors.password ? 'input-error' : ''}`}
                placeholder="Introduce tu contraseña"
                value={password}
                onChange={e => { setPassword(e.target.value); setErrors(v => ({...v, password: ''})); }}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                tabIndex={-1}
              >
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
            {errors.password && <p className="field-error">{errors.password}</p>}
          </div>

          <button
            type="submit"
            className="btn-primary w-full py-3 text-base mt-2"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 spinner" />
                Iniciando sesión...
              </span>
            ) : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-xs text-neutral-400 text-center">
          Sistema de uso exclusivo para personal autorizado
        </p>
      </div>

      {/* PWA install */}
      <div className="mt-6">
        <InstallPWAButton variant="banner" />
      </div>
    </div>
  );
}
