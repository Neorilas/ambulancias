import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall.js';

/**
 * variant="banner"  → bloque grande para la pantalla de login
 * variant="float"   → botón flotante cuando el usuario ya está dentro de la app
 */
export default function InstallPWAButton({ variant = 'banner' }) {
  const { canInstall, install, isIOS, promptReady } = usePWAInstall();
  const [showModal,   setShowModal]   = useState(false);
  const [showHTTPMsg, setShowHTTPMsg] = useState(false);

  if (!canInstall) return null;

  const handleClick = () => {
    if (isIOS) {
      setShowModal(true);
    } else if (promptReady) {
      install();
    } else {
      // Android / Desktop sobre HTTP local — no hay prompt disponible
      setShowHTTPMsg(true);
    }
  };

  if (variant === 'float') {
    return (
      <>
        <button
          onClick={handleClick}
          className="fixed bottom-20 right-4 z-50
                     flex items-center gap-2
                     bg-primary-600 hover:bg-primary-700 text-white
                     rounded-full shadow-xl px-4 py-3 text-sm font-semibold
                     active:scale-95 transition-all duration-150
                     ring-4 ring-primary-200"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Instalar app</span>
        </button>
        {renderModals()}
      </>
    );
  }

  return (
    <>
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {isIOS ? 'Instalar app en iPhone / iPad' : 'Instalar app en este dispositivo'}
        </button>
        <p className="text-center text-primary-200 text-xs mt-2">
          {isIOS ? 'Solo desde Safari · Sin App Store' : 'Acceso directo · Sin App Store'}
        </p>
      </div>
      {renderModals()}
    </>
  );

  function renderModals() {
    return (
      <>
        {/* Modal cuando el navegador aún no ha ofrecido el prompt de instalación */}
        {showHTTPMsg && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
               onClick={() => setShowHTTPMsg(false)}>
            <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-10 shadow-2xl"
                 onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-5" />
              <h3 className="text-lg font-bold text-neutral-900 text-center mb-2">Preparando instalación…</h3>
              <p className="text-sm text-neutral-600 text-center mb-4">
                El navegador todavía no ha habilitado el instalador.<br/>
                Prueba estos pasos:
              </p>
              <ol className="space-y-3 mb-5">
                <li className="flex items-start gap-3 p-3 bg-neutral-50 rounded-xl">
                  <span className="w-6 h-6 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-xs">1</span>
                  <p className="text-sm text-neutral-700">Recarga la página y espera unos segundos</p>
                </li>
                <li className="flex items-start gap-3 p-3 bg-neutral-50 rounded-xl">
                  <span className="w-6 h-6 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-xs">2</span>
                  <p className="text-sm text-neutral-700">Cierra la pestaña, vuelve a abrir la app y pulsa el botón de nuevo</p>
                </li>
                <li className="flex items-start gap-3 p-3 bg-neutral-50 rounded-xl">
                  <span className="w-6 h-6 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-xs">3</span>
                  <p className="text-sm text-neutral-700">En Chrome: menú ⋮ → <strong>Añadir a pantalla de inicio</strong></p>
                </li>
              </ol>
              <button onClick={() => setShowHTTPMsg(false)}
                      className="w-full bg-primary-600 text-white font-semibold rounded-xl py-3">
                Entendido
              </button>
            </div>
          </div>
        )}

        {/* Modal instrucciones iOS */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
               onClick={() => setShowModal(false)}>
            <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-10 shadow-2xl"
                 onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mb-5" />
              <h3 className="text-xl font-bold text-neutral-900 text-center mb-1">Instalar VAPSS</h3>
              <p className="text-sm text-neutral-500 text-center mb-6">Sigue estos pasos en Safari</p>
              <ol className="space-y-4">
                <li className="flex items-center gap-4 p-3 bg-neutral-50 rounded-xl">
                  <div className="w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-sm">1</div>
                  <div>
                    <p className="font-medium text-neutral-800 text-sm">Pulsa el botón Compartir</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Icono <span className="font-mono bg-neutral-200 px-1 rounded">⬆</span> en la barra inferior de Safari</p>
                  </div>
                </li>
                <li className="flex items-center gap-4 p-3 bg-neutral-50 rounded-xl">
                  <div className="w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold shrink-0 text-sm">2</div>
                  <div>
                    <p className="font-medium text-neutral-800 text-sm">Toca "Añadir a pantalla de inicio"</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Desplázate hacia abajo si no lo ves</p>
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
                Solo funciona desde <strong>Safari</strong>. Si usas Chrome, cámbialo a Safari primero.
              </p>
              <button onClick={() => setShowModal(false)}
                      className="mt-5 w-full bg-primary-600 text-white font-semibold rounded-xl py-3">
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }
}
