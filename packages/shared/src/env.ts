type EnvReader = (key: string) => string | undefined

let envReader: EnvReader = () => undefined

/** Register platform env reader (Vite import.meta.env or Expo process.env). */
export function configureEnvReader(reader: EnvReader): void {
  envReader = reader
}

function readRaw(key: string): string {
  const value = envReader(key)
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** Read Supabase / worker public config (VITE_* on web, EXPO_PUBLIC_* on mobile). */
export function getEnv(key: string): string {
  const direct = readRaw(key)
  if (direct) return direct

  if (key.startsWith('VITE_')) {
    const expoKey = key.replace(/^VITE_/, 'EXPO_PUBLIC_')
    return readRaw(expoKey)
  }
  if (key.startsWith('EXPO_PUBLIC_')) {
    const viteKey = key.replace(/^EXPO_PUBLIC_/, 'VITE_')
    return readRaw(viteKey)
  }
  return ''
}

export function getSupabaseUrl(): string {
  return getEnv('VITE_SUPABASE_URL') || getEnv('EXPO_PUBLIC_SUPABASE_URL')
}

export function getSupabaseAnonKey(): string {
  return getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY')
}

export function getWorkerUrl(): string {
  return getEnv('VITE_WORKER_URL') || getEnv('EXPO_PUBLIC_WORKER_URL')
}

export function getAppScheme(): string {
  return getEnv('EXPO_PUBLIC_APP_SCHEME') || 'unicopier'
}
