import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Sin cámara: el hook devuelve el estado de «permiso denegado», que es lo que
// se ve en el escritorio.
vi.mock('../../../components/camera/useCameraStream.js', () => ({
  useCameraStream: () => ({
    videoRef: { current: null }, canvasRef: { current: null },
    cameraReady: false, error: 'Permiso de cámara denegado.',
    isLandscape: false, toggleCamera: vi.fn(), captureBlob: vi.fn(),
  }),
}));
vi.mock('../../../components/camera/detectorVehiculo.js', () => ({ precargarDetector: vi.fn() }));

import CameraCapture from '../../../components/camera/CameraCapture.jsx';

const TIPOS = [{ key: 'frontal', label: 'Frontal', instruccion: '', landscape: false }];

// El atajo de fotos (§3.6 del mapa) solo puede existir con `npm run dev`.
describe('CameraCapture — «Saltar fotos (local)»', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fuera de dev (cualquier build: PRE y producción) no se pinta', () => {
    vi.stubEnv('DEV', false);
    render(<CameraCapture tipos={TIPOS} onComplete={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/Saltar fotos/)).toBeNull();
  });

  it('con npm run dev se pinta, también sin cámara', () => {
    vi.stubEnv('DEV', true);
    render(<CameraCapture tipos={TIPOS} onComplete={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Saltar fotos (local)')).toBeInTheDocument();
  });
});
