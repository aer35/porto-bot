// How each security type stores its quantity. Quantities are whole numbers at the type's scale,
// so ledger math never meets floating-point error: 12.785 shares is 12,785, 0.00034 BTC is 34,000.
// SQLite has no exact decimal column type (a DECIMAL column silently stores a float), which is
// why the scale lives here and the column stays INTEGER.
//
//   scale       stored units per whole unit, a power of 10
//   decimals    most decimals a typed quantity may have; at most log10(scale), and less for crypto
//   shown       decimals displayed, truncated rather than rounded, so a holding never looks bigger
//               than it is; the stored value keeps full precision
//   multiplier  units of the underlying one quantity unit prices: an option contract covers 100
//               shares and its price is quoted per share, so it costs 100 × price. Paper trading
//               never exercises, so this only ever applies to dollar amounts
//
// The rule for every quantity: prices are per whole unit, so a dollar amount divides by the scale
// once (see value). Math on quantities alone, like average cost or a split ratio, needs no scaling.
export const units = {
  // Thousandths of a share since migrations/2026092800_stock_thousandths.sql (hundredths before).
  STOCK: { scale: 1000, decimals: 3, shown: 3, multiplier: 1 },
  // Stored to the satoshi, typed to 6 decimals. The scale stayed at 8 decimals when the typed limit
  // dropped to 6, so amounts recorded earlier keep their precision without a migration. Deliberate
  // limit: the largest storable amount is about 90 million coins, where the scaled value passes
  // Number.MAX_SAFE_INTEGER; bigger amounts are rejected.
  CRYPTO: { scale: 100_000_000, decimals: 6, shown: 6, multiplier: 1 },
  // Whole contracts only.
  OPTION: { scale: 1, decimals: 0, shown: 0, multiplier: 100 },
};

export type Holdable = keyof typeof units;

// A quantity from a Discord number option, stored at the type's scale. Null for 0 or less, more
// decimals than the type allows, or too big to store exactly. toFixed round-trips exactly when the
// number has few enough decimals, and unlike String() never switches to 3.4e-7 notation; Math.round
// then absorbs the float error in the multiply (0.29 * 100 is 28.999999999999996).
export function toScaled(amount: number, type: Holdable) {
  const { scale, decimals } = units[type];
  if (!(amount > 0) || Number(amount.toFixed(decimals)) !== amount) return null;
  const scaled = Math.round(amount * scale);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

// A typed quantity from the /amend modal, like "12.785", by the same rules as toScaled.
export function parseQuantity(input: string, type: Holdable) {
  const trimmed = input.trim();
  const { decimals } = units[type];
  const pattern = decimals ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
  return pattern.test(trimmed) ? toScaled(Number(trimmed), type) : null;
}

// Plain decimal text for a stored quantity, which parseQuantity reads back: 34000 CRYPTO → "0.00034".
// Written to the full stored precision, so crypto recorded with 8 decimals shows all 8 rather than
// being rounded (parseQuantity then rejects it until it is cut to 6). Only text with a decimal point
// loses trailing zeros, so 20 contracts stay "20".
export function quantityText(quantity: number, type: Holdable) {
  const { scale } = units[type];
  const decimals = Math.log10(scale);
  const fixed = (quantity / scale).toFixed(decimals);
  return decimals ? fixed.replace(/\.?0+$/, '') : fixed;
}

// Dollars for a stored quantity at a per-unit price.
export const value = (type: Holdable, quantity: number, price: number) =>
  (quantity * price * units[type].multiplier) / units[type].scale;

// The per-unit price that makes `total` dollars for a stored quantity: the inverse of value. Crypto
// is entered as what was paid in total ("0.00001 BTC for $100"), but stored per coin like every
// other price, so average cost, P/L and market prices all work the same way.
export const unitPrice = (type: Holdable, quantity: number, total: number) =>
  (total * units[type].scale) / (quantity * units[type].multiplier);

// A stored quantity for display: 12785 STOCK → "12.785", 123456789 CRYPTO → "1.234567".
export function formatQuantity(type: Holdable, quantity: number) {
  const { scale, shown } = units[type];
  const truncated = Math.trunc(quantity / (scale / 10 ** shown)) / 10 ** shown;
  return truncated.toLocaleString('en-US', { maximumFractionDigits: shown });
}
