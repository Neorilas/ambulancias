import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { instalarReporteDeErrores } from './utils/reporteErrores.js';
import { aplicarTema, leerTema } from './utils/tema.js';

// Errores de JS, de red y de proxy → panel Errores del superadmin. Antes de
// montar React, para no perder un fallo del primer render.
instalarReporteDeErrores();

// Tema guardado en este dispositivo, antes del primer render: mientras carga
// se ve el splash, así que no hay parpadeo del tema claro.
aplicarTema(leerTema());

// Capturar beforeinstallprompt ANTES de que React monte.
// El evento puede dispararse antes de que useEffect registre su listener.
window.__pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
  // Notificar a cualquier listener que ya esté activo
  window.dispatchEvent(new Event('pwaPromptReady'));
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
