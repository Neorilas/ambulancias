/**
 * Comprime una imagen (File o Blob) en el cliente antes de subirla
 * Reduce ancho máximo a 1280px y calidad JPEG al 80%
 *
 * @param {File|Blob} imageFile
 * @param {object}    opts
 * @param {number}    opts.maxWidth  - px (default 1280)
 * @param {number}    opts.quality   - 0-1 (default 0.80)
 * @returns {Promise<Blob>}
 */
export async function compressImage(imageFile, { maxWidth = 1280, quality = 0.80 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas   = document.createElement('canvas');
      let { width, height } = img;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width  = maxWidth;
      }

      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Error al comprimir imagen'));
          resolve(blob);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Error al cargar la imagen'));
    };

    img.src = url;
  });
}

/**
 * Convierte un Blob/File a base64 (para previsualización)
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Crea un File desde un Blob con nombre y tipo
 */
export function blobToFile(blob, filename = 'photo.jpg') {
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}
