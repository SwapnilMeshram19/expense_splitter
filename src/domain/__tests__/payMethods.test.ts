import {
  asciiFold,
  buildEpcPayload,
  buildPayNowPayload,
  buildPixPayload,
  buildPromptPayPayload,
  crc16Ccitt,
  isValidIban,
  linkDisplay,
  linkProvider,
  methodShareLine,
  methodSummary,
  minorToDecimal,
  normalizePayNowProxy,
  normalizePixKey,
  normalizePromptPayId,
  parsePayMethods,
  payLinkFor,
  samePayMethod,
  serializePayMethods,
  validatePayMethod,
  worksForCurrency,
  type PayMethod,
} from '../payMethods';

describe('crc16Ccitt', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16Ccitt('123456789')).toBe('29B1');
  });
});

describe('Pix', () => {
  it('reproduces the Banco Central sample byte for byte', () => {
    expect(
      buildPixPayload({
        key: '123e4567-e12b-12d1-a456-426655440000',
        name: 'Fulano de Tal',
        city: 'BRASILIA',
        amountCentavos: 0,
      }),
    ).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000' +
        '5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    );
  });

  it('adds the amount and folds accents', () => {
    const code = buildPixPayload({ key: '111.222.333-44', name: 'José Conceição', city: 'São Paulo', amountCentavos: 2575 });
    expect(code).toContain('0111' + '11122233344');
    expect(code).toContain('540525.75');
    expect(code).toContain('5914Jose Conceicao');
    expect(code).toContain('6009Sao Paulo');
    expect(code.slice(-4)).toBe(crc16Ccitt(code.slice(0, -4)));
  });

  it('normalizes each key type', () => {
    expect(normalizePixKey('123.456.789-01')).toEqual({ key: '12345678901', type: 'cpf' });
    expect(normalizePixKey('12.345.678/0001-95')).toEqual({ key: '12345678000195', type: 'cnpj' });
    expect(normalizePixKey('+55 (11) 98765-4321')).toEqual({ key: '+5511987654321', type: 'phone' });
    expect(normalizePixKey('Ana@Example.com')).toEqual({ key: 'ana@example.com', type: 'email' });
    expect(normalizePixKey('nope')).toBeNull();
    expect(normalizePixKey('+1 555 123 4567')).toBeNull();
  });
});

describe('PromptPay', () => {
  it('builds a mobile-number payload with 0066 and the amount', () => {
    const code = buildPromptPayPayload({ id: '081-234-5678', amountSatang: 0 });
    expect(code.startsWith('000201010211' + '29370016A000000677010111' + '01130066812345678' + '5802TH5303764' + '6304')).toBe(true);
    const withAmount = buildPromptPayPayload({ id: '+66812345678', amountSatang: 15000 });
    expect(withAmount).toContain('010212');
    expect(withAmount).toContain('5406150.00');
    expect(withAmount.slice(-4)).toBe(crc16Ccitt(withAmount.slice(0, -4)));
  });

  it('accepts a 13-digit national ID', () => {
    expect(buildPromptPayPayload({ id: '1234567890123', amountSatang: 0 })).toContain('02131234567890123');
    expect(normalizePromptPayId('12345')).toBeNull();
  });
});

describe('PayNow', () => {
  it('builds a fixed-amount mobile payload', () => {
    const code = buildPayNowPayload({ proxy: '9123 4567', name: 'Tan Wei', amountCents: 1050 });
    expect(code).toContain('26380009SG.PAYNOW' + '010100211+6591234567' + '03010' + '52040000');
    expect(code).toContain('5303702540510.505802SG');
    expect(code.slice(-4)).toBe(crc16Ccitt(code.slice(0, -4)));
  });

  it('tells mobiles and UENs apart', () => {
    expect(normalizePayNowProxy('+65 8123 4567')).toEqual({ proxy: '+6581234567', type: 'mobile' });
    expect(normalizePayNowProxy('201912345k')).toEqual({ proxy: '201912345K', type: 'uen' });
    expect(normalizePayNowProxy('12345678')).toBeNull();
  });
});

