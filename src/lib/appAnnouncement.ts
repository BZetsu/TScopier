import { supabase } from './supabase'

/** Row key in `app_settings` for the global announcement bar. */
export const APP_ANNOUNCEMENT_SETTING_KEY = 'announcement_message'

export type AppAnnouncementState = {
  enabled: boolean
  message: string | null
}

export const APP_ANNOUNCEMENT_DISABLED: AppAnnouncementState = { enabled: false, message: null }

export function resolveAppAnnouncementMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeAppAnnouncementRow(row: {
  enabled?: boolean | null
  message?: string | null
} | null | undefined): AppAnnouncementState {
  if (!row?.enabled) return APP_ANNOUNCEMENT_DISABLED
  const message = resolveAppAnnouncementMessage(row.message)
  if (!message) return APP_ANNOUNCEMENT_DISABLED
  return { enabled: true, message }
}

/** Load announcement flag + message from Supabase. */
export async function fetchAppAnnouncementState(): Promise<AppAnnouncementState> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('enabled,message')
    .eq('key', APP_ANNOUNCEMENT_SETTING_KEY)
    .maybeSingle()

  if (error) {
    console.warn('[appAnnouncement] load failed', error.message)
    return APP_ANNOUNCEMENT_DISABLED
  }

  return normalizeAppAnnouncementRow(data)
}
