'use strict';

const { handleValidation } = require('../../../middleware/validate.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { validationResult } = require('express-validator');

jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
}));

describe('validate.middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls next when no validation errors', () => {
    validationResult.mockReturnValue({ isEmpty: () => true });
    const next = mockNext();
    handleValidation(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 422 with errors when validation fails', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ path: 'email', msg: 'required' }],
    });
    const res = mockRes();
    handleValidation(mockReq(), res, mockNext());
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res._json.errors[0].field).toBe('email');
  });
});
