import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NotificationProvider, useNotification } from '../../../context/NotificationContext';

function TestConsumer() {
  const { notify, toasts, removeToast } = useNotification();
  return (
    <div>
      <button onClick={() => notify.success('OK!')}>add</button>
      <button onClick={() => notify.error('Fail')}>error</button>
      <span data-testid="count">{toasts.length}</span>
      {toasts.map(t => (
        <span key={t.id} data-testid={`toast-${t.type}`} onClick={() => removeToast(t.id)}>
          {t.message}
        </span>
      ))}
    </div>
  );
}

describe('NotificationContext', () => {
  it('starts with no toasts', () => {
    render(
      <NotificationProvider><TestConsumer /></NotificationProvider>
    );
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('adds success toast', async () => {
    render(
      <NotificationProvider><TestConsumer /></NotificationProvider>
    );
    await act(() => screen.getByText('add').click());
    expect(screen.getByTestId('toast-success').textContent).toBe('OK!');
  });

  it('adds error toast', async () => {
    render(
      <NotificationProvider><TestConsumer /></NotificationProvider>
    );
    await act(() => screen.getByText('error').click());
    expect(screen.getByTestId('toast-error').textContent).toBe('Fail');
  });

  it('removes toast manually', async () => {
    render(
      <NotificationProvider><TestConsumer /></NotificationProvider>
    );
    await act(() => screen.getByText('add').click());
    expect(screen.getByTestId('count').textContent).toBe('1');
    await act(() => screen.getByTestId('toast-success').click());
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('auto-removes toast after duration', async () => {
    vi.useFakeTimers();
    render(
      <NotificationProvider><TestConsumer /></NotificationProvider>
    );
    await act(() => screen.getByText('add').click());
    expect(screen.getByTestId('count').textContent).toBe('1');
    await act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('count').textContent).toBe('0');
    vi.useRealTimers();
  });
});
