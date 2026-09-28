// Every dollar amount, per-unit prices and averages included, is shown in cents: the owner asked
// for 2 decimals everywhere. Prices are still stored with up to 8 decimals.
export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Discord renders this in each viewer's own locale and time zone.
export const date = (unix: number) => `<t:${unix}:D>`;
