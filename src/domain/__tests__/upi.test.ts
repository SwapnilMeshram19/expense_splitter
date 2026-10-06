import {
  buildUpiPayUri,
  maskVpa,
  MAX_VPA_LENGTH,
  paiseToUpiAmount,
  parseVpaInput,
  sanitizeUpiText,
} from '../upi';

describe('parseVpaInput', () => {
  it.each([
    ['rahul.k@okaxis', 'rahul.k@okaxis'],
    ['  Rahul.K@OkAxis ', 'rahul.k@okaxis'],
    ['98765 43210@ybl', '9876543210@ybl'],
    ['upi://pay?pa=asha%40ybl&pn=Asha&am=10.00', 'asha@ybl'],
    ['UPI://pay?pn=Asha&pa=Asha@YBL', 'asha@ybl'],
  ])('accepts %p', (input, vpa) => {
    expect(parseVpaInput(input)).toEqual({ ok: true, vpa });
  });

  it.each([
    ['', 'VPA_REQUIRED'],
    ['   ', 'VPA_REQUIRED'],
    ['rahul', 'VPA_INVALID'],
    ['@ybl', 'VPA_INVALID'],
    ['rahul@', 'VPA_INVALID'],
    ['rahul@y', 'VPA_INVALID'],
    ['rahul@1bl', 'VPA_INVALID'],
    ['rahul@ybl@x', 'VPA_INVALID'],
    ['rahul@ybl&am=1', 'VPA_INVALID'],
    ['upi://pay?pn=NoPayee', 'VPA_INVALID'],
    ['upi://pay?pa=%E0%A4', 'VPA_INVALID'],
  ])('rejects %p', (input, code) => {
    expect(parseVpaInput(input)).toEqual({ ok: false, error: { code } });
  });

  it('rejects over-long IDs', () => {
    expect(parseVpaInput(`${'a'.repeat(MAX_VPA_LENGTH)}@ybl`)).toEqual({
      ok: false,
      error: { code: 'VPA_TOO_LONG', max: MAX_VPA_LENGTH },
    });
  });
});

describe('paiseToUpiAmount', () => {
  it.each([
    [1, '0.01'],
    [100, '1.00'],
    [30050, '300.50'],
    [123456, '1234.56'],
    [10_000_000, '100000.00'],
  ])('%p paise → %p', (paise, text) => {
    expect(paiseToUpiAmount(paise)).toBe(text);
  });

  it.each([0, -100, 10.5, Number.NaN])('throws on %p', (paise) => {
    expect(() => paiseToUpiAmount(paise)).toThrow(RangeError);
  });
});

describe('buildUpiPayUri', () => {
  it('builds an exact-amount P2P link with an unencoded pa', () => {
    expect(
      buildUpiPayUri({ payeeVpa: 'rahul.k@okaxis', payeeName: 'Rahul K', amountPaise: 30050, note: 'Goa trip' }),
    ).toBe('upi://pay?pa=rahul.k@okaxis&pn=Rahul%20K&am=300.50&cu=INR&tn=Goa%20trip');
  });

  it('drops unsafe characters and omits empty params', () => {
    expect(buildUpiPayUri({ payeeVpa: 'x@ybl', payeeName: 'राहुल', amountPaise: 100, note: '🎉' })).toBe(
      'upi://pay?pa=x@ybl&am=1.00&cu=INR',
    );
    expect(buildUpiPayUri({ payeeVpa: 'x@ybl', payeeName: 'A&B', amountPaise: 100, note: '&am=1' })).toBe(
      'upi://pay?pa=x@ybl&pn=A%20B&am=1.00&cu=INR&tn=am%201',
    );
  });

  it('refuses an invalid stored VPA (no parameter injection)', () => {
    expect(() => buildUpiPayUri({ payeeVpa: 'x@ybl&am=1', payeeName: 'X', amountPaise: 100 })).toThrow();
  });
});

describe('helpers', () => {
  it('masks UPI IDs', () => {
    expect(maskVpa('9876543210@ybl')).toBe('98•••@ybl');
    expect(maskVpa('abc@ybl')).toBe('a•••@ybl');
  });

  it('caps sanitized text', () => {
    expect(sanitizeUpiText('  a   b  ', 10)).toBe('a b');
    expect(sanitizeUpiText('x'.repeat(60), 50)).toHaveLength(50);
  });
});