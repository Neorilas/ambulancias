'use strict';

const fs = require('fs');
const path = require('path');

// Mock sharp before requiring the module
jest.mock('sharp', () => {
  const mockSharp = jest.fn(() => ({
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({ size: 1024 }),
  }));
  return mockSharp;
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const { processAndSave, processAndSaveMultiple, deleteFile } = require('../../../middleware/upload.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

describe('upload.middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('processAndSave', () => {
    it('calls next when no file present', async () => {
      const mw = processAndSave('test');
      const req = mockReq();
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.processedFile).toBeFalsy();
    });

    it('processes file with sharp and sets req.processedFile', async () => {
      fs.existsSync.mockReturnValue(false);
      const mw = processAndSave('trabajos/1');
      const req = mockReq({ file: { buffer: Buffer.from('fake-image'), mimetype: 'image/jpeg' } });
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.processedFile).toBeDefined();
      expect(req.processedFile.url).toContain('trabajos/1');
    });

    it('skips mkdirSync when directory already exists', async () => {
      fs.existsSync.mockReturnValue(true); // directory exists
      const mw = processAndSave('vehicles/1');
      const req = mockReq({ file: { buffer: Buffer.from('fake-image'), mimetype: 'image/jpeg' } });
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('calls next(error) when sharp throws', async () => {
      const sharp = require('sharp');
      sharp.mockImplementationOnce(() => ({
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockRejectedValue(new Error('Sharp failed')),
      }));
      fs.existsSync.mockReturnValue(true);

      const mw = processAndSave('vehicles/1');
      const req = mockReq({ file: { buffer: Buffer.from('fake-image'), mimetype: 'image/jpeg' } });
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('processAndSaveMultiple', () => {
    it('processes multiple files and sets req.processedFiles', async () => {
      fs.existsSync.mockReturnValue(false);
      const mw = processAndSaveMultiple('vehicles/1');
      const req = mockReq({
        files: [
          { buffer: Buffer.from('img1'), mimetype: 'image/jpeg', fieldname: 'photo1' },
          { buffer: Buffer.from('img2'), mimetype: 'image/jpeg', fieldname: 'photo2' },
        ],
      });
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.processedFiles).toHaveLength(2);
      expect(req.processedFiles[0].url).toContain('vehicles/1');
    });

    it('calls next immediately when no files', async () => {
      const mw = processAndSaveMultiple('vehicles/1');
      const req = mockReq({ files: [] });
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.processedFiles).toBeUndefined();
    });

    it('calls next(error) when sharp throws', async () => {
      const sharp = require('sharp');
      sharp.mockImplementationOnce(() => ({
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockRejectedValue(new Error('Sharp failed multi')),
      }));
      fs.existsSync.mockReturnValue(true);

      const mw = processAndSaveMultiple('vehicles/1');
      const req = mockReq({
        files: [{ buffer: Buffer.from('img1'), mimetype: 'image/jpeg', fieldname: 'photo1' }],
      });
      const next = mockNext();
      await mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('deleteFile', () => {
    it('deletes file when it exists', () => {
      fs.existsSync.mockReturnValue(true);
      deleteFile('/uploads/test/file.jpg');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('handles non-existent file gracefully', () => {
      fs.existsSync.mockReturnValue(false);
      expect(() => deleteFile('/uploads/test/missing.jpg')).not.toThrow();
    });

    it('handles null path gracefully', () => {
      expect(() => deleteFile(null)).not.toThrow();
    });

    it('handles unlinkSync throwing (caught internally)', () => {
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementationOnce(() => { throw new Error('Permission denied'); });
      expect(() => deleteFile('/uploads/test/file.jpg')).not.toThrow();
    });
  });
});
