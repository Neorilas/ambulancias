import api from './api.js';

/**
 * services/push.service.js
 * Llamadas al backend para dar de alta y de baja los avisos de un dispositivo.
 * La parte que depende del navegador está en `utils/push.js`.
 */
export const pushService = {
  /** Clave VAPID con la que suscribirse, y si el entorno tiene push configurado. */
  getClavePublica() {
    return api.get('/push/vapid-public-key').then(r => r.data.data);
  },

  /**
   * ¿Está este endpoint dado de alta en el servidor? Por POST: en la query
   * string el endpoint acababa en el log de peticiones del backend.
   */
  getEstado(endpoint) {
    return api.post('/push/estado', endpoint ? { endpoint } : {})
      .then(r => r.data.data);
  },

  /** Alta. `subscription` es el PushSubscription tal cual lo da el navegador. */
  subscribe(subscription) {
    return api.post('/push/subscribe', { subscription: subscription.toJSON?.() ?? subscription })
      .then(r => r.data.data);
  },

  /** Baja de este dispositivo. */
  unsubscribe(endpoint) {
    return api.delete('/push/subscribe', { data: { endpoint } }).then(r => r.data.data);
  },

  /** Aviso de prueba a uno mismo. */
  test() {
    return api.post('/push/test').then(r => r.data);
  },
};
