import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall.js';

/**
 * variant="banner"  → bloque grande para la pantalla de login
 * variant="float"   → botón flotante cuando el usuario ya está dentro de la app
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
        <div className="w-full max-w-sm">
          <button
            onClick={handleClick}
            className="w-full flex items-center justify-center gap-3
                       bg-white text-primary-700 font-semibold
                       rounded-2xl px-6 py-4 text-base shadow-lg
                       hover:bg-primary-50 active:scale-95
                       transition-all duration-150 border-2 border-white/80"
          >
            <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {isIOS ? 'Instalar app en iPhone / iPad' : 'Instalar app en este dispositivo'}
          </button>
          <p className="text-center text-primary-200 text-xs mt-2">
            {isIOS
              ? 'Acceso directo sin navegador · Safari requerido'
              : 'Sin App Store · Se instala directamente'}
          </p>
        </div>
      ) : (
        <button
          onClick={handleClick}
          title={isIOS ? 'Instalar en iPhone/iPad' : 'Instalar app'}
          className="fixed bottom-20 right-4 z-50
                     flex items-center gap-2
                     bg-primary-600 hover:bg-primary-700 text-white
                     rounded-full shadow-xl px-4 py-3 text-sm font-semibold
                     active:scale-95 transition-all duration-150
                     ring-4 ring-primary-200"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Instalar app</span>
        </button>
      )}

      {/* Modal instrucciones iOS — aparece en la parte inferior como una sheet */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-10 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-5" />

            <h3 className="text-xl font-bold text-neutral-900 text-center mb-1">
              Instalar VAPSS
            </h3>
            <p className="text-sm text-neutral-500 text-center mb-6">
              Sigue estos pasos en Safari para añadir la app a tu pantalla de inicio
            </p>

            <ol className="space-y-4">
              <li className="flex items-center gap-4 p-3 bg-neutral-50 rounded-xl">
                <div className="w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-sm">1</div>
                <div>
                  <p className="font-medium text-neutral-800 text-sm">Pulsa el botón Compartir</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    El icono <span className="font-mono bg-neutral-200 px-1 rounded">⬆</span> en la barra inferior de Safari
                  </p>
                </div>
              </li>
              <li className="flex items-center gap-4 p-3 bg-neutral-50 rounded-xl">
                <div className="w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-sm">2</div>
                <div>
                  <p className="font-medium text-neutral-800 text-sm">Toca "Añadir a pantalla de inicio"</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Desplázate hacia abajo en el menú si no lo ves</p>
                </div>
              </li>
              <li className="flex items-center gap-4 p-3 bg-neutral-50 rounded-xl">
                <div className="w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-sm">3</div>
                <div>
                  <p className="font-medium text-neutral-800 text-sm">Pulsa "Añadir" arriba a la derecha</p>
                  <p className="text-xs text-neutral-500 mt-0.5">La app aparecerá en tu pantalla de inicio</p>
                </div>
              </li>
            </ol>

            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-5 text-center">
              Solo funciona desde <strong>Safari</strong>. Si usas Chrome u otro navegador, cámbialo a Safari primero.
            </p>

            <button
              onClick={() => setShowModal(false)}
              className="mt-5 w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl py-3 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
