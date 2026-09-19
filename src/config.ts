// Docker Compose injects env vars directly; running outside Docker reads .env from the repo root.
try {
  process.loadEnvFile();
} catch {}

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DB_PATH'] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
  process.exit(1);
}

const tz = process.env.TZ || 'America/New_York';
try {
  new Intl.DateTimeFormat('en-US', { timeZone: tz });
} catch {
  console.error(`TZ "${tz}" is not a valid IANA time zone, e.g. America/New_York.`);
  process.exit(1);
}

export const config = {
  token: process.env.DISCORD_TOKEN!,
  clientId: process.env.DISCORD_CLIENT_ID!,
  guildId: process.env.DISCORD_GUILD_ID!,
  dbPath: process.env.DB_PATH!,
  tz,
};
