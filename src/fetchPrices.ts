import { fetchPrices } from './components/prices.js';

// Usage: node dist/fetchPrices.js
// Runs the nightly price fetch once, now. The bot does this by itself every evening.
const { fetched, missing } = await fetchPrices();
console.log(`Stored ${fetched} prices.${missing.length ? ` No price for: ${missing.join(', ')}.` : ''}`);
