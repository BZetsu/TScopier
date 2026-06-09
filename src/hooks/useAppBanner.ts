import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const REFRESH_MS = 5 * 60_000

export type AppBannerState = {
  enabled: boolean
  message: string | null
}

/**
 * Global information banner controlled from the `app_settings` table
 * (key = 'banner_message'). Shown at the top of the app while `enabled` is true.
 */
export function useAppBanner(): AppBannerState {
  const [banner, setBanner] = useState<AppBannerState>({ enabled: false, message: null })

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_settings')
      .select('enabled,message')
      .eq('key', 'banner_message')
      .maybeSingle()

    if (error) {
      console.warn('[appBanner] load failed', error.message)
      return
    }
    setBanner({
      enabled: data?.enabled === true,
      message: typeof data?.message === 'string' && data.message.trim() ? data.message : null,
    })
  }, [])

  useEffect(() => {
    void refresh()

    const channel = supabase
      .channel('app_settings_banner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings', filter: 'key=eq.banner_message' },
        () => void refresh(),
      )
      .subscribe()

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)

    return () => {
      window.clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  return banner
}
