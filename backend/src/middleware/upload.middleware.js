/**
 * middleware/upload.middleware.js
 * Configuración de Multer para subida de imágenes
 * con procesamiento Sharp (redimensionado + compresión)
 */

'use strict';

const multer = require('multer');
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const { randomUUID } = require('crypto');
const { UPLOAD }     = require('../config/constants');
const logger         = require('../utils/logger.utils');

const UPLOADS_BASE = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));

// Guardar en memoria primero para procesar con Sharp
const storage = multer.memoryStorage();

/**
 * Filtro de tipos de archivo permitidos
 */
const fileFilter = (_req, file, cb) => {
  if (UPLOAD.ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Tipo de archivo no permitido. Solo JPEG, PNG o WebP.'));
  }
};

/**
 * Instancia de Multer base
 */
const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: UPLOAD.MAX_SIZE_BYTES },
});

/**
 * Sube una imagen del campo `campo`. Es `multerUpload.single` más una cosa:
 * los fallos que no son MulterError (multipart mal formado, cuerpo cortado a
 * mitad, petición abortada por el móvil) salen de busboy como Error genérico y
 * acababan en 500 y en error_logs como fallo del servidor. Son de la petición,
 * no nuestros: 400, y así nadie llena error_logs mandando subidas rotas.
 */
function subirImagen(campo) {
  const single = multerUpload.single(campo);
  return (req, res, next) => single(req, res, (err) => {
    if (err && !(err instanceof multer.MulterError)) {
      err.status = 400;
      err.multipartRoto = true;
    }
    next(err);
  });
}

/**
 * Igual que subirImagen, pero para un PDF (facturas). Va en memoria y no pasa
 * por Sharp: el controlador lo guarda tal cual en la BD. Sin fileFilter a
 * propósito: el mimetype lo declara el navegador y no prueba nada; que sea un
 * PDF lo decide el controlador por la cabecera del fichero (`%PDF-`), con su
 * propio mensaje. (Un MulterError con texto propio no sirve: el segundo
 * argumento es el campo, no el mensaje.)
 */
// Tope propio: MEDIUMBLOB admite 16 MB. Si MAX_FILE_SIZE_MB se sube por encima
// de 15 para las fotos, un PDF así reventaría el INSERT con un 500.
const PDF_MAX_BYTES = Math.min(UPLOAD.MAX_SIZE_BYTES, 15 * 1024 * 1024);

const multerPdf = multer({
  storage,
  limits: { fileSize: PDF_MAX_BYTES, files: 1 },
});

function subirPdf(campo) {
  const single = multerPdf.single(campo);
  return (req, res, next) => single(req, res, (err) => {
    if (err && !(err instanceof multer.MulterError)) {
      err.status = 400;
      err.multipartRoto = 'pdf';
    }
    next(err);
  });
}

/**
 * Middleware para procesar una imagen con Sharp (resize + compress)
 * y guardarla en disco. Añade req.processedFile con info del archivo guardado.
 * @param {string} subdir - subdirectorio dentro de uploads (ej: 'vehicles/123')
 */
function processAndSave(subdir) {
  return async (req, res, next) => {
    if (!req.file) return next();

    try {
      const dir = path.join(UPLOADS_BASE, subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const filename = `${randomUUID()}.jpg`;
      const filepath = path.join(dir, filename);

      // Redimensionar y comprimir con Sharp
      await sharp(req.file.buffer)
        .rotate()                                    // auto-rotate por EXIF
        .resize({
          width:   UPLOAD.RESIZE_WIDTH,
          withoutEnlargement: true,                  // no ampliar si es más pequeña
        })
        .jpeg({ quality: UPLOAD.JPEG_QUALITY, progressive: true })
        .toFile(filepath);

      // Relativo a UPLOADS_BASE para guardar en BD
      req.processedFile = {
        filename,
        path:    filepath,
        url:     `/uploads/${subdir}/${filename}`.replace(/\\/g, '/'),
        mimetype: 'image/jpeg',
      };

      next();
    } catch (err) {
      logger.error('Error procesando imagen:', err);
      next(new Error('Error al procesar la imagen'));
    }
  };
}

/**
 * Middleware para procesar múltiples imágenes (array)
 * Añade req.processedFiles[]
 * @param {string} subdir
 */
function processAndSaveMultiple(subdir) {
  return async (req, res, next) => {
    if (!req.files || req.files.length === 0) return next();

    try {
      const dir = path.join(UPLOADS_BASE, subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      req.processedFiles = [];

      for (const file of req.files) {
        const filename = `${randomUUID()}.jpg`;
        const filepath = path.join(dir, filename);

        await sharp(file.buffer)
          .rotate()
          .resize({ width: UPLOAD.RESIZE_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: UPLOAD.JPEG_QUALITY, progressive: true })
          .toFile(filepath);

        req.processedFiles.push({
          fieldname: file.fieldname,
          filename,
          path:    filepath,
          url:     `/uploads/${subdir}/${filename}`.replace(/\\/g, '/'),
          mimetype: 'image/jpeg',
        });
      }

      next();
    } catch (err) {
      logger.error('Error procesando imágenes múltiples:', err);
      next(new Error('Error al procesar las imágenes'));
    }
  };
}

/**
 * Elimina un archivo de uploads de forma segura
 * @param {string} relativePath - path relativo como /uploads/vehicles/xxx.jpg
 */
function deleteFile(relativePath) {
  try {
    const fullPath = path.join(UPLOADS_BASE, relativePath.replace('/uploads/', ''));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (err) {
    logger.warn('No se pudo eliminar archivo:', relativePath, err.message);
  }
}

module.exports = { multerUpload, subirImagen, subirPdf, PDF_MAX_BYTES, processAndSave, processAndSaveMultiple, deleteFile };
