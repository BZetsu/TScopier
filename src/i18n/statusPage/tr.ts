import type { StatusPageTranslations } from './types'

export const statusPageTr: StatusPageTranslations = {
  brand: 'UniCopier',
  title: 'Sistem durumu',
  subtitle: 'UniCopier platform hizmetlerinin canlı durumu.',
  updated: '{time} itibarıyla güncellendi',
  refreshing: 'Yenileniyor…',
  refresh: 'Yenile',
  loadError: 'Sistem durumu yüklenemedi. Biraz sonra tekrar deneyin.',
  retry: 'Tekrar dene',
  overall: {
    operational: 'Tüm sistemler çalışıyor',
    degraded: 'Kısmi kesinti',
    outage: 'Büyük kesinti',
  },
  componentStatus: {
    operational: 'Çalışıyor',
    degraded: 'Kısıtlı',
    outage: 'Kesinti',
    unknown: 'Bilinmiyor',
  },
  componentsHeading: 'Hizmetler',
  incidentsHeading: 'Aktif olaylar',
  noIncidents: 'Aktif olay yok.',
  incidentActive: 'Aktif',
  impactMajor: 'Büyük',
  impactMinor: 'Küçük',
  contactSupport: 'Destekle iletişime geçin',
  backHome: 'Uygulamaya dön',
}
