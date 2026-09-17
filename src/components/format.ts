export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

// Discord renders this in each viewer's own locale and time zone.
export const date = (unix: number) => `<t:${unix}:D>`;

// Monospace table in a code block. The first column is left-aligned, the rest right-aligned (numbers).
// Code blocks do not render <t:> timestamps, so only use this for rows without dates.
export function table(rows: string[][]) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
  const lines = rows.map((row) =>
    row.map((cell, col) => (col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col]))).join('  '),
  );
  return '```\n' + lines.join('\n') + '\n```';
}
