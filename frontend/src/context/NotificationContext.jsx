import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const NotificationContext = createContext(null);

let toastId = 0;

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
    return id;
  }, [removeToast]);

  const notify = useMemo(() => ({
    success: (msg, dur) => addToast(msg, 'success', dur),
    error:   (msg, dur) => addToast(msg, 'error',   dur || 6000),
    info:    (msg, dur) => addToast(msg, 'info',    dur),
    warning: (msg, dur) => addToast(msg, 'warning', dur),
  }), [addToast]);

  const value = useMemo(() => ({ toasts, notify, removeToast }), [toasts, notify, removeToast]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotification = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification debe usarse dentro de <NotificationProvider>');
  return ctx;
};
