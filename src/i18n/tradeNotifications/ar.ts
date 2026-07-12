import type { TradeNotificationsTranslations } from './types'

export const tradeNotificationsAr: TradeNotificationsTranslations = {
  headlines: {
    executionCompleted: 'اكتمل تنفيذ الصفقة',
    modificationCompleted: 'اكتمل تعديل الصفقة',
    layeringCompleted: 'اكتمل التدرج',
    tradesClosed: 'أُغلقت بعض الصفقات',
  },
  bodies: {
    executionBatch: 'فُتحت {count} صفقة {side} على {broker} من {channel}.',
    executionSingle: 'فُتحت صفقة {side} على {broker} من {channel}.',
    slModifiedFromTo:
      'تغيّر SL من {oldSl} إلى {newSl} في صفقة {side} على {broker} من {channel}.',
    slModifiedTo: 'حُدّث SL إلى {newSl} في صفقة {side} على {broker} من {channel}.',
    tpModifiedTo: 'حُدّث TP إلى {newTp} في صفقة {side} على {broker} من {channel}.',
    tpsModifiedTo: 'حُدّثت مستويات TP إلى {tpList} في صفقة {side} على {broker} من {channel}.',
    slAndTpsModifiedTo:
      'حُدّث SL إلى {newSl} وTP إلى {tpList} في صفقة {side} على {broker} من {channel}.',
    modificationBatch: 'حُدّثت {count} صفقة على {broker} من {channel}.',
    tpsModificationBatch: 'حُدّثت مستويات TP في {count} صفقة {side} على {broker} من {channel}.',
    layeringBatch: 'نُفِّذت {count} أوامر تدرج على {broker} من {channel}.',
    layeringSingle: 'نُفِّذ أمر تدرج على {broker} من {channel}.',
    tradesClosedTp: 'أُغلقت {count} صفقة على {broker} بسبب {reason} من {channel}.',
    tradesClosedGeneric: 'أُغلقت {count} صفقة على {broker} من {channel}.',
    tradesClosedSingle: 'أُغلقت صفقة على {broker} من {channel}.',
  },
  sides: {
    buy: 'شراء',
    sell: 'بيع',
    trade: 'صفقة',
  },
  fallbacks: {
    broker: 'حسابك',
    channel: 'قناتك',
  },
  tpReason: 'TP{index}',
}
