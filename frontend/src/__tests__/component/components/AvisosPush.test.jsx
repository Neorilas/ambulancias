import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/push.service.js', () => ({
  pushService: {
    getClavePublica: vi.fn(),
    getEstado:       vi.fn(),
    subscribe:       vi.fn(),
    unsubscribe:     vi.fn(),
    test:            vi.fn(),
  },
}));

vi.mock('../../../utils/push.js', () => ({
  soportaPush:       vi.fn(),
  estaInstalada:     vi.fn(),
  esIOS:             vi.fn(),
  permisoActual:     vi.fn(),
  suscripcionActual: vi.fn(),
  suscribir:         vi.fn(),
  desuscribir:       vi.fn(),
}));

// El texto de la cabecera cambia según gestione o no (el técnico solo recibe
// el aviso de «nuevo servicio»). Por defecto, gestión.
const auth = { gestiona: true };
vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ hasPermission: () => auth.gestiona }),
}));

import { pushService } from '../../../services/push.service.js';
import * as navegador  from '../../../utils/push.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import ToastContainer from '../../../components/common/Toast.jsx';
import AvisosPush from '../../../components/common/AvisosPush.jsx';

// El contenedor de toasts va dentro a propósito: los mensajes de error del
// componente salen por ahí, no en su propio marcado. Sin él, «un fallo no
// rompe la pantalla» no podría comprobar que el usuario llega a enterarse.
const montar = () => render(
  <NotificationProvider>
    <AvisosPush />
    <ToastContainer />
  </NotificationProvider>
);

/** Navegador capaz, entorno con claves, permiso aún sin decidir. */
function escenarioNormal() {
  navegador.soportaPush.mockReturnValue(true);
  navegador.esIOS.mockReturnValue(false);
  navegador.estaInstalada.mockReturnValue(true);
  navegador.permisoActual.mockReturnValue('default');
  navegador.suscripcionActual.mockResolvedValue(null);
  pushService.getClavePublica.mockResolvedValue({ configurado: true, publicKey: 'K' });
}

