// Loads .env into process.env before any config-dependent module evaluates.
// Import this first from every entry point.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on real environment variables.
}
