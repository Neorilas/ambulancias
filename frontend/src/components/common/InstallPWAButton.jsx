import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall.js';

/**
 * variant="banner"  → botón grande para la pantalla de login
 * variant="float"   → botón flotante pequeño para el layout
 */
export default function InstallPWAButton({ variant = 'banner' }) {
  const { canInstall, install, isIOS } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (!canInstall) return null;

  const handleClick = () => {
    if (isIOS) setShowModal(true);
    else install();
  };

  return (
    <>
      {variant === 'banner' ? (
        <button
          onClick={handleClick}
          className="flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white
                     border border-white/30 rounded-xl px-5 py-3 text-sm font-medium
                     transition-colors backdrop-blur-sm"
        >
          <span className="text-xl">📲</span>
          Instalar app en este dispositivo
        </button>
      ) : (
        <button
          onClick={handleClick}
          title="Instalar app"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2
                     bg-primary-600 hover:bg-primary-700 text-white
                     rounded-full shadow-lg px-4 py-3 text-sm font-medium
                     transition-colors"
        >
          <span className="text-lg">📲</span>
          <span className="hidden sm:inline">Instalar app</span>
        </button>
      )}

      {/* Modal instrucciones iOS */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm mb-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-neutral-900 mb-4 text-center">
              Instalar en iPhone / iPad
            </h3>
            <ol className="space-y-3 text-sm text-neutral-700">
              <li className="flex items-start gap-3">
                <span className="text-2xl leading-none">1️⃣</span>
                <span>Pulsa el botón <strong>Compartir</strong> <span className="inline-block border border-neutral-300 rounded px-1">⬆</span> en la barra de Safari</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-2xl leading-none">2️⃣</span>
                <span>Desplázate hacia abajo y pulsa <strong>"Añadir a pantalla de inicio"</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-2xl leading-none">3️⃣</span>
                <span>Pulsa <strong>Añadir</strong> en la esquina superior derecha</span>
              </li>
            </ol>
            <p className="mt-4 text-xs text-neutral-400 text-center">
              Solo funciona desde Safari
            </p>
            <button
              onClick={() => setShowModal(false)}
              className="mt-5 w-full btn-primary py-2"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
