import { useCallback, useState } from 'react'
import { useHumanReview } from '../context/HumanReviewContext'

export type ReviewActions = {
  approvingId: string | null
  errorBySignal: Record<string, string>
  approve: (signalId: string) => Promise<boolean>
  dismiss: (signalId: string) => void
}

/** Shared approve/dismiss state used by the review modal and the trades queue. */
export function useReviewActions(): ReviewActions {
  const { approve: approveSignal, dismiss: dismissSignal } = useHumanReview()
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [errorBySignal, setErrorBySignal] = useState<Record<string, string>>({})

  const approve = useCallback(
    async (signalId: string): Promise<boolean> => {
      setApprovingId(signalId)
      setErrorBySignal(prev => ({ ...prev, [signalId]: '' }))
      const error = await approveSignal(signalId)
      setApprovingId(null)
      if (error) {
        setErrorBySignal(prev => ({ ...prev, [signalId]: error }))
        return false
      }
      return true
    },
    [approveSignal],
  )

  const dismiss = useCallback(
    (signalId: string) => {
      setErrorBySignal(prev => {
        const next = { ...prev }
        delete next[signalId]
        return next
      })
      dismissSignal(signalId)
    },
    [dismissSignal],
  )

  return { approvingId, errorBySignal, approve, dismiss }
}
