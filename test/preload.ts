/** Stub Vite env for node:test runs outside the Vite bundler. */
process.env.VITE_SUPABASE_URL ??= 'http://localhost:54321'
process.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key'
