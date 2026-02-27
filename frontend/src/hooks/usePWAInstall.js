import { useState, useEffect } from 'react';

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled,   setIsInstalled]   = useState(false);
  const [isIOS,         setIsIOS]         = useState(false);
  const [isMobile,      setIsMobile]      = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    const mobile = ios || /android/i.test(navigator.userAgent);
    setIsIOS(ios);
    setIsMobile(mobile);

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(standalone);

    const onPrompt = (e) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => { setIsInstalled(true); setInstallPrompt(null); };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
    return outcome === 'accepted';
  };

  // Mostrar botón si: no instalada Y (hay prompt nativo OR es iOS OR es móvil sin HTTPS)
  const canInstall = !isInstalled && (installPrompt !== null || isIOS || isMobile);
  // Si hay prompt nativo disponible, el botón funcionará directamente
  const promptReady = installPrompt !== null;

  return { canInstall, install, isIOS, isMobile, promptReady };
}
