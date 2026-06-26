/** Options passed from dispatch into management execution (live fast path). */
export type MgmtExecOptions = {
  /** Live Telegram mgmt: parallel legs, fast close/modify, reduced straggler rounds. */
  liveMgmtFast?: boolean
}

/** Metrics returned from applyManagement for pipeline logging. */
export type MgmtExecResult = {
  legsTotal: number
  legsParallelism: number
  /** Diagnostics: ms spent loading the management scope (channel open trades). */
  scopeLoadMs?: number
  /** Diagnostics: number of distinct baskets (accounts) the modify touched. */
  basketsTotal?: number
  /** Diagnostics: ms spent applying SL/TP across all baskets (broker work). */
  basketApplyMs?: number
  /** Diagnostics: configured cross-basket apply concurrency. */
  basketConcurrency?: number
}
