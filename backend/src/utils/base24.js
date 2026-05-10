const ALPHABET = '0123456789ABCDEFGHIJKLMN';
const BASE = 24;

function encodeBase24(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('encodeBase24: positive integer required');
  if (n === 0) return '0';
  let s = '';
  let x = n;
  while (x > 0) {
    s = ALPHABET[x % BASE] + s;
    x = Math.floor(x / BASE);
  }
  return s;
}

function decodeBase24(s) {
  if (typeof s !== 'string' || s.length === 0) throw new Error('decodeBase24: non-empty string required');
  let n = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`decodeBase24: invalid char "${ch}"`);
    n = n * BASE + v;
  }
  return n;
}

function formatId(counter, postePrefix = 1) {
  if (!Number.isInteger(postePrefix) || postePrefix < 0 || postePrefix > 9) {
    throw new Error('formatId: postePrefix must be 0-9');
  }
  const enc = encodeBase24(counter).padStart(4, '0');
  if (enc.length > 4) throw new Error(`formatId: counter ${counter} overflows 4 base24 chars`);
  return `P${postePrefix}${enc}`;
}

function parseId(code) {
  if (typeof code !== 'string' || !/^P[0-9][0-9A-N]{4}$/.test(code)) {
    return null;
  }
  return {
    poste: parseInt(code[1], 10),
    counter: decodeBase24(code.slice(2)),
  };
}

module.exports = { encodeBase24, decodeBase24, formatId, parseId, ALPHABET };
