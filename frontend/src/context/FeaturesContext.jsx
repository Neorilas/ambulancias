import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { featuresService } from '../services/features.service.js';
import { useAuth } from './AuthContext.jsx';

const FeaturesContext = createContext(null);

export function FeaturesProvider({ children }) {
  const { isAuthenticated, isSuperAdmin } = useAuth();
  const [features, setFeatures] = useState([]);
  // ¿Ya se han cargado los flags CON sesión? `loading` se deriva de esto y no
  // se guarda aparte: entre el render en que llega la sesión y el efecto que
  // lanza la carga hay un render intermedio, y en él un `loading` guardado
  // seguía en false (de cuando no había sesión). ProtectedRoute decidía ahí
  // con la lista vacía y echaba a /mis-asignaciones a quien recargaba o abría
  // un enlace a una pantalla con flag.
  const [cargadoConSesion, setCargadoConSesion] = useState(false);
  const loading = isAuthenticated && !cargadoConSesion;

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setFeatures([]);
      setCargadoConSesion(false);
      return;
    }
    try {
      const active = await featuresService.getActive();
      setFeatures(active);
    } catch {
      setFeatures([]);
    } finally {
      setCargadoConSesion(true);
    }
  }, [isAuthenticated]);

  useEffect(() => { load(); }, [load]);

  const isFeatureEnabled = useCallback((key) => {
    if (isSuperAdmin()) return true;
    return features.includes(key);
  }, [features, isSuperAdmin]);

  const reload = useCallback(() => load(), [load]);

  return (
    <FeaturesContext.Provider value={{ features, loading, isFeatureEnabled, reload }}>
      {children}
    </FeaturesContext.Provider>
  );
}

export const useFeatures = () => {
  const ctx = useContext(FeaturesContext);
  if (!ctx) throw new Error('useFeatures debe usarse dentro de <FeaturesProvider>');
  return ctx;
};
