import React from 'react';

export default function LoadingSpinner({ size = 'md', className = '', fullScreen = false }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };

  const spinner = (
    <div className={`${sizes[size]} spinner border-2 ${className}`} role="status" aria-label="Cargando" />
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white/80 z-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 spinner border-3" />
          <p className="text-sm text-neutral-500">Cargando...</p>
        </div>
      </div>
    );
  }

  return spinner;
}

export function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 spinner" />
        <p className="text-sm text-neutral-400">Cargando...</p>
      </div>
    </div>
  );
}
