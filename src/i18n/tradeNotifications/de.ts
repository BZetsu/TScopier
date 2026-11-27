import type { TradeNotificationsTranslations } from './types'

export const tradeNotificationsDe: TradeNotificationsTranslations = {
  headlines: {
    executionCompleted: 'TRADE-AUSFÜHRUNG ABGESCHLOSSEN',
    modificationCompleted: 'TRADE-ÄNDERUNG ABGESCHLOSSEN',
    layeringCompleted: 'LAYERING ABGESCHLOSSEN',
    tradesClosed: 'EINIGE TRADES GESCHLOSSEN',
    reviewRequired: 'SIGNAL WARTET AUF FREIGABE',
    manualOverrideReverted: 'Manuelle Trade-Änderungen wurden zurückgesetzt',
  },
  bodies: {
    executionBatch: '{count} {side}-Trades wurden in {broker} aus {channel} eröffnet.',
    executionSingle: 'Ein {side}-Trade wurde in {broker} aus {channel} eröffnet.',
    slModifiedFromTo:
      'Der SL wurde von {oldSl} auf {newSl} an Ihrem {side}-Trade in {broker} aus {channel} geändert.',
    slModifiedTo: 'Der SL wurde auf {newSl} an Ihrem {side}-Trade in {broker} aus {channel} aktualisiert.',
    tpModifiedTo: 'Der TP wurde auf {newTp} an Ihrem {side}-Trade in {broker} aus {channel} aktualisiert.',
    tpsModifiedTo: 'Die TPs wurden auf {tpList} an Ihrem {side}-Trade in {broker} aus {channel} aktualisiert.',
    slAndTpsModifiedTo:
      'Der SL wurde auf {newSl} und die TPs auf {tpList} an Ihrem {side}-Trade in {broker} aus {channel} aktualisiert.',
    modificationBatch: '{count} Trades wurden in {broker} aus {channel} aktualisiert.',
    tpsModificationBatch: 'Die TPs wurden bei {count} {side}-Trades in {broker} aus {channel} aktualisiert.',
    layeringBatch: '{count} Layering-Orders wurden in {broker} aus {channel} ausgeführt.',
    layeringSingle: 'Eine Layering-Order wurde in {broker} aus {channel} ausgeführt.',
    tradesClosedTp: '{count} Trades wurden in {broker} aufgrund von {reason} aus {channel} geschlossen.',
    tradesClosedGeneric: '{count} Trades wurden in {broker} aus {channel} geschlossen.',
    tradesClosedSingle: 'Ein Trade wurde in {broker} aus {channel} geschlossen.',
    reviewRequired: 'Ein Signal aus {channel} wartet auf Ihre Freigabe.',
    manualOverrideReverted:
      'UniCopier hat eine manuelle SL/TP-Änderung erkannt, die direkt auf Ihrem Broker-Konto vorgenommen wurde, und die vom Signal verwalteten Werte wiederhergestellt. Um SL oder TP für ein kopiertes Signal zu ändern, verwenden Sie „Signal verwalten“ in UniCopier.',
  },
  sides: {
    buy: 'Kauf',
    sell: 'Verkauf',
    trade: 'Trade',
  },
  fallbacks: {
    broker: 'Ihr Konto',
    channel: 'Ihr Kanal',
  },
  actions: {
    manageSignal: 'Signal verwalten',
  },
  tpReason: 'TP{index}',
}
