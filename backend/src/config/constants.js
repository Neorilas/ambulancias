/**
 * config/constants.js
 * Constantes globales de la aplicación
 */

'use strict';

module.exports = {

  // ---- Roles del sistema (deben coincidir con los nombres en BD) ----
  ROLES: {
    SUPERADMIN:    'superadmin',
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
  // ENUM completo de la columna `vehicle_images.tipo_imagen` (incluye 'niveles_liquidos' histórico)
  IMAGEN_TIPOS: [
    'frontal', 'lateral_izquierdo', 'lateral_derecho', 'trasera',
    'niveles_liquidos', 'nivel_aceite', 'nivel_liquidos_general',
    'cuentakilometros', 'danos',
  ],
  // Momentos posibles
  IMAGEN_MOMENTOS: ['inicio', 'fin', 'general'],
  // Fotos obligatorias al ASIGNARSE el vehículo (momento = 'inicio')
  IMAGEN_TIPOS_INICIO: [
    'frontal', 'lateral_izquierdo', 'trasera', 'lateral_derecho',
    'nivel_aceite', 'nivel_liquidos_general',
  ],
  // Fotos obligatorias al FINALIZAR (momento = 'fin')
  IMAGEN_TIPOS_FIN: [
    'frontal', 'lateral_izquierdo', 'trasera', 'lateral_derecho',
    'cuentakilometros',
  ],
  // DEPRECATED: mantenido por compatibilidad con tests/código legado
  IMAGEN_TIPOS_REQUERIDOS: [
    'frontal', 'lateral_izquierdo', 'lateral_derecho', 'trasera',
    'cuentakilometros',
  ],

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

  // ---- Permisos granulares (deben coincidir con los nombres en BD tabla permissions) ----
  PERMISSIONS: {
    MANAGE_VEHICLES:    'manage_vehicles',
    MANAGE_USERS:       'manage_users',
    MANAGE_TRABAJOS:    'manage_trabajos',
    VIEW_ALL_TRABAJOS:  'view_all_trabajos',
    MANAGE_INCIDENCIAS: 'manage_incidencias',
    ACCESS_ADMIN:       'access_admin',
  },
};
