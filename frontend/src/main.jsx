import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

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
