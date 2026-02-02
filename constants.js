/**
 * Server-side constants
 * Centralized configuration for easy maintenance
 */

// Gmail Application Email - Only emails sent to this address are synced
export const APPLICATION_EMAIL = 'saatarkai@gmail.com';

// Gmail API Configuration
export const GMAIL_MAX_RESULTS = 20; // Max emails fetched per sync
export const GMAIL_MAX_EMAILS = 50; // Max emails for inbox list

// Auto-sync Configuration
// Default: 1 minute (60000ms) - automatic sync every 60 seconds
// Can be overridden via GMAIL_SYNC_INTERVAL_MS env var
export const GMAIL_SYNC_INTERVAL_MS = parseInt(
  process.env.GMAIL_SYNC_INTERVAL_MS || '60000',
  10
); // Default: 1 minute (60 seconds)

