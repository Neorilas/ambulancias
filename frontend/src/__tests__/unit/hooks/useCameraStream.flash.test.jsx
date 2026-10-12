import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useCameraStream } from '../../../components/camera/useCameraStream.js';

// Un track de cámara de mentira: `torch` en las capacidades o no.
function crearTrack({ torch }) {
  return {
    getCapabilities: () => (torch ? { torch: true } : {}),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

let tracks;
function Harness({ pause = false }) {
  const { videoRef, cameraReady, flash, flashDisponible, toggleFlash, toggleCamera } =
    useCameraStream({ pause });
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="estado">{`${cameraReady}|${flashDisponible}|${flash}`}</span>
      <button onClick={toggleFlash}>flash</button>
      <button onClick={toggleCamera}>girar</button>
    </div>
  );
}

const estado = () => screen.getByTestId('estado').textContent;
const torchAplicado = (t) => t.applyConstraints.mock.calls.map(([c]) => c.advanced[0].torch);

describe('useCameraStream — flash (linterna)', () => {
  let conTorch;
  beforeEach(() => {
    tracks = [];
    conTorch = (facing) => facing === 'environment';
    navigator.mediaDevices = {
      getUserMedia: vi.fn(async ({ video }) => {
        const t = crearTrack({ torch: conTorch(video.facingMode) });
        tracks.push(t);
        return { getTracks: () => [t], getVideoTracks: () => [t] };
      }),
    };
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); delete navigator.mediaDevices; });

  it('si la cámara anuncia torch, se ofrece y se enciende/apaga', async () => {
    render(<Harness />);
    await act(async () => {});
    expect(estado()).toBe('true|true|false');

    await act(async () => { fireEvent.click(screen.getByText('flash')); });
    expect(estado()).toBe('true|true|true');
    expect(torchAplicado(tracks[0]).at(-1)).toBe(true);

    await act(async () => { fireEvent.click(screen.getByText('flash')); });
    expect(torchAplicado(tracks[0]).at(-1)).toBe(false);
  });

  it('sin torch (iPhone, frontal) no se ofrece ni se toca el track', async () => {
    conTorch = () => false;
    render(<Harness />);
    await act(async () => {});
    expect(estado()).toBe('true|false|false');
    expect(tracks[0].applyConstraints).not.toHaveBeenCalled();
  });

  it('tras la previsualización (stream parado) vuelve a encender el flash', async () => {
    const { rerender } = render(<Harness />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByText('flash')); });

    await act(async () => { rerender(<Harness pause />); });
    await act(async () => { rerender(<Harness />); });
    expect(tracks).toHaveLength(2);
    expect(torchAplicado(tracks[1]).at(-1)).toBe(true);
  });

  it('al girar a la frontal desaparece; al volver, sigue encendido', async () => {
    render(<Harness />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByText('flash')); });

    await act(async () => { fireEvent.click(screen.getByText('girar')); });
    expect(estado()).toBe('true|false|true');
    await act(async () => { fireEvent.click(screen.getByText('girar')); });
    expect(estado()).toBe('true|true|true');
    expect(torchAplicado(tracks.at(-1)).at(-1)).toBe(true);
  });
});
