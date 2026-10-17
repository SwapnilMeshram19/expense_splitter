import {
  bankLines,
  defaultBankCodeType,
  formatBankCode,
  isValidIfsc,
  methodShareLine,
  methodSummary,
  methodTitle,
  normalizeBankCode,
  parsePayMethods,
  samePayMethod,
  validatePayMethod,
  type PayMethod,
} from '../payMethods';

const indian: PayMethod = {
  kind: 'bank',
  text: '',
  name: '  Rahul   Sharma ',
  account: '5010 0123 4567 89',
  code: 'hdfc0001234',
  codeType: 'ifsc',
  bankName: 'HDFC Bank',
};

describe('structured bank details', () => {
  it('normalises an Indian account', () => {
    const r = validatePayMethod(indian);
    expect(r).toEqual({
      ok: true,
      method: {
        kind: 'bank',
        text: '',
        name: 'Rahul Sharma',
        account: '50100123456789',
        code: 'HDFC0001234',
        codeType: 'ifsc',
        bankName: 'HDFC Bank',
      },
    });
  });

  it('needs the holder name with an account number', () => {
    expect(validatePayMethod({ ...indian, name: ' ' })).toEqual({ ok: false, error: 'NAME_REQUIRED' });
  });

  it('needs the IFSC with an Indian account number', () => {
    expect(validatePayMethod({ ...indian, code: '' })).toEqual({ ok: false, error: 'BANK_CODE_REQUIRED' });
  });

  it('rejects a bad IFSC and a bad Indian account number', () => {
    expect(validatePayMethod({ ...indian, code: 'HDFC1001234' })).toEqual({ ok: false, error: 'BANK_CODE_INVALID' });
    expect(validatePayMethod({ ...indian, account: '12345' })).toEqual({ ok: false, error: 'ACCOUNT_INVALID' });
    expect(validatePayMethod({ ...indian, account: '1234ABCD9999' })).toEqual({ ok: false, error: 'ACCOUNT_INVALID' });
  });

  it('accepts other countries without a code, and validates codes that are given', () => {
    const us: PayMethod = { kind: 'bank', text: '', name: 'Amy', account: '000123456789', codeType: 'routing' };
    expect(validatePayMethod(us).ok).toBe(true);
    expect(validatePayMethod({ ...us, code: '12345' })).toEqual({ ok: false, error: 'BANK_CODE_INVALID' });
    const uk = validatePayMethod({ kind: 'bank', text: '', name: 'Tom', account: '31926819', code: '60-16-13', codeType: 'sort' });
    expect(uk.ok && uk.method.kind === 'bank' && uk.method.code).toBe('601613');
  });

  it('asks for the account number when only other fields are filled', () => {
    expect(validatePayMethod({ kind: 'bank', text: '', name: 'Rahul', codeType: 'ifsc' })).toEqual({
      ok: false,
      error: 'ACCOUNT_REQUIRED',
    });
    expect(validatePayMethod({ kind: 'bank', text: '' })).toEqual({ ok: false, error: 'TEXT_REQUIRED' });
  });

  it('still accepts the older free-text form', () => {
    expect(validatePayMethod({ kind: 'bank', text: 'BSB 062-000, acct 1234 5678' })).toEqual({
      ok: true,
      method: { kind: 'bank', text: 'BSB 062-000, acct 1234 5678' },
    });
  });

  it('round-trips through storage; an unknown code type (newer build) reads as a generic code', () => {
    const r = validatePayMethod(indian);
    if (!r.ok) throw new Error('invalid');
    expect(parsePayMethods(JSON.stringify([r.method]))).toEqual([r.method]);
    expect(parsePayMethods([{ ...r.method, codeType: 'clabe' }])).toEqual([{ ...r.method, codeType: 'other' }]);
  });

  it('describes it for the list, the Pay screen and messages', () => {
    const r = validatePayMethod({ ...indian, text: 'Savings account' });
    if (!r.ok || r.method.kind !== 'bank') throw new Error('invalid');
    expect(methodTitle(r.method)).toBe('HDFC Bank');
    expect(methodSummary(r.method)).toBe('Rahul Sharma · A/c ••6789');
    expect(bankLines(r.method).map((l) => l.label)).toEqual(['Name', 'A/c', 'IFSC', 'Bank', '']);
    expect(methodShareLine(r.method)).toBe(
      'Bank: Name Rahul Sharma, A/c 50100123456789, IFSC HDFC0001234, Bank HDFC Bank, Savings account',
    );
  });

  it('treats the same account as one method', () => {
    const a = validatePayMethod(indian);
    const b = validatePayMethod({ ...indian, bankName: 'HDFC', name: 'R Sharma' });
    if (!a.ok || !b.ok) throw new Error('invalid');
    expect(samePayMethod(a.method, b.method)).toBe(true);
  });
});

describe('bank code helpers', () => {
  it('validates IFSC', () => {
    expect(isValidIfsc('SBIN0005943')).toBe(true);
    expect(isValidIfsc('SBIN5005943')).toBe(false);
  });

  it('formats sort codes and BSBs', () => {
    expect(formatBankCode(normalizeBankCode('60 16 13', 'sort'), 'sort')).toBe('60-16-13');
    expect(formatBankCode('062000', 'bsb')).toBe('062-000');
  });

  it('picks the usual code for the home currency', () => {
    expect(defaultBankCodeType('INR')).toBe('ifsc');
    expect(defaultBankCodeType('GBP')).toBe('sort');
    expect(defaultBankCodeType('EUR')).toBe('swift');
  });
});
