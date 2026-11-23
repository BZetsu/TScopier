import { configureEnvReader } from './src/env'

/** Call once at web app boot (see src/main.tsx). */
export function configureWebEnv(): void {
  configureEnvReader((key: string) => {
    const viteKey = key.startsWith('EXPO_PUBLIC_')
      ? key.replace(/^EXPO_PUBLIC_/, 'VITE_')
      : key
    if (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env) {
      const fromMeta = (import.meta as { env?: Record<string, string> }).env?.[viteKey]
      if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim()
    }
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    const fromProcess = proc?.env?.[key] ?? proc?.env?.[viteKey]
    return typeof fromProcess === 'string' && fromProcess.trim() ? fromProcess.trim() : undefined
  })
}

export { configureEnvReader } from './src/env'
