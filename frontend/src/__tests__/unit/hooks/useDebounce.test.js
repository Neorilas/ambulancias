import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce, default as useDebounceDefault } from '../../../hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const avanzar = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  it('devuelve el valor inicial sin esperar', () => {
    const { result } = renderHook(() => useDebounce('ambu'));
    expect(result.current).toBe('ambu');
  });

  it('no propaga el valor nuevo hasta que pasa el silencio', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 400), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    expect(result.current).toBe('a');

    avanzar(399);
    expect(result.current).toBe('a');

    avanzar(1);
    expect(result.current).toBe('ab');
  });

  it('escribir seguido produce una sola propagación, la última', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 400), {
      initialProps: { v: '' },
    });

    // Diez pulsaciones a 100 ms: antes esto eran diez peticiones a la API.
    for (const v of ['a', 'am', 'amb', 'ambu', 'ambul', 'ambula', 'ambulan', 'ambulanc', 'ambulanci', 'ambulancia']) {
      rerender({ v });
      avanzar(100);
    }
    expect(result.current).toBe('');

    avanzar(400);
    expect(result.current).toBe('ambulancia');
  });

  it('el retraso por defecto es de 400 ms', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });

    avanzar(399);
    expect(result.current).toBe('a');
    avanzar(1);
    expect(result.current).toBe('b');
  });

  it('admite un retraso distinto', () => {
    const { result, rerender } = renderHook(({ v, ms }) => useDebounce(v, ms), {
      initialProps: { v: 'a', ms: 50 },
    });
    rerender({ v: 'b', ms: 50 });

    avanzar(50);
    expect(result.current).toBe('b');
  });

  it('cambiar el retraso reinicia la espera', () => {
    const { result, rerender } = renderHook(({ v, ms }) => useDebounce(v, ms), {
      initialProps: { v: 'a', ms: 400 },
    });

    rerender({ v: 'b', ms: 400 });
    avanzar(300);
    rerender({ v: 'b', ms: 1000 });
    avanzar(300);
    expect(result.current).toBe('a');

    avanzar(700);
    expect(result.current).toBe('b');
  });

  it('desmontar cancela el temporizador pendiente', () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(({ v }) => useDebounce(v, 400), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('funciona con valores que no son texto', () => {
    const objeto = { estado: 'activo' };
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: null },
    });
    expect(result.current).toBeNull();

    rerender({ v: objeto });
    avanzar(100);
    expect(result.current).toBe(objeto);
  });

  it('la exportación por defecto es el mismo hook', () => {
    expect(useDebounceDefault).toBe(useDebounce);
  });
});
