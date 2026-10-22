// Preserve all text and Unicode code points while respecting device utterance limits.
export function splitSpeechText(text: string, limit = 750): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid speech chunk size');
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + limit);
    // Native and browser limits count UTF-16 units, not Unicode code points.
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
    if (end === start) throw new Error('Speech chunk size cannot fit a Unicode character');
    if (end < text.length) {
      for (let boundary = end; boundary > start + Math.floor(limit / 2); boundary--) {
        if (/[\s.!?。！？]/u.test(text[boundary - 1])) { end = boundary; break; }
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