describe('IBAN and EPC', () => {
  it('validates IBAN check digits', () => {
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isValidIban('DE89370400440532013001')).toBe(false);
    expect(isValidIban('DE89')).toBe(false);
  });

  it('builds a version 002 UTF-8 EPC payload', () => {
    expect(
      buildEpcPayload({ name: 'Jürgen Müller', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', amountCents: 1250, message: 'Goa  trip' }),
    ).toBe('BCD\n002\n1\nSCT\nCOBADEFFXXX\nJürgen Müller\nDE89370400440532013000\nEUR12.50\n\n\nGoa trip');
  });

  it('refuses amounts EPC does not allow', () => {
    expect(() => buildEpcPayload({ name: 'A', iban: 'DE89370400440532013000', amountCents: 0, message: '' })).toThrow();
  });
});

describe('links', () => {
  it('recognises providers', () => {
    expect(linkProvider('https://paypal.me/rahul')).toBe('paypal');
    expect(linkProvider('https://www.paypal.com/paypalme/rahul')).toBe('paypal');
    expect(linkProvider('https://revolut.me/rahul')).toBe('revolut');
    expect(linkProvider('https://wise.com/pay/me/rahulk')).toBe('wise');
    expect(linkProvider('https://cash.app/$rahul')).toBe('cashapp');
    expect(linkProvider('https://example.com/pay')).toBe('other');
  });

  it('prefills PayPal.me in supported currencies only', () => {
    expect(payLinkFor('https://paypal.me/rahul', 4550, 'USD', 2)).toEqual({ url: 'https://paypal.me/rahul/45.50USD', amountIncluded: true });
    expect(payLinkFor('https://paypal.me/rahul', 4550, 'INR', 2).amountIncluded).toBe(false);
    expect(payLinkFor('https://revolut.me/rahul', 4550, 'EUR', 2)).toEqual({ url: 'https://revolut.me/rahul', amountIncluded: false });
  });

  it('accepts a bare domain but never http, javascript or credentials', () => {
    expect(validatePayMethod({ kind: 'link', url: 'paypal.me/rahul' })).toEqual({ ok: true, method: { kind: 'link', url: 'https://paypal.me/rahul' } });
    expect(validatePayMethod({ kind: 'link', url: 'http://paypal.me/rahul' }).ok).toBe(false);
    expect(validatePayMethod({ kind: 'link', url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(validatePayMethod({ kind: 'link', url: 'https://paypal.me@evil.example/x' }).ok).toBe(false);
    expect(linkDisplay('https://paypal.me/rahul/?x=1')).toBe('paypal.me/rahul');
  });
});

describe('parsePayMethods', () => {
  const good: PayMethod[] = [
    { kind: 'link', url: 'https://paypal.me/rahul' },
    { kind: 'iban', name: 'Rahul K', iban: 'DE89370400440532013000' },
  ];

  it('round-trips through the column', () => {
    expect(parsePayMethods(serializePayMethods(good))).toEqual(good);
    expect(serializePayMethods([])).toBeNull();
  });

  it('drops anything invalid from another phone', () => {
    expect(
      parsePayMethods([
        ...good,
        { kind: 'link', url: 'http://paypal.me/x' },
        { kind: 'link', url: 'paypal.me/x' },
        { kind: 'iban', name: 'X', iban: 'DE00' },
        { kind: 'crypto', address: 'x' },
        { kind: 'bank', text: 'a\u0000b' },
        'nope',
      ]),
    ).toEqual(good);
    expect(parsePayMethods('not json')).toEqual([]);
    expect(parsePayMethods(null)).toEqual([]);
  });
});

describe('describing', () => {
  it('filters by currency', () => {
    expect(worksForCurrency({ kind: 'pix', key: 'a@b.co', name: 'A', city: '' }, 'BRL')).toBe(true);
    expect(worksForCurrency({ kind: 'pix', key: 'a@b.co', name: 'A', city: '' }, 'USD')).toBe(false);
    expect(worksForCurrency({ kind: 'link', url: 'https://paypal.me/a' }, 'JPY')).toBe(true);
  });

  it('summarises without leaking whole account numbers', () => {
    expect(methodSummary({ kind: 'iban', name: 'A', iban: 'DE89370400440532013000' })).toBe('DE89 3704 … 3000');
    expect(methodShareLine({ kind: 'iban', name: 'A', iban: 'DE89370400440532013000' })).toBe('IBAN: DE89 3704 0044 0532 0130 00 (A)');
  });

  it('spots the same account', () => {
    expect(samePayMethod({ kind: 'link', url: 'https://paypal.me/Rahul' }, { kind: 'link', url: 'https://www.paypal.me/rahul/' })).toBe(true);
  });

  it('formats amounts exactly', () => {
    expect(minorToDecimal(5, 2)).toBe('0.05');
    expect(minorToDecimal(1500, 0)).toBe('1500');
    expect(asciiFold('Ünïcodé!')).toBe('Unicode');
  });
});
