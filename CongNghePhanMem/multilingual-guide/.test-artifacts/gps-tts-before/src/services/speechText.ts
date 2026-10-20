// Preserve all text and Unicode code points while respecting device utterance limits.
export function splitSpeechText(text: string, limit = 750): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid speech chunk size');
  const points = Array.from(text);
  const chunks: string[] = [];
  for (let start = 0; start < points.length;) {
    let end = Math.min(points.length, start + limit);
    if (end < points.length) {
      for (let boundary = end; boundary > start + Math.floor(limit / 2); boundary--) {
        if (/[\s.!?。！？]/u.test(points[boundary - 1])) { end = boundary; break; }
      }
    }
    chunks.push(points.slice(start, end).join(''));
    start = end;
  }
  return chunks;
}
