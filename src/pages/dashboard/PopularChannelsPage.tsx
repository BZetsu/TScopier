import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../context/LocaleContext'
import { PageHeader } from '../../components/layout/PageHeader'
import { PageShell } from '../../components/layout/PageShell'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Radio, Flame } from 'lucide-react'
import type { SignalChannel } from '../../types/database'

const ONE_HOUR_MS = 60 * 60 * 1000

function formatSubscribers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toLocaleString()
}

function isLive(lastLiveAt: string | null): boolean {
  if (!lastLiveAt) return false
  return Date.now() - new Date(lastLiveAt).getTime() < ONE_HOUR_MS
}

export function PopularChannelsPage() {
  const t = useT()
  const p = t.popularChannelsPage
  const [channels, setChannels] = useState<SignalChannel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadChannels()
  }, [])

  const loadChannels = async () => {
    const { data } = await supabase
      .from('signal_channels')
      .select('*')
      .gt('subscriber_count', 0)
      .order('subscriber_count', { ascending: false })
    setChannels(data ?? [])
    setLoading(false)
  }

  return (
    <PageShell maxWidth="lg" spacing="none" className="space-y-6">
      <PageHeader
        title={p.title}
        subtitle={p.subtitle}
      />

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 animate-pulse"
            />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <div className="text-center py-10">
            <Flame className="w-10 h-10 mx-auto mb-3 text-neutral-200" />
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              {p.emptyTitle}
            </p>
            <p className="text-xs text-neutral-400 mt-1">
              {p.emptySubtitle}
            </p>
          </div>
        </Card>
      ) : (
        <Card padding="none" className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {channels.map((ch, idx) => {
            const live = isLive(ch.last_live_at)
            return (
              <div
                key={ch.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="w-6 text-xs font-semibold text-neutral-300 dark:text-neutral-600 text-center shrink-0">
                  #{idx + 1}
                </span>
                <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50 truncate">
                    {ch.display_name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {ch.channel_username && (
                      <p className="text-xs text-neutral-400">@{ch.channel_username}</p>
                    )}
                    <span className="text-neutral-300 dark:text-neutral-600">·</span>
                    <div className="flex items-center gap-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          live ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600'
                        }`}
                      />
                      <span className="text-xs text-neutral-400">
                        {live ? 'Live' : 'No recent activity'}
                      </span>
                    </div>
                  </div>
                </div>
                <Badge variant="neutral" size="sm">
                  {formatSubscribers(ch.subscriber_count)}
                </Badge>
              </div>
            )
          })}
        </Card>
      )}
    </PageShell>
  )
}
