import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { featuresService } from '../services/features.service.js';
import { useAuth } from './AuthContext.jsx';

const FeaturesContext = createContext(null);

export function FeaturesProvider({ children }) {
  const { isAuthenticated, isSuperAdmin } = useAuth();
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setFeatures([]);
      setLoading(false);
      return;
    }
    try {
      const active = await featuresService.getActive();
      setFeatures(active);
    } catch {
      setFeatures([]);
    } finally {
      setLoading(false);
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
