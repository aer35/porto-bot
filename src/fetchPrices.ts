import { fetchPrices } from './components/prices.js';

// Usage, inside the running container: docker compose exec porto-bot node dist/fetchPrices.js
// Runs the price fetch once, now, for testing. The bot does this by itself at startup and every 10 minutes while the market is open.
const { fetched, missing } = await fetchPrices();
console.log(`Stored ${fetched} prices.${missing.length ? ` No price for: ${missing.join(', ')}.` : ''}`);
