/** Only known public license URLs are generated; user-provided labels remain text. */
export function imageLicenseUrl(license?: string): string | undefined {
  const value = (license ?? '').trim().replace(/-/g,' ').replace(/\s+/g,' ').toUpperCase();
  const match = /^CC BY( SA)? ([1234](?:\.\d)?)$/.exec(value);
  if (match) return `https://creativecommons.org/licenses/${match[1] ? 'by-sa' : 'by'}/${match[2].includes('.') ? match[2] : match[2]+'.0'}/`;
  if (/^CC0(?: 1\.0)?$/.test(value)) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (value === 'PUBLIC DOMAIN') return 'https://creativecommons.org/publicdomain/mark/1.0/';
}
