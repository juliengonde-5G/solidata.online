const { encodeBase24, decodeBase24, formatId, parseId, ALPHABET } = require('../../../src/utils/base24');

describe('base24', () => {
  describe('encodeBase24', () => {
    it('encodes 0 as "0"', () => expect(encodeBase24(0)).toBe('0'));
    it('encodes 23 as "N"', () => expect(encodeBase24(23)).toBe('N'));
    it('encodes 24 as "10"', () => expect(encodeBase24(24)).toBe('10'));
    it('encodes 575 as "NN"', () => expect(encodeBase24(575)).toBe('NN'));
    it('encodes 576 as "100"', () => expect(encodeBase24(576)).toBe('100'));
    it('matches Excel BASE(10493,24) = "I55"', () => expect(encodeBase24(10493)).toBe('I55'));
    it('encodes 331775 as "NNNN" (max 4-char)', () => expect(encodeBase24(331775)).toBe('NNNN'));
    it('rejects negative numbers', () => expect(() => encodeBase24(-1)).toThrow());
    it('rejects non-integers', () => expect(() => encodeBase24(1.5)).toThrow());
  });

  describe('decodeBase24', () => {
    it('decodes "0" to 0', () => expect(decodeBase24('0')).toBe(0));
    it('decodes "N" to 23', () => expect(decodeBase24('N')).toBe(23));
    it('decodes "10" to 24', () => expect(decodeBase24('10')).toBe(24));
    it('decodes "I55" to 10493', () => expect(decodeBase24('I55')).toBe(10493));
    it('decodes "NNNN" to 331775', () => expect(decodeBase24('NNNN')).toBe(331775));
    it('decodes "0I55" same as "I55"', () => expect(decodeBase24('0I55')).toBe(decodeBase24('I55')));
    it('rejects invalid chars', () => expect(() => decodeBase24('XZ')).toThrow());
    it('rejects empty string', () => expect(() => decodeBase24('')).toThrow());
  });

  describe('formatId', () => {
    it('produces "P10000" for counter 0', () => expect(formatId(0, 1)).toBe('P10000'));
    it('produces "P10001" for counter 1', () => expect(formatId(1, 1)).toBe('P10001'));
    it('produces "P10I55" for counter 10493 poste 1 (matches Excel)', () => expect(formatId(10493, 1)).toBe('P10I55'));
    it('produces "P2NNNN" for counter 331775 poste 2', () => expect(formatId(331775, 2)).toBe('P2NNNN'));
    it('throws when counter overflows', () => expect(() => formatId(331776, 1)).toThrow());
    it('rejects invalid poste', () => expect(() => formatId(1, 10)).toThrow());
  });

  describe('parseId', () => {
    it('parses "P10I55" correctly', () => expect(parseId('P10I55')).toEqual({ poste: 1, counter: 10493 }));
    it('parses "P10000" correctly', () => expect(parseId('P10000')).toEqual({ poste: 1, counter: 0 }));
    it('parses "P2NNNN" correctly', () => expect(parseId('P2NNNN')).toEqual({ poste: 2, counter: 331775 }));
    it('returns null for malformed input', () => {
      expect(parseId('XXXX')).toBeNull();
      expect(parseId('P1ZZZZ')).toBeNull();
      expect(parseId('')).toBeNull();
      expect(parseId(null)).toBeNull();
    });
  });

  describe('ALPHABET', () => {
    it('has 24 characters', () => expect(ALPHABET).toHaveLength(24));
    it('starts with 0-9 then A-N', () => expect(ALPHABET).toBe('0123456789ABCDEFGHIJKLMN'));
  });

  describe('round-trip', () => {
    it.each([0, 1, 23, 24, 100, 575, 576, 10493, 50000, 331775])(
      'encodes & decodes %i symmetrically', (n) => {
        expect(decodeBase24(encodeBase24(n))).toBe(n);
      }
    );
  });
});
