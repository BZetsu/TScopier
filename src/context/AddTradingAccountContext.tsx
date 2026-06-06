import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ConnectTradingAccountModal } from '../components/broker/ConnectTradingAccountModal'

type AddTradingAccountContextValue = {
  openAddTradingAccount: () => void
}

const AddTradingAccountContext = createContext<AddTradingAccountContextValue | null>(null)

export function AddTradingAccountProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const openAddTradingAccount = useCallback(() => {
    setOpen(true)
  }, [])

  const value = useMemo(
    () => ({
      openAddTradingAccount,
    }),
    [openAddTradingAccount],
  )

  return (
    <AddTradingAccountContext.Provider value={value}>
      {children}
      <ConnectTradingAccountModal open={open} onClose={() => setOpen(false)} />
    </AddTradingAccountContext.Provider>
  )
}

export function useAddTradingAccount(): AddTradingAccountContextValue {
  const context = useContext(AddTradingAccountContext)
  if (!context) {
    throw new Error('useAddTradingAccount must be used within AddTradingAccountProvider')
  }
  return context
}
