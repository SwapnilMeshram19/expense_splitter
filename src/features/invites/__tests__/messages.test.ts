import {
  buildShareMessage,
  describeInviteStatus,
  extractInviteCode,
  formatInviteCode,
  inviteUrl,
  isWellFormedInviteCode,
  normalizeInviteCode,
} from '../messages';

describe('invite codes', () => {
  it('normalizes and validates', () => {
    expect(normalizeInviteCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(isWellFormedInviteCode('ABCDEFGH')).toBe(true);
    expect(isWellFormedInviteCode('ABCDEFG')).toBe(false);
    expect(isWellFormedInviteCode('ABCDEFGO')).toBe(false); // O excluded
    expect(isWellFormedInviteCode('ABCDEFG1')).toBe(false); // 1 excluded
    expect(isWellFormedInviteCode('ABCDEFGI')).toBe(false); // I excluded
  });

  it('formats for display and links', () => {
    expect(formatInviteCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(inviteUrl('ABCDEFGH')).toBe('https://split.ssoftapp.in/join/?code=ABCD-EFGH');
  });

  it('extracts a code from a pasted link or the whole share message', () => {
    expect(extractInviteCode('https://split.ssoftapp.in/join/?code=ABCD-EFGH')).toBe('ABCDEFGH');
    expect(extractInviteCode(buildShareMessage('Goa', 'WXYZ2345'))).toBe('WXYZ2345');
    expect(extractInviteCode('code is abcd-efgh thanks')).toBe('ABCDEFGH');
    expect(extractInviteCode('  abcd efgh ')).toBe('ABCDEFGH');
  });

  it('never mistakes ordinary words for a code', () => {
    expect(extractInviteCode('split the expenses please')).toBeNull();
    expect(extractInviteCode('EXPENSES today')).toBeNull();
    expect(extractInviteCode('')).toBeNull();
  });

  it('builds a share message with the link and the code', () => {
    const message = buildShareMessage('Goa Trip', 'ABCDEFGH');
    expect(message).toContain('“Goa Trip”');
    expect(message).toContain('https://split.ssoftapp.in/join/?code=ABCD-EFGH');
    expect(message).toContain('ABCD-EFGH');
  });

  it('explains every failure plainly', () => {
    expect(describeInviteStatus('EXPIRED')).toMatch(/expired/);
    expect(describeInviteStatus('RATE_LIMITED')).toMatch(/10 minutes/);
    expect(describeInviteStatus('ALREADY_CLAIMED')).toMatch(/picked that name/);
    expect(describeInviteStatus('OFFLINE')).toMatch(/internet/);
    expect(describeInviteStatus('SERVER')).toMatch(/Something went wrong/);
  });
});