import { useState, useEffect } from 'react';

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(
    // Leer el prompt si ya fue capturado antes de que React montara
    () => window.__pwaInstallPrompt || null
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS,       setIsIOS]       = useState(false);
  const [isMobile,    setIsMobile]    = useState(false);

  useEffect(() => {
    const ios    = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    const mobile = ios || /android/i.test(navigator.userAgent);
    setIsIOS(ios);
    setIsMobile(mobile);

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(standalone);

    // Si el prompt llegó tarde (después de que React montó)
    const onPrompt = (e) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      setInstallPrompt(e);
    };

    // Si el prompt ya estaba capturado pero aún no lo teníamos en state
    const onPromptReady = () => {
      if (window.__pwaInstallPrompt) setInstallPrompt(window.__pwaInstallPrompt);
    };

    const onInstalled = () => { setIsInstalled(true); setInstallPrompt(null); window.__pwaInstallPrompt = null; };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('pwaPromptReady',      onPromptReady);
    window.addEventListener('appinstalled',        onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('pwaPromptReady',      onPromptReady);
      window.removeEventListener('appinstalled',        onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { setInstallPrompt(null); window.__pwaInstallPrompt = null; }
    return outcome === 'accepted';
  };

  const canInstall  = !isInstalled && (installPrompt !== null || isIOS || isMobile);
  const promptReady = installPrompt !== null;

  return { canInstall, install, isIOS, isMobile, promptReady };
}
