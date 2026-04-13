import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePWAInstall } from '../../../hooks/usePWAInstall';

describe('usePWAInstall', () => {
  const origUA = navigator.userAgent;

  beforeEach(() => {
    window.__pwaInstallPrompt = null;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: origUA, configurable: true });
    window.__pwaInstallPrompt = null;
  });

  it('returns install state with all properties', () => {
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current).toHaveProperty('canInstall');
    expect(result.current).toHaveProperty('install');
    expect(result.current).toHaveProperty('isIOS');
    expect(result.current).toHaveProperty('isMobile');
    expect(result.current).toHaveProperty('promptReady');
  });

  it('canInstall is false initially', () => {
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.promptReady).toBe(false);
  });

  it('responds to beforeinstallprompt event', () => {
    const { result } = renderHook(() => usePWAInstall());
    const event = new Event('beforeinstallprompt');
    event.preventDefault = vi.fn();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(result.current.promptReady).toBe(true);
    expect(result.current.canInstall).toBe(true);
  });

  it('install returns false when no prompt', async () => {
    const { result } = renderHook(() => usePWAInstall());
    const outcome = await act(async () => result.current.install());
    expect(outcome).toBe(false);
  });

  it('install calls prompt and returns true on accepted', async () => {
    const { result } = renderHook(() => usePWAInstall());
    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
      preventDefault: vi.fn(),
    };
    act(() => {
      const event = new Event('beforeinstallprompt');
      event.preventDefault = vi.fn();
      event.prompt = mockPrompt.prompt;
      event.userChoice = mockPrompt.userChoice;
      window.dispatchEvent(event);
    });

    // Now installPrompt should be the event — but we need to override
    // Actually the prompt is stored as the event itself, so let's use __pwaInstallPrompt
    // Re-render with the prompt set
    window.__pwaInstallPrompt = mockPrompt;
    const { result: result2 } = renderHook(() => usePWAInstall());

    let outcome;
    await act(async () => {
      outcome = await result2.current.install();
    });
    expect(mockPrompt.prompt).toHaveBeenCalled();
    expect(outcome).toBe(true);
  });

  it('install returns false on dismissed', async () => {
    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    };
    window.__pwaInstallPrompt = mockPrompt;

    const { result } = renderHook(() => usePWAInstall());
    let outcome;
    await act(async () => {
      outcome = await result.current.install();
    });
    expect(outcome).toBe(false);
  });

  it('detects iOS user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      configurable: true,
    });
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isIOS).toBe(true);
    expect(result.current.isMobile).toBe(true);
    // canInstall is true on iOS even without prompt
    expect(result.current.canInstall).toBe(true);
  });

  it('detects Android user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13)',
      configurable: true,
    });
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isIOS).toBe(false);
  });

  it('responds to appinstalled event', () => {
    const mockPrompt = { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) };
    window.__pwaInstallPrompt = mockPrompt;

    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.promptReady).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(result.current.promptReady).toBe(false);
    expect(result.current.canInstall).toBe(false);
  });

  it('responds to pwaPromptReady event', () => {
    const mockPrompt = { prompt: vi.fn() };
    window.__pwaInstallPrompt = null;

    const { result } = renderHook(() => usePWAInstall());

    // Set prompt and fire custom event
    window.__pwaInstallPrompt = mockPrompt;
    act(() => {
      window.dispatchEvent(new Event('pwaPromptReady'));
    });
    expect(result.current.promptReady).toBe(true);
  });
});
