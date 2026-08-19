import { supabase } from './supabase'
import type { AssistantThreadRow } from '../types/database'
import {
  compactThreadForApi,
  createAssistantThreadId,
  MAX_MESSAGES_PER_THREAD,
  MAX_THREADS,
  normalizeStoredMessage,
  type AssistantChatMessage,
  type AssistantThread,
} from './assistantClient'

/**
 * Persist assistant chat threads in the database (source of truth) via the
 * Supabase client + RLS, so history survives browser restarts. sessionStorage
 * remains a local cache / offline fallback managed by assistantClient.ts.
 */

/** Convert DB rows into app threads (validate messages, sort newest first, cap). */
export function normalizeThreadRows(rows: AssistantThreadRow[]): AssistantThread[] {
  return rows
    .map(row => {
      const messages = Array.isArray(row.messages)
        ? row.messages
            .map(m => normalizeStoredMessage(m as unknown as AssistantChatMessage))
            .filter((m): m is AssistantChatMessage => m != null)
        : []
      const createdAt = Date.parse(String(row.created_at ?? ''))
      const updatedAt = Date.parse(String(row.updated_at ?? '')) || createdAt
      return {
        id: String(row.id),
        title: typeof row.title === 'string' ? row.title.slice(0, 64) : '',
        createdAt: createdAt || Date.now(),
        updatedAt: updatedAt || createdAt || Date.now(),
        messages: messages.slice(-MAX_MESSAGES_PER_THREAD),
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS)
}

/**
 * Union DB + local-cache threads by id, keeping the newer version of each, then
 * sort by recency and cap at MAX_THREADS. Returns the resolved active id,
 * preferring the caller's active thread when it still exists.
 */
export function mergeThreadStates(
  db: AssistantThread[],
  local: AssistantThread[],
  preferredActive: string | null,
): { threads: AssistantThread[]; activeThreadId: string | null } {
  const byId = new Map<string, AssistantThread>()
  for (const t of db) byId.set(t.id, t)
  for (const t of local) {
    const existing = byId.get(t.id)
    if (!existing || t.updatedAt > existing.updatedAt) byId.set(t.id, t)
  }
  const threads = [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS)
  const activeThreadId = threads.some(t => t.id === preferredActive)
    ? preferredActive
    : (threads[0]?.id ?? null)
  return { threads, activeThreadId }
}

function rowFromThread(userId: string, thread: AssistantThread): AssistantThreadRow {
  const compacted = compactThreadForApi(thread)
  const createdAt = new Date(compacted.createdAt).toISOString()
  const updatedAt = new Date(compacted.updatedAt).toISOString()
  return {
    id: compacted.id,
    user_id: userId,
    title: compacted.title,
    messages: compacted.messages as unknown as AssistantThreadRow['messages'],
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

export function newAssistantThread(): AssistantThread {
  const now = Date.now()
  return { id: createAssistantThreadId(), title: '', createdAt: now, updatedAt: now, messages: [] }
}

/** List the current user's threads (newest first, capped at MAX_THREADS). */
export async function listAssistantThreads(userId: string): Promise<AssistantThread[]> {
  const { data, error } = await supabase
    .from('assistant_threads')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(MAX_THREADS)
  if (error) throw new Error(error.message)
  return normalizeThreadRows((data ?? []) as AssistantThreadRow[])
}

/** Insert or update a thread (id conflict triggers an update). */
export async function upsertAssistantThread(userId: string, thread: AssistantThread): Promise<void> {
  const { error } = await supabase
    .from('assistant_threads')
    .upsert(rowFromThread(userId, thread), { onConflict: 'id' })
  if (error) throw new Error(error.message)
}

/** Delete a thread owned by the current user. */
export async function deleteAssistantThread(userId: string, threadId: string): Promise<void> {
  const { error } = await supabase
    .from('assistant_threads')
    .delete()
    .eq('id', threadId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}
