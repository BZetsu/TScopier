import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { BrokerAccount } from '../types/database'
import { ConnectTradingAccountModal } from '../components/broker/ConnectTradingAccountModal'
import { BrokerConnectedSuccessModal } from '../components/broker/BrokerConnectedSuccessModal'
import { useT } from './LocaleContext'

type AddTradingAccountContextValue = {
  openAddTradingAccount: () => void
  pendingConfigureBrokerId: string | null
  clearPendingConfigureBroker: () => void
  requestConfigureBroker: (brokerId: string) => void
}

const AddTradingAccountContext = createContext<AddTradingAccountContextValue | null>(null)

export function AddTradingAccountProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const sc = t.accountConfig.brokerConnectedSuccess
  const bl = t.accountConfig.brokerList

  const [open, setOpen] = useState(false)
  const [connectedBroker, setConnectedBroker] = useState<BrokerAccount | null>(null)
  const [pendingConfigureBrokerId, setPendingConfigureBrokerId] = useState<string | null>(null)

  const openAddTradingAccount = useCallback(() => {
    setOpen(true)
  }, [])

  const clearPendingConfigureBroker = useCallback(() => {
    setPendingConfigureBrokerId(null)
  }, [])

  const requestConfigureBroker = useCallback(
    (brokerId: string) => {
      setPendingConfigureBrokerId(brokerId)
      if (pathname !== '/account-configuration') {
        navigate('/account-configuration')
      }
    },
    [navigate, pathname],
  )

  const handleConnectSuccess = useCallback((broker: BrokerAccount) => {
    setOpen(false)
    setConnectedBroker(broker)
  }, [])

  const dismissSuccess = useCallback(() => {
    setConnectedBroker(null)
  }, [])

  const handleAddChannel = useCallback(() => {
    setConnectedBroker(null)
    navigate('/channels')
  }, [navigate])

  const handleConfigure = useCallback(() => {
    if (!connectedBroker) return
    const brokerId = connectedBroker.id
    setConnectedBroker(null)
    requestConfigureBroker(brokerId)
  }, [connectedBroker, requestConfigureBroker])

  const value = useMemo(
    () => ({
      openAddTradingAccount,
      pendingConfigureBrokerId,
      clearPendingConfigureBroker,
      requestConfigureBroker,
    }),
    [
      openAddTradingAccount,
      pendingConfigureBrokerId,
      clearPendingConfigureBroker,
      requestConfigureBroker,
    ],
  )

  return (
    <AddTradingAccountContext.Provider value={value}>
      {children}
      <ConnectTradingAccountModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={handleConnectSuccess}
      />
      <BrokerConnectedSuccessModal
        open={connectedBroker != null}
        broker={connectedBroker}
        copy={{
          title: sc.title,
          body: sc.body,
          addChannel: sc.addChannel,
          configure: sc.configure,
          detailLogin: bl.detailLogin,
          detailServer: bl.detailServer,
          dismiss: t.common.cancel,
        }}
        onAddChannel={handleAddChannel}
        onConfigure={handleConfigure}
        onDismiss={dismissSuccess}
      />
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
