// RFC 4180 quoting plus a guard against spreadsheet formula injection (=, +, -, @ ...).
const cell = (v: unknown) => {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = <T extends object>(
  rows: T[],
  columns: (keyof T & string)[],
) =>
  [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => cell(r[c])).join(',')),
  ].join('\r\n') + '\r\n';
