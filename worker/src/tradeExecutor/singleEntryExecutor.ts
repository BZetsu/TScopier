import type { TradeExecutorContext } from './context'
import { executeEntrySend, type EntryMode } from './entryExecution'
import type { EntryArgs } from './entryPrepare'

export type { EntryArgs } from './entryPrepare'
export type { EntryMode } from './entryExecution'

export async function runSingleEntry(ctx: TradeExecutorContext, args: EntryArgs) {
  return executeEntrySend(ctx, args, 'single')
}
