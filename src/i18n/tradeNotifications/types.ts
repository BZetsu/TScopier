export interface TradeNotificationsTranslations {
  headlines: {
    executionCompleted: string
    modificationCompleted: string
    layeringCompleted: string
    tradesClosed: string
  }
  bodies: {
    executionBatch: string
    executionSingle: string
    slModifiedFromTo: string
    slModifiedTo: string
    modificationBatch: string
    layeringBatch: string
    layeringSingle: string
    tradesClosedTp: string
    tradesClosedGeneric: string
    tradesClosedSingle: string
  }
  sides: {
    buy: string
    sell: string
    trade: string
  }
  fallbacks: {
    broker: string
    channel: string
  }
  tpReason: string
}
