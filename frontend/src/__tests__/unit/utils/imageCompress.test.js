import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressImage, blobToBase64, blobToFile } from '../../../utils/imageCompress';

describe('imageCompress', () => {
  describe('blobToFile', () => {
    it('converts blob to File', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const file = blobToFile(blob, 'photo.jpg');
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('photo.jpg');
    });

    it('uses default filename', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const file = blobToFile(blob);
      expect(file.name).toBe('photo.jpg');
    });

    it('uses image/jpeg when blob has no type', () => {
      const blob = new Blob(['test']);
      const file = blobToFile(blob, 'test.jpg');
      expect(file.type).toBe('image/jpeg');
    });
  });

  describe('blobToBase64', () => {
    it('converts blob to base64 string', async () => {
      const blob = new Blob(['hello'], { type: 'text/plain' });
      const result = await blobToBase64(blob);
      expect(result).toContain('data:');
    });
  });

  describe('compressImage', () => {
    let mockCtx;
    let mockCanvas;
    let OrigImage;

    beforeEach(() => {
      mockCtx = { drawImage: vi.fn() };
      mockCanvas = {
        width: 0, height: 0,
        getContext: vi.fn(() => mockCtx),
        toBlob: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'canvas') return mockCanvas;
        // fallback for other elements
        const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
        return el;
      });

      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      // Save original and replace with a controllable class
      OrigImage = globalThis.Image;
      globalThis.Image = class MockImage {
        constructor() {
          this._width = 800;
          this._height = 600;
          setTimeout(() => {
            this.width = this._width;
            this.height = this._height;
            this.onload?.();
          }, 0);
        }
      };
    });

    afterEach(() => {
      globalThis.Image = OrigImage;
      vi.restoreAllMocks();
    });

    it('compresses an image without resize when smaller than maxWidth', async () => {
      mockCanvas.toBlob.mockImplementation((cb) => {
        cb(new Blob(['compressed'], { type: 'image/jpeg' }));
      });

      const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await compressImage(file);

      expect(result).toBeInstanceOf(Blob);
      expect(mockCanvas.width).toBe(800);
      expect(mockCanvas.height).toBe(600);
      expect(mockCtx.drawImage).toHaveBeenCalled();
    });

    it('resizes when width exceeds maxWidth', async () => {
      globalThis.Image = class MockImageLarge {
        constructor() {
          setTimeout(() => {
            this.width = 2560;
            this.height = 1920;
            this.onload?.();
          }, 0);
        }
      };

      mockCanvas.toBlob.mockImplementation((cb) => {
        cb(new Blob(['compressed'], { type: 'image/jpeg' }));
      });

      const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await compressImage(file, { maxWidth: 1280 });

      expect(result).toBeInstanceOf(Blob);
      expect(mockCanvas.width).toBe(1280);
      expect(mockCanvas.height).toBe(960);
    });

    it('rejects when toBlob returns null', async () => {
      mockCanvas.toBlob.mockImplementation((cb) => cb(null));

      const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
      await expect(compressImage(file)).rejects.toThrow('Error al comprimir imagen');
    });

    it('rejects on image load error', async () => {
      globalThis.Image = class MockImageError {
        constructor() {
          setTimeout(() => this.onerror?.(), 0);
        }
      };

      const file = new File(['data'], 'bad.jpg', { type: 'image/jpeg' });
      await expect(compressImage(file)).rejects.toThrow('Error al cargar la imagen');
    });
  });
});
