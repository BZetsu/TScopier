import type { TradeNotificationsTranslations } from './types'

export const tradeNotificationsTr: TradeNotificationsTranslations = {
  headlines: {
    executionCompleted: 'İŞLEM YÜRÜTME TAMAMLANDI',
    modificationCompleted: 'İŞLEM DEĞİŞİKLİĞİ TAMAMLANDI',
    layeringCompleted: 'KATMANLAMA TAMAMLANDI',
    tradesClosed: 'BİRKAÇ İŞLEM KAPATILDI',
    reviewRequired: 'SİNYAL ONAY BEKLİYOR',
    manualOverrideReverted: 'Manuel işlem değişiklikleri geri alındı',
  },
  bodies: {
    executionBatch: '{broker} üzerinde {channel} üzerinden {count} {side} işlemi açıldı.',
    executionSingle: '{broker} üzerinde {channel} üzerinden bir {side} işlemi açıldı.',
    slModifiedFromTo:
      '{broker} üzerinde {channel} üzerinden {side} işleminizde SL {oldSl} değerinden {newSl} değerine güncellendi.',
    slModifiedTo: '{broker} üzerinde {channel} üzerinden {side} işleminizde SL {newSl} olarak güncellendi.',
    tpModifiedTo: '{broker} üzerinde {channel} üzerinden {side} işleminizde TP {newTp} olarak güncellendi.',
    tpsModifiedTo: '{broker} üzerinde {channel} üzerinden {side} işleminizde TP’ler {tpList} olarak güncellendi.',
    slAndTpsModifiedTo:
      '{broker} üzerinde {channel} üzerinden {side} işleminizde SL {newSl} olarak, TP’ler {tpList} olarak güncellendi.',
    modificationBatch: '{broker} üzerinde {channel} üzerinden {count} işlem güncellendi.',
    tpsModificationBatch: '{broker} üzerinde {channel} üzerinden {count} {side} işleminde TP’ler güncellendi.',
    layeringBatch: '{broker} üzerinde {channel} üzerinden {count} katmanlı emir dolduruldu.',
    layeringSingle: '{broker} üzerinde {channel} üzerinden bir katmanlı emir dolduruldu.',
    tradesClosedTp: '{broker} üzerinde {channel} üzerinden {reason} nedeniyle {count} işlem kapatıldı.',
    tradesClosedGeneric: '{broker} üzerinde {channel} üzerinden {count} işlem kapatıldı.',
    tradesClosedSingle: '{broker} üzerinde {channel} üzerinden bir işlem kapatıldı.',
    reviewRequired: '{channel} üzerinden gelen bir sinyal onayınızı bekliyor.',
    manualOverrideReverted:
      'UniCopier, broker hesabınızda doğrudan yapılan bir SL/TP değişikliğini tespit etti ve sinyalin yönetilen değerlerini geri yükledi. Kopyalanan bir sinyalde SL veya TP değiştirmek için UniCopier’da “Sinyali Yönet” seçeneğini kullanın.',
  },
  sides: {
    buy: 'alım',
    sell: 'satış',
    trade: 'genel',
  },
  fallbacks: {
    broker: 'hesabınız',
    channel: 'kanalınız',
  },
  actions: {
    manageSignal: 'Sinyali Yönet',
  },
  tpReason: 'TP{index}',
}
