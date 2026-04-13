import { describe, it, expect, vi } from 'vitest';
import { getImageUrl } from '../../../utils/imageUtils';

describe('imageUtils', () => {
  describe('getImageUrl', () => {
    it('prepends API URL to path', () => {
      const url = getImageUrl('/uploads/test/img.jpg');
      expect(url).toContain('/uploads/test/img.jpg');
    });

    it('handles null/undefined path', () => {
      expect(getImageUrl(null)).toBeFalsy();
    });
  });
});