describe('AvisosPush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.gestiona = true;
    escenarioNormal();
  });

  describe('qué avisos anuncia', () => {
    it('gestión: los de la flota y el de nuevo servicio', async () => {
      montar();
      expect(await screen.findByText(/se inicia un servicio.*te asignan uno/i)).toBeInTheDocument();
    });

    it('técnico: solo el de nuevo servicio', async () => {
      auth.gestiona = false;
      montar();
      expect(await screen.findByText('Suena cuando te asignan un servicio nuevo.')).toBeInTheDocument();
      expect(screen.queryByText(/se inicia un servicio/i)).not.toBeInTheDocument();
    });
  });

  describe('estados de arranque', () => {
    it('sin suscripción ofrece activarlos', async () => {
      montar();
      expect(await screen.findByRole('button', { name: /activar avisos/i })).toBeInTheDocument();
      // Acotado a la pastilla: «desactivados» sale también en el párrafo.
      expect(screen.getByText('Desactivados', { selector: 'span' })).toBeInTheDocument();
    });

    it('suscrito y registrado en el servidor: activo, con prueba y baja', async () => {
      navegador.suscripcionActual.mockResolvedValue({ endpoint: 'e' });
      pushService.getEstado.mockResolvedValue({ registrado: true });

      montar();

      expect(await screen.findByRole('button', { name: /aviso de prueba/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /desactivar/i })).toBeInTheDocument();
      expect(screen.getByText(/Activos/i)).toBeInTheDocument();
    });

    it('el navegador guarda una suscripción que el servidor ya no tiene: inactivo', async () => {
      // Pasa cuando el servidor la borró por caducada (404/410). Si se fiara
      // solo del navegador, diría «Activos» y no sonaría nunca.
      navegador.suscripcionActual.mockResolvedValue({ endpoint: 'e' });
      pushService.getEstado.mockResolvedValue({ registrado: false });

      montar();

      expect(await screen.findByRole('button', { name: /activar avisos/i })).toBeInTheDocument();
    });

    it('permiso denegado: explica cómo desbloquearlo y no ofrece el botón', async () => {
      navegador.permisoActual.mockReturnValue('denied');

      montar();

      expect(await screen.findByText(/has bloqueado las notificaciones/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /activar avisos/i })).not.toBeInTheDocument();
    });

    it('iPhone sin instalar: explica cómo añadirla a la pantalla de inicio', async () => {
      navegador.soportaPush.mockReturnValue(false);
      navegador.esIOS.mockReturnValue(true);
      navegador.estaInstalada.mockReturnValue(false);

      montar();

      // Sale dos veces (el párrafo y el paso de la lista): basta con que esté.
      expect((await screen.findAllByText(/pantalla\s+de\s+inicio/i)).length).toBeGreaterThan(0);
      expect(pushService.getClavePublica).not.toHaveBeenCalled();
    });

    it('navegador sin push y que no es iOS: lo dice sin dar instrucciones de iPhone', async () => {
      navegador.soportaPush.mockReturnValue(false);
      navegador.esIOS.mockReturnValue(false);

      montar();

      expect(await screen.findByText(/no admite avisos push/i)).toBeInTheDocument();
    });

    it('entorno sin claves VAPID: lo dice en vez de ofrecer un botón inútil', async () => {
      pushService.getClavePublica.mockResolvedValue({ configurado: false, publicKey: null });

      montar();

      expect(await screen.findByText(/no están configurados en este entorno/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /activar avisos/i })).not.toBeInTheDocument();
    });

    it('si falla la consulta ofrece reintentar', async () => {
      pushService.getClavePublica.mockRejectedValue(new Error('red'));

      montar();

      expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    });
  });

  describe('activar', () => {
    it('suscribe en el navegador y da de alta en el servidor', async () => {
      navegador.suscribir.mockResolvedValue({ endpoint: 'nueva' });
      pushService.subscribe.mockResolvedValue({ suscrito: true });

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /activar avisos/i }));

      await waitFor(() => expect(pushService.subscribe).toHaveBeenCalledWith({ endpoint: 'nueva' }));
      expect(navegador.suscribir).toHaveBeenCalledWith('K');
      expect(await screen.findByRole('button', { name: /aviso de prueba/i })).toBeInTheDocument();
    });

    it('si el usuario deniega el permiso, pasa a bloqueado', async () => {
      navegador.suscribir.mockRejectedValue(new Error('No has concedido permiso para recibir avisos.'));
      navegador.permisoActual.mockReturnValueOnce('default').mockReturnValue('denied');

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /activar avisos/i }));

      expect(await screen.findByText(/has bloqueado las notificaciones/i)).toBeInTheDocument();
      expect(pushService.subscribe).not.toHaveBeenCalled();
    });

    it('un fallo del alta en el servidor no deja el botón colgado', async () => {
      navegador.suscribir.mockResolvedValue({ endpoint: 'nueva' });
      pushService.subscribe.mockRejectedValue(new Error('500'));

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /activar avisos/i }));

      const boton = await screen.findByRole('button', { name: /activar avisos/i });
      await waitFor(() => expect(boton).not.toBeDisabled());
    });
  });

  describe('desactivar', () => {
    beforeEach(() => {
      navegador.suscripcionActual.mockResolvedValue({ endpoint: 'e' });
      pushService.getEstado.mockResolvedValue({ registrado: true });
    });

    it('retira la suscripción y la da de baja en el servidor', async () => {
      navegador.desuscribir.mockResolvedValue('e');
      pushService.unsubscribe.mockResolvedValue({ borrada: true });

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /desactivar/i }));

      await waitFor(() => expect(pushService.unsubscribe).toHaveBeenCalledWith('e'));
      expect(await screen.findByRole('button', { name: /activar avisos/i })).toBeInTheDocument();
    });

    it('sin endpoint en el navegador no llama a la baja, pero queda inactivo', async () => {
      navegador.desuscribir.mockResolvedValue(null);

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /desactivar/i }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /activar avisos/i })).toBeInTheDocument());
      expect(pushService.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('aviso de prueba', () => {
    beforeEach(() => {
      navegador.suscripcionActual.mockResolvedValue({ endpoint: 'e' });
      pushService.getEstado.mockResolvedValue({ registrado: true });
    });

    it('lo pide al servidor', async () => {
      pushService.test.mockResolvedValue({ success: true });

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /aviso de prueba/i }));

      await waitFor(() => expect(pushService.test).toHaveBeenCalled());
    });

    it('un fallo no rompe la pantalla', async () => {
      pushService.test.mockRejectedValue({ response: { data: { message: 'No hay dispositivos' } } });

      montar();
      await userEvent.click(await screen.findByRole('button', { name: /aviso de prueba/i }));

      expect(await screen.findByText(/No hay dispositivos/i)).toBeInTheDocument();
    });
  });
});
