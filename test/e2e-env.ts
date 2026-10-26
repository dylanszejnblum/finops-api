// Loaded before the spec (jest setupFiles): module conditions read process.env at import time.
process.env.API_KEYS ??= 'e2e-admin';
process.env.LOG_LEVEL ??= 'silent';
process.env.SYNC_INTERVAL_MINUTES = '0'; // tests trigger sync explicitly
