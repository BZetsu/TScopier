import { useEffect, useState } from 'react'
import { Radio, Trash2, RefreshCw, CircleAlert as AlertCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Toggle } from '../../components/ui/Toggle'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import type { ChannelSignalProfile, TelegramChannel } from '../../types/database'

function getTelegramAvatarUrl(username?: string): string | null {
  if (!username) return null
  return `https://t.me/i/userpic/320/${username}.jpg`
}

function TgChannelAvatar({ title, username }: { title: string; username?: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  const avatarUrl = getTelegramAvatarUrl(username)

  return (
    <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0 overflow-hidden">
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={`${title} avatar`}
          className="w-full h-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <img
          src="/Telegram.svg"
          alt="Telegram"
          className="w-5 h-5 object-contain"
          loading="lazy"
        />
      )}
    </div>
  )
}

export function CopierEnginePage() {
  const { user, session } = useAuth()
  const [channels, setChannels] = useState<TelegramChannel[]>([])
  const [channelProfiles, setChannelProfiles] = useState<Record<string, ChannelSignalProfile>>({})
  const [analyzingChannels, setAnalyzingChannels] = useState<Set<string>>(new Set())
  const [analysisProgress, setAnalysisProgress] = useState<Record<string, number>>({})
  const [tgChannels, setTgChannels] = useState<{ id: string; title: string; username: string; members_count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingTg, setLoadingTg] = useState(false)
  const [tgChannelsCollapsed, setTgChannelsCollapsed] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newChannel, setNewChannel] = useState({ channel_id: '', channel_username: '', display_name: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [hasTgSession, setHasTgSession] = useState(false)
  const [tgStage, setTgStage] = useState<'idle' | 'phone' | 'code' | 'linked'>('idle')
  const [tgPhone, setTgPhone] = useState('')
  const [tgCode, setTgCode] = useState('')
  const [tgPassword, setTgPassword] = useState('')
  const [tgLoading, setTgLoading] = useState(false)
  const [tgError, setTgError] = useState('')
  const [requiresPassword, setRequiresPassword] = useState(false)

  const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-auth`
  const EDGE_ANALYZE_PROFILE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-channel-profile`

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  const loadData = async () => {
    const [channelsRes, sessionRes] = await Promise.all([
      supabase.from('telegram_channels').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }),
      supabase.from('telegram_sessions').select('id').eq('user_id', user!.id).maybeSingle(),
    ])
    setChannels((channelsRes.data ?? []) as TelegramChannel[])
    const channelRows = (channelsRes.data ?? []) as TelegramChannel[]
    void loadChannelProfiles(channelRows.map(c => c.id))
    const hasSession = !!sessionRes.data
    setHasTgSession(hasSession)
    setTgStage(hasSession ? 'linked' : 'idle')
    setLoading(false)
    if (hasSession) fetchTgChannels()
  }

  const loadChannelProfiles = async (channelIds: string[]) => {
    if (!channelIds.length) {
      setChannelProfiles({})
      return
    }
    const { data } = await supabase
      .from('channel_signal_profiles')
      .select('*')
      .in('channel_id', channelIds)
    const rows = (data ?? []) as ChannelSignalProfile[]
    const next: Record<string, ChannelSignalProfile> = {}
    for (const row of rows) next[row.channel_id] = row
    setChannelProfiles(next)
  }

  const analyzeChannelProfile = async (channelId: string) => {
    if (!session?.access_token) return
    setAnalyzingChannels(prev => {
      const next = new Set(prev)
      next.add(channelId)
      return next
    })
    setAnalysisProgress(prev => ({ ...prev, [channelId]: 0 }))
    try {
      setAnalysisProgress(prev => ({ ...prev, [channelId]: 10 }))
      let historicalMessages: string[] = []
      // Backfill last 30 days from Telegram before profiling so insights
      // are not limited to only recently ingested messages.
      const backfillRes = await fetch(EDGE_FN, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'backfill_channel_history', channel_row_id: channelId, days: 30 }),
      }).catch(() => null)
      if (backfillRes) {
        const backfillData = await backfillRes.json().catch(() => null)
        if (backfillRes.ok && Array.isArray(backfillData?.messages)) {
          historicalMessages = backfillData.messages as string[]
        }
      }

      setAnalysisProgress(prev => ({ ...prev, [channelId]: 60 }))
      const res = await fetch(EDGE_ANALYZE_PROFILE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel_id: channelId, lookback_days: 30, historical_messages: historicalMessages }),
      })
      setAnalysisProgress(prev => ({ ...prev, [channelId]: 85 }))
      const data = await res.json()
      if (!res.ok || !data?.profile) return
      const profile = data.profile as ChannelSignalProfile
      setChannelProfiles(prev => ({ ...prev, [channelId]: profile }))
      setAnalysisProgress(prev => ({ ...prev, [channelId]: 100 }))
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch {
      // non-blocking background enrichment
    } finally {
      setAnalyzingChannels(prev => {
        const next = new Set(prev)
        next.delete(channelId)
        return next
      })
      setAnalysisProgress(prev => {
        const next = { ...prev }
        delete next[channelId]
        return next
      })
    }
  }

  const fetchTgChannels = async () => {
    setLoadingTg(true)
    setError('')
    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_channels' }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to load Telegram channels')
        return
      }
      setTgChannels(data.channels ?? [])
    } catch {
      setError('Failed to load Telegram channels')
    } finally {
      setLoadingTg(false)
    }
  }

  const toggleChannel = async (id: string, is_active: boolean) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, is_active } : c))
    await supabase.from('telegram_channels').update({ is_active }).eq('id', id)
  }

  const deleteChannel = async (id: string) => {
    setChannels(prev => prev.filter(c => c.id !== id))
    await supabase.from('telegram_channels').delete().eq('id', id)
  }

  const addManual = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!newChannel.display_name.trim()) { setError('Channel name is required'); return }
    setSaving(true)
    const { data, error: dbErr } = await supabase
      .from('telegram_channels')
      .insert({
        user_id: user!.id,
        channel_id: newChannel.channel_id.trim() || newChannel.channel_username.trim(),
        channel_username: newChannel.channel_username.trim().replace(/^@/, ''),
        display_name: newChannel.display_name.trim(),
        is_active: true,
      })
      .select('*')
      .single()
    setSaving(false)
    if (dbErr) { setError(dbErr.message); return }
    const inserted = data as TelegramChannel
    setChannels(prev => [inserted, ...prev])
    setNewChannel({ channel_id: '', channel_username: '', display_name: '' })
    setShowAdd(false)
    void analyzeChannelProfile(inserted.id)
  }

  const addFromTg = async (ch: { id: string; title: string; username: string }) => {
    setError('')
    const { data, error: dbErr } = await supabase
      .from('telegram_channels')
      .upsert({
        user_id: user!.id,
        channel_id: ch.id,
        channel_username: ch.username ?? '',
        display_name: ch.title,
        is_active: true,
      }, { onConflict: 'user_id,channel_id' })
      .select('*')
      .single()
    if (dbErr) {
      setError(dbErr.message)
      return
    }
    if (!dbErr && data) {
      const upserted = data as TelegramChannel
      setChannels(prev => {
        const exists = prev.find(c => c.channel_id === ch.id)
        return exists ? prev.map(c => c.channel_id === ch.id ? upserted : c) : [upserted, ...prev]
      })
      void analyzeChannelProfile(upserted.id)
    }
  }

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setTgError('')
    setTgLoading(true)
    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'send_code', phone: tgPhone }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setTgError(data.error || 'Failed to send code')
        return
      }
      setTgStage('code')
    } catch {
      setTgError('Network error')
    } finally {
      setTgLoading(false)
    }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setTgError('')
    setTgLoading(true)
    try {
      const res = await fetch(EDGE_FN, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'verify_code',
          phone: tgPhone,
          code: tgCode,
          password: requiresPassword ? tgPassword : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        if (data.requires_password) {
          setRequiresPassword(true)
          setTgError('Enter your Telegram 2FA password.')
          return
        }
        setTgError(data.error || 'Verification failed')
        return
      }
      await loadData()
    } catch {
      setTgError('Network error')
    } finally {
      setTgLoading(false)
    }
  }

  const disconnectTelegram = async () => {
    await supabase.from('telegram_sessions').delete().eq('user_id', user!.id)
    setHasTgSession(false)
    setTgStage('idle')
    setTgChannels([])
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Channels</h1>
          <p className="text-sm text-neutral-500 mt-0.5">Configure which Telegram channels feed into the copier</p>
        </div>
        <div className="flex gap-2">
          {!hasTgSession && tgStage === 'idle' && (
            <Button size="sm" onClick={() => setTgStage('phone')}>
              Connect Telegram
            </Button>
          )}
          {hasTgSession && (
            <Button variant="secondary" size="sm" onClick={fetchTgChannels} loading={loadingTg}>
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* Status row */}
      {/* {brokers.length === 0 && (
        <div className="mb-4 px-4 py-3 bg-warning-50 border border-warning-200 rounded-xl text-sm text-warning-700 flex items-center gap-2">
          <span className="font-medium">No active broker account.</span>
          <a href="/account-configuration" className="underline text-warning-800">Connect one in Account Configuration.</a>
        </div>
      )} */}
      {!hasTgSession && tgStage === 'idle' && (
        <div className="mb-4 px-4 py-3 bg-warning-50 border border-warning-200 rounded-xl text-sm text-warning-700 flex items-center gap-2">
          <span className="font-medium">Telegram not connected.</span>
          <span>Connect Telegram here to load and manage your channel list.</span>
        </div>
      )}

      {!hasTgSession && tgStage !== 'idle' && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center overflow-hidden">
              <img
                src="/Telegram.svg"
                alt="Telegram"
                className="w-4 h-4 object-contain"
                loading="lazy"
              />
            </div>
            <p className="text-sm font-semibold text-neutral-900">
              {tgStage === 'phone' ? 'Connect Telegram: enter your phone number' : 'Connect Telegram: enter verification code'}
            </p>
          </div>

          {tgError && (
            <div className="mb-3 px-3 py-2 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">{tgError}</div>
          )}

          {tgStage === 'phone' ? (
            <form onSubmit={sendCode} className="space-y-3">
              <Input
                label="Phone number"
                type="tel"
                placeholder="+1 234 567 8900"
                value={tgPhone}
                onChange={e => setTgPhone(e.target.value)}
                hint="Include country code"
                required
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" loading={tgLoading} size="sm">Send code</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTgStage('idle')}>Cancel</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-3">
              <Input
                label="Verification code"
                placeholder="12345"
                value={tgCode}
                onChange={e => setTgCode(e.target.value)}
                hint={`Sent to ${tgPhone}`}
                required
                autoFocus
              />
              {requiresPassword && (
                <Input
                  label="2FA password"
                  type="password"
                  placeholder="Your Telegram password"
                  value={tgPassword}
                  onChange={e => setTgPassword(e.target.value)}
                  required
                />
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={tgLoading} size="sm">Verify</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setTgStage('phone'); setTgError('') }}>Back</Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {/* Telegram channels panel */}
      {hasTgSession && (
        <Card className="mb-4" padding="none">
          <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-neutral-900">Your Telegram channels</p>
              <Badge variant="success" size="sm">Connected</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTgChannelsCollapsed(prev => !prev)}
                className="text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${tgChannelsCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                {tgChannelsCollapsed ? 'Expand' : 'Collapse'}
              </Button>
              <Button variant="ghost" size="sm" onClick={disconnectTelegram} className="text-error-600 hover:bg-error-50 hover:text-error-700">
                <AlertCircle className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            {tgChannels.length > 0 && (
              <span className="text-xs text-neutral-400">{tgChannels.length} found</span>
            )}
            </div>
          </div>
          {!tgChannelsCollapsed && (loadingTg ? (
            <div className="divide-y divide-neutral-50">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-neutral-100 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-neutral-100 rounded animate-pulse w-48" />
                    <div className="h-2.5 bg-neutral-100 rounded animate-pulse w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-error-300" />
              <p className="text-sm text-error-600 font-medium">{error}</p>
              <p className="text-xs text-neutral-400 mt-0.5">Use Refresh after fixing Telegram connection or worker issues.</p>
            </div>
          ) : tgChannels.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Radio className="w-8 h-8 mx-auto mb-2 text-neutral-200" />
              <p className="text-sm text-neutral-400">No channels or groups found</p>
              <p className="text-xs text-neutral-300 mt-0.5">Make sure you are a member of the signal channels</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-50 max-h-72 overflow-y-auto">
              {tgChannels.map(ch => {
                const alreadyAdded = channels.some(c => c.channel_id === ch.id)
                return (
                  <div key={ch.id} className="px-5 py-3 flex items-center gap-3 hover:bg-neutral-50 transition-colors">
                    <TgChannelAvatar title={ch.title} username={ch.username} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-900 truncate">{ch.title}</p>
                      {ch.username && <p className="text-xs text-neutral-400">@{ch.username}</p>}
                    </div>
                    {ch.members_count > 0 && (
                      <span className="text-xs text-neutral-400 flex-shrink-0">{ch.members_count.toLocaleString()} members</span>
                    )}
                    <button
                      onClick={() => addFromTg(ch)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors flex-shrink-0 ${
                        alreadyAdded
                          ? 'border-neutral-200 text-neutral-400 cursor-default'
                          : 'border-primary-500 text-primary-600 hover:bg-primary-50'
                      }`}
                      disabled={alreadyAdded}
                    >
                      {alreadyAdded ? 'Added' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </Card>
      )}

      {/* Manual add form */}
      {showAdd && (
        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">Add channel manually</h3>
          {error && <div className="mb-3 px-3 py-2 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700">{error}</div>}
          <form onSubmit={addManual} className="space-y-3">
            <Input label="Channel name" placeholder="e.g. Gold Signals Pro" value={newChannel.display_name} onChange={e => setNewChannel(p => ({ ...p, display_name: e.target.value }))} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Username (optional)" placeholder="@channelname" value={newChannel.channel_username} onChange={e => setNewChannel(p => ({ ...p, channel_username: e.target.value }))} />
              <Input label="Channel ID (optional)" placeholder="Telegram channel ID" value={newChannel.channel_id} onChange={e => setNewChannel(p => ({ ...p, channel_id: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={saving} size="sm">Add channel</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Channel list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-white rounded-xl border border-neutral-100 animate-pulse" />)}
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-neutral-200 py-16 text-center">
          <Radio className="w-10 h-10 mx-auto mb-3 text-neutral-200" />
          <p className="text-sm font-medium text-neutral-400">No channels configured</p>
          <p className="text-xs text-neutral-300 mt-1">Add signal channels to start the copier</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map(channel => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              profile={channelProfiles[channel.id]}
              isAnalyzing={analyzingChannels.has(channel.id)}
              analysisProgress={analysisProgress[channel.id] ?? 0}
              onToggle={v => toggleChannel(channel.id, v)}
              onDelete={() => deleteChannel(channel.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelRow({
  channel, profile, isAnalyzing, analysisProgress, onToggle, onDelete,
}: {
  channel: TelegramChannel
  profile?: ChannelSignalProfile
  isAnalyzing: boolean
  analysisProgress: number
  onToggle: (v: boolean) => void
  onDelete: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-100 shadow-card overflow-hidden">
      <div className="px-4 py-3.5 flex items-center gap-3">
        <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Radio className="w-4 h-4 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-neutral-900">{channel.display_name}</p>
            {!channel.is_active && <Badge variant="neutral" size="sm">Paused</Badge>}
          </div>
          {channel.channel_username && <p className="text-xs text-neutral-400 mt-0.5">@{channel.channel_username}</p>}
          <div className="mt-2 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">AI Analysis</p>
            {isAnalyzing ? (
              <div className="mt-1.5">
                <p className="text-xs text-neutral-500 mb-1.5">
                  Analyzing Signals for the last 30 days... {Math.max(0, Math.min(100, Math.round(analysisProgress)))}%
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-primary-500 transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, analysisProgress))}%` }}
                  />
                </div>
              </div>
            ) : !profile ? (
              <p className="text-xs text-neutral-400 mt-1">No insights yet. Insights will be generated automatically when this channel is added.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Badge variant="neutral" size="sm">Type: {profile.signal_type}</Badge>
                  <Badge variant="neutral" size="sm">Entry: {profile.entry_type}</Badge>
                  <Badge variant="neutral" size="sm">TP: {profile.tp_style}</Badge>
                  <Badge variant="neutral" size="sm">SL: {profile.sl_style}</Badge>
                </div>
                {profile.analysis_summary && (
                  <p className="text-[11px] text-neutral-400 mt-0.5">{profile.analysis_summary}</p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Toggle checked={channel.is_active} onChange={onToggle} />
          <button onClick={onDelete} className="p-1.5 rounded-lg text-neutral-400 hover:text-error-600 hover:bg-error-50 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
