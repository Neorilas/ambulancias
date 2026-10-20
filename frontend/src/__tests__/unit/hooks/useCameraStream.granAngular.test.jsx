import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// La ultra gran angular se recuerda a nivel de módulo: cada test lo carga de
// cero para no heredar la del anterior.
let useCameraStream;
let tracks;
let pedidas;

function crearTrack({ zoom, torch = false }) {
  return {
    getCapabilities: () => ({ ...(zoom ? { zoom } : {}), ...(torch ? { torch: true } : {}) }),
    getSettings: () => (zoom ? { zoom: 1 } : {}),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

function Harness({ granAngular = true, pause = false }) {
  const { videoRef, ancho, anchoDisponible, toggleAncho, toggleFlash } =
    useCameraStream({ granAngular, pause });
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="estado">{`${ancho}|${anchoDisponible}`}</span>
      <button onClick={toggleAncho}>ancho</button>
      <button onClick={toggleFlash}>flash</button>
    </div>
  );
}

const estado = () => screen.getByTestId('estado').textContent;

function montarMedia({ dispositivos = [], zoom = null, torch = false, falla = () => false }) {
  navigator.mediaDevices = {
    getUserMedia: vi.fn(async ({ video }) => {
      pedidas.push(video);
      if (falla(video)) throw Object.assign(new Error('no'), { name: 'NotReadableError' });
      const t = crearTrack({ zoom: video.deviceId ? null : zoom, torch });
      tracks.push(t);
      return { getTracks: () => [t], getVideoTracks: () => [t] };
    }),
    enumerateDevices: vi.fn(async () => dispositivos),
  };
}

const ULTRA = { kind: 'videoinput', deviceId: 'ultra-1', label: 'Back Ultra Wide Camera' };
const NORMAL = { kind: 'videoinput', deviceId: 'normal-1', label: 'Back Camera' };
const DUAL = { kind: 'videoinput', deviceId: 'dual-1', label: 'Back Dual Wide Camera' };

describe('useCameraStream — gran angular en las exteriores', () => {
  beforeEach(async () => {
    tracks = [];
    pedidas = [];
    vi.resetModules();
    ({ useCameraStream } = await import('../../../components/camera/useCameraStream.js'));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); delete navigator.mediaDevices; });

  it('con una ultra gran angular (iPhone) la abre en las exteriores', async () => {
    montarMedia({ dispositivos: [NORMAL, DUAL, ULTRA] });
    render(<Harness />);
    await act(async () => {});
    expect(pedidas.at(-1).deviceId).toEqual({ exact: 'ultra-1' });
    expect(estado()).toBe('true|true');
  });

  it('el botón vuelve a la lente normal', async () => {
    montarMedia({ dispositivos: [NORMAL, ULTRA] });
    render(<Harness />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByText('ancho')); });
    expect(pedidas.at(-1).deviceId).toBeUndefined();
    expect(pedidas.at(-1).facingMode).toBe('environment');
    expect(estado()).toBe('false|true');
  });

  it('en el cuadro y los niveles no se usa', async () => {
    montarMedia({ dispositivos: [NORMAL, ULTRA] });
    render(<Harness granAngular={false} />);
    await act(async () => {});
    expect(pedidas.every(v => !v.deviceId)).toBe(true);
  });

  it('«Dual Wide» no cuenta como ultra gran angular', async () => {
    montarMedia({ dispositivos: [NORMAL, DUAL] });
    render(<Harness />);
    await act(async () => {});
    expect(pedidas.every(v => !v.deviceId)).toBe(true);
    expect(estado()).toBe('true|false');
  });

  it('sin lente aparte pero con zoom por debajo de 1× (Android), baja al mínimo', async () => {
    montarMedia({ zoom: { min: 0.6, max: 8 } });
    render(<Harness />);
    await act(async () => {});
    expect(tracks[0].applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 0.6 }] });
    expect(estado()).toBe('true|true');
  });

  it('el flash no deshace el zoom del gran angular', async () => {
    montarMedia({ zoom: { min: 0.6, max: 8 }, torch: true });
    render(<Harness />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByText('flash')); });
    expect(tracks[0].applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }, { zoom: 0.6 }] });
  });

  it('con zoom mínimo 1× no hay nada que abrir y no sale el botón', async () => {
    montarMedia({ zoom: { min: 1, max: 8 } });
    render(<Harness />);
    await act(async () => {});
    expect(tracks[0].applyConstraints).not.toHaveBeenCalled();
    expect(estado()).toBe('true|false');
  });

  it('si la ultra no abre, vuelve a la cámara de siempre sin error', async () => {
    montarMedia({ dispositivos: [NORMAL, ULTRA], falla: v => !!v.deviceId });
    render(<Harness />);
    await act(async () => {});
    await act(async () => {});
    expect(pedidas.at(-1).facingMode).toBe('environment');
    expect(tracks.at(-1).stop).not.toHaveBeenCalled();
    expect(estado()).toBe('true|false');
  });
});
