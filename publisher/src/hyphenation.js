// Liang's hyphenation algorithm (as used by TeX), driven by the en-US pattern
// set. A word is dotted (".word."), every substring is looked up in a pattern
// trie, the digit values are max-combined at each inter-letter position, and a
// break is legal where the combined value is odd (subject to left/right minima
// and an exception list).
import { PATTERNS, EXCEPTIONS } from './hyphenation-en.js';

const VALUES = '$'; // trie node key holding a pattern's value array

// Build the pattern trie once at module load.
const trie = (() => {
  const root = {};
  for (const pat of PATTERNS.split(/\s+/)) {
    if (!pat) continue;
    let letters = '';
    const values = [0];
    for (const ch of pat) {
      if (ch >= '0' && ch <= '9') values[values.length - 1] = +ch;
      else { letters += ch; values.push(0); }
    }
    let node = root;
    for (const ch of letters) node = node[ch] || (node[ch] = {});
    node[VALUES] = values; // values.length === letters.length + 1
  }
  return root;
})();

// Exceptions: explicit break points (may be empty → never hyphenate the word).
const exceptions = (() => {
  const map = new Map();
  for (const entry of EXCEPTIONS.split(/\s+/)) {
    if (!entry) continue;
    let word = ''; const pts = [];
    for (const ch of entry) { if (ch === '-') pts.push(word.length); else word += ch; }
    map.set(word, pts);
  }
  return map;
})();

// Return the allowed break positions (prefix lengths) for a lowercased word.
export function hyphenateWord(word, leftMin = 2, rightMin = 3) {
  const lower = word.toLowerCase();
  const len = lower.length;
  if (len < leftMin + rightMin) return [];
  if (exceptions.has(lower)) return exceptions.get(lower).filter((p) => p >= leftMin && len - p >= rightMin);

  const w = '.' + lower + '.';
  const n = w.length;
  const points = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    let node = trie;
    for (let j = i; j < n; j++) {
      node = node[w[j]];
      if (!node) break;
      const v = node[VALUES];
      if (v) for (let k = 0; k < v.length; k++) { const idx = i + k; if (idx <= n && points[idx] < v[k]) points[idx] = v[k]; }
    }
  }
  // Break between lower[p-1] and lower[p] (prefix length p) is governed by
  // points[p + 1] because of the leading "." in the dotted word.
  const res = [];
  for (let p = leftMin; p <= len - rightMin; p++) if (points[p + 1] % 2 === 1) res.push(p);
  return res;
}
