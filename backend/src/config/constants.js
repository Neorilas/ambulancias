/**
 * config/constants.js
 * Constantes globales de la aplicación
 */

'use strict';

module.exports = {

  // ---- Roles del sistema (deben coincidir con los nombres en BD) ----
  ROLES: {
    ADMINISTRADOR: 'administrador',
    GESTOR:        'gestor',
    TECNICO:       'tecnico',
    ENFERMERO:     'enfermero',
    MEDICO:        'medico',
  },

  // ---- Estados de trabajos ----
  TRABAJO_ESTADOS: {
    PROGRAMADO:          'programado',
    ACTIVO:              'activo',
    FINALIZADO:          'finalizado',
    FINALIZADO_ANTICIPADO: 'finalizado_anticipado',
  },

  // ---- Tipos de trabajos ----
  TRABAJO_TIPOS: {
    TRASLADO:         'traslado',
    COBERTURA_EVENTO: 'cobertura_evento',
    OTRO:             'otro',
  },

  // ---- Tipos de imágenes de vehículo ----
  IMAGEN_TIPOS: ['frontal', 'lateral_derecho', 'trasera', 'lateral_izquierdo', 'liquidos'],
  IMAGEN_TIPOS_REQUERIDOS: ['frontal', 'lateral_derecho', 'trasera', 'lateral_izquierdo', 'liquidos'],

  // ---- Configuración de uploads ----
  UPLOAD: {
    MAX_SIZE_BYTES: (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024,
    ALLOWED_MIMETYPES: ['image/jpeg', 'image/png', 'image/webp'],
    RESIZE_WIDTH:  1280,  // px - redimensionar si supera
    JPEG_QUALITY:  82,    // % compresión JPEG
  },

  // ---- Paginación por defecto ----
  PAGINATION: {
    DEFAULT_PAGE:  1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT:     100,
  },

  // ---- Bloqueo de cuenta ----
  LOCKOUT: {
    MAX_ATTEMPTS: parseInt(process.env.ACCOUNT_LOCKOUT_ATTEMPTS) || 5,
    DURATION_MINUTES: parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MINUTES) || 30,
  },

  // ---- Prefijo identificador trabajos ----
  TRABAJO_ID_PREFIX: 'TRB',
};
