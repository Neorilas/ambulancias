import React from 'react';
import { useNotification } from '../../context/NotificationContext.jsx';

const icons = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

const colors = {
  success: 'bg-green-600',
  error:   'bg-red-600',
  warning: 'bg-yellow-500',
  info:    'bg-blue-600',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useNotification();

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${colors[toast.type]} text-white px-4 py-3 rounded-lg shadow-lg
                      flex items-start gap-3 pointer-events-auto animate-slide-up`}
        >
          <span className="text-lg font-bold mt-0.5 flex-shrink-0">{icons[toast.type]}</span>
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
