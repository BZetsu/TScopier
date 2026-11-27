import type { BrokerStatusModalCopy } from '../types'

export const statusModalTr: BrokerStatusModalCopy = {
  title: 'Broker sağlığı',
  subtitle: 'İşlem terminalinizden canlı anlık görüntü',
  healthyTitle: 'Sağlıklı',
  unhealthyTitle: 'Sağlıklı değil',
  healthyBody: 'Tüm kontroller geçti — copier bu hesapta işlem yapabilir.',
  unhealthyBody:
    'Bir veya daha fazla kontrol başarısız — bu sorun giderilene dek kopyalama çalışmayabilir.',
  refresh: 'Yenile',
  close: 'Kapat',
  loading: 'Terminal durumu yükleniyor…',
  unsupported:
    'Sağlık kontrolleri henüz kullanılamıyor. En güncel fxsocket-broker edge functionını dağıtın.',
  loadFailed: 'Terminal durumu yüklenemedi. Biraz sonra yeniden deneyin.',
  sectionOverall: 'Copier hazırlığı',
  sectionTerminal: 'Bulut terminali',
  sectionBroker: 'Broker bağlantısı',
  sectionAccount: 'İşlem hesabı',
  sectionBridge: 'İşlem köprüsü',
  serverTime: 'Broker sunucu saati',
  checkStatusReady: 'Terminal durumu hazır',
  checkTerminalAlive: 'Terminal çalışıyor',
  checkBrokerConnected: 'Broker’a bağlı',
  checkAccountLoggedIn: 'Hesaba giriş yapılmış',
  checkAccountTradeAllowed: 'İşleme izin veriliyor',
  checkBridgeTradeEaReady: 'Trade EA hazır',
  checkBridgeSymbolsSynced: 'Symbol listeleri eşitlendi',
  checkBridgeTradeEaReadyHint:
    'MT5 üzerinde Algo Trading’i etkinleştirin, FxSocket bağlı olduğu yerde terminalin çalışmasını sağlayın, ardından bu kontrol yeşil olana dek yenileyin.',
  tradeEaNotReadyTitle: 'Trade EA hazır değil',
  tradeEaNotReadyBody:
    'Terminaliniz bağlı ancak emirler henüz gönderilemiyor. MT5 üzerinde Algo Trading’i etkinleştirin ve işlem köprüsünün başlamasını bekleyin.',
  labelBuild: 'Build',
  labelPing: 'Ping',
  labelServer: 'Sunucu',
  labelLogin: 'Giriş',
  labelCurrency: 'Para birimi',
  labelAccountType: 'Hesap türü',
  labelBridgeVersion: 'Köprü sürümü',
  valueYes: 'Evet',
  valueNo: 'Hayır',
}
