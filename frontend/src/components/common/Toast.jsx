import React from 'react';
import { useNotification } from '../../context/NotificationContext.jsx';

// El tipo se transmite con el color de fondo, sin icono.
const colors = {
  success: 'bg-ok-600',
  error:   'bg-bad-600',
  warning: 'bg-warn-600',
  info:    'bg-primary-600',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useNotification();

  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${colors[toast.type]} text-white px-4 py-3 rounded-lg shadow-lg
                      flex items-start gap-3 pointer-events-auto animate-slide-up
                      w-full max-w-sm`}
        >
          <span className="flex-1 text-sm leading-relaxed">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 text-white/70 hover:text-white text-lg leading-none ml-1"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
