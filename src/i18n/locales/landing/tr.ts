import { testimonialsTr } from '../../testimonials/tr'
import type { LandingTranslations } from './types'

export const landingTr: LandingTranslations = {
  promo: {
    regionLabel: 'Kampanya',
    days: 'Gün',
    hours: 'Saat',
    minutes: 'Dk',
    seconds: 'Sn',
    endsIn: 'Teklifin bitmesine',
    couponLabel: 'Kupon kodu',
    copyCoupon: 'Kupon kodunu kopyala',
    copied: 'Kopyalandı',
    dismiss: 'Kampanyayı kapat',
  },
  nav: {
    product: 'Ürün',
    features: 'Özellikler',
    pricing: 'Fiyatlandırma',
    faq: 'SSS',
    docs: 'Dokümanlar',
    forTraders: 'Trader’lar için',
    forProviders: 'Sağlayıcılar için',
    signIn: 'Giriş yap',
    getStarted: 'Kayıt ol',
    dashboard: 'Dashboard',
    menuOpen: 'Menüyü aç',
    menuClose: 'Menüyü kapat',
    productMenu: {
      heading: 'Ürünler',
      signalCopier: { title: 'Signal Copier', description: 'Telegram, WhatsApp, Discord ve TradingView’teki sinyalleri doğrudan broker’ınıza kopyalayın.' },
      socialTrading: { title: 'Sosyal Trading', description: 'ROI ve kazanma oranına göre en iyi trader’ları inceleyin; ardından ücretsiz veya aylık ücretle onları kopyalayın.' },
      accountMirroring: { title: 'Hesap Yansıtma', description: 'Bir master hesabın işlemlerini diğer hesaplarınıza gerçek zamanlı yansıtın.' },
      featuredTitle: '8+ platformla çalışır',
      featuredBody: 'MT4, MT5, cTrader, Binance, Bybit ve KuCoin. VPS gerekmez.',
      socialPanel: { title: 'Kanıtlanmış trader’ları kopyalayın', body: 'Performansı karşılaştırın ve güvendiğiniz trader’ları takip edin.' },
      mirrorPanel: { title: 'Tek master, çok hesap', body: 'Bir master hesap bağlayın; her slave hesabı işlemlerini otomatik olarak takip etsin.' },
      labels: { roi: 'ROI', winRate: 'Kazanma oranı', following: 'Takip edilen', copyTrader: 'Trader’ı Kopyala', master: 'Master', slave: 'Slave' },
      exploreFeatures: 'Tüm özellikleri keşfedin',
      viewPricing: 'Fiyatları görüntüleyin',
    },
  },
  hero: {
    headline: 'Copy Trading yeniden tanımlandı.',
    headlinePhrases: [],
    subheadline:
      'Telegram, WhatsApp ve Discord’daki sinyal sağlayıcılarından işlemler gerçekleştirin, TradingView Webhook’larını kurun, Master hesapları Slave hesaplara yansıtın veya kanıtlanmış trader’ları 8+ broker platformuna 50 ms altında kopyalayın. VPS gerekmez.',
    socialProof: 'TScopier.ai artık UniCopier',
    primaryCta: 'Planınızı seçin',
    secondaryCta: 'Nasıl çalıştığını görün',
    imageAlt:
      'Bakiye, günlük kâr, işlem sonuçları ve hesap büyüme grafikleri içeren UniCopier Dashboard',
    previewUrl: 'app.tscopier.ai/dashboard',
    dashboard: {
      headlineStats: [
        {
          key: 'totalBalance',
          value: '$54,650.00',
          live: { from: 48120, cap: 54650, stepMin: 14, stepMax: 52 },
          sub: '5 bağlı hesapta',
          valueTone: 'neutral',
        },
        {
          key: 'todaysProfit',
          value: '+$542.50',
          sub: 'dün +$712’ye kıyasla',
          valueTone: 'good',
          showHint: true,
        },
        {
          key: 'tradesTakenToday',
          value: '12',
          sub: '8 kazanıldı · 4 kaybedildi',
          valueTone: 'neutral',
        },
        {
          key: 'openPnl',
          value: '+$134.80',
          live: { from: 102.3, cap: 134.8, stepMin: 0.25, stepMax: 1.75, signed: true },
          sub: '2 hesaptan',
          valueTone: 'good',
        },
      ],
      overviewStats: [
        { key: 'activeSignalChannels', value: '4', showAdd: true },
        { key: 'openTrades', value: '16', showAdd: true },
        { key: 'tradingAccountsConnected', value: '3', showAdd: true },
        { key: 'tradesCopiedToday', value: '3' },
      ],
      copierLogRows: [
        {
          status: 'executed',
          reason: 'Emir broker’a iletildi.',
          channel: 'Gold Signals Pro',
          destination: 'Canlı · Exness',
          symbol: 'XAUUSD',
          message: 'BUY XAUUSD now SL 2640 TP 2660',
          type: 'Alım',
          side: 'buy',
          time: '22 Mayıs, 09:37',
        },
        {
          status: 'skipped',
          reason: 'Copier’da açık işlem yok',
          channel: 'FX Scalper VIP',
          destination: 'Canlı · Exness',
          symbol: 'EURUSD',
          message: 'Close EURUSD partial 50%',
          type: 'Kapatma',
          side: 'sell',
          time: '22 Mayıs, 09:35',
        },
        {
          status: 'executed',
          reason: 'Emir broker’a iletildi.',
          channel: 'Indices Daily',
          destination: 'Canlı · IC Markets',
          symbol: 'NAS100',
          message: 'SELL NAS100 now',
          type: 'Satım',
          side: 'sell',
          time: '22 Mayıs, 09:31',
        },
      ],
      linkedAccounts: [
        {
          name: 'Canlı',
          broker: 'Exness',
          accountType: 'Canlı',
          balance: '$540,110.50',
          pnl: '+$40,116.95',
          pnlTone: 'good',
          openPnl: '$0.00',
          winRate: '36%',
          dd: '3.6%',
          status: 'connected',
        },
        {
          name: 'Canlı Ana',
          broker: 'IC Markets',
          accountType: 'Canlı',
          balance: '$112,790.03',
          pnl: '+$8,240.10',
          pnlTone: 'good',
          openPnl: '+$134.80',
          winRate: '58%',
          dd: '2.1%',
          status: 'connected',
        },
      ],
    },
  },
  integrations: {
    eyebrow: 'Entegrasyonlar',
    title: 'Lider platformlarla çalışır',
  },
  supportedPlatforms: {
    title: 'Desteklenen Sinyal ve İşlem Platformları',
  },
  completePicture: {
    eyebrow: 'Bütün Resim',
    title: 'Ciddi copy trader’lar için tasarlandı.',
    description:
      'Sinyalleri güvenilir bir şekilde kopyalamak için ihtiyacınız olan her şey, ilk mesajdan son kapatmaya kadar.',
    cards: [
      { title: 'Çoklu Sinyal Kaynağı', description: 'Sağlayıcınızın zaten kullandığı sinyal kaynakından işlemleri kopyalayın.' },
      { title: '8+ Platform Destekli', description: 'UniCopier, Forex’ten kripto işlemeye kadar her popüler platformu destekler.' },
      { title: 'Sorunsuz TradingView Entegrasyonu', description: 'Stratejilerinizi TradingView’te oluşturun ve webhook ile UniCopier’a bağlanın.' },
      { title: 'AI Dahil', description: 'Yapay zekamız yalnızca önermez. Gerçek eylemler gerçekleştirir, kurulumda size yardımcı olur, işlemlerinizi analiz eder ve copy trading deneyiminizi iyileştirir.' },
    ],
  },
  showcase: {
    eyebrow: 'UniCopier',
    title: 'Modern işlem dünyasındaki karmaşıklığı azaltmak ve daha akıllı kararları desteklemek için tasarlandı',
    cta: 'Daha fazla bilgi',
    cards: [
      { headline: 'Her hesabı bağlayın, kurallarınızı bir kez belirleyin.', description: 'MT4, MT5, cTrader, Binance, Bybit ve KuCoin hesaplarınızı bağlayın; ardından her biri için lot büyüklüğü, risk, hedefler ve sinyal kaynaklarını seçin.' },
      { headline: 'İşlemleri master hesaptan slave hesaplara anında yansıtın.', description: 'Bir master hesap seçin ve diğer hesaplarınızın sabit lot, çarpan veya bakiyeye dayalı boyutlandırma ve koruma seçenekleriyle onu takip etmesini sağlayın.' },
      { headline: 'En iyi trader’ları takip edin, birkaç tıklamayla kopyalayın.', description: 'ROI, kazanma oranı ve puanları karşılaştırın; ardından sağlayıcıları ücretsiz veya aylık ücretle kopyalayın ya da kendi performansınızı paylaşın.' },
    ],
  },
  whyChoose: {
    statsCaption: 'En popüler Telegram sinyal sağlayıcılarından trader’lar tarafından kullanılıyor',
    stats: [
      { label: 'Trader’lar', value: '30K+' },
      { label: 'Bağlı broker’lar', value: '25K+' },
      { label: 'Aktif Telegram kanalları', value: '150K+' },
      { label: 'Açılan işlemler', value: '500K+' },
    ],
    eyebrow: 'Daha akıllı kopyalama, daha akıllı araçlarla başlar',
    title:
      'Sonunda, her sinyal türüyle çalışan bir sinyal copier',
    cards: [
      {
        label: 'Yürütme hızı',
        metric: '<50ms',
        metricVariant: 'teal',
        description: 'Bulut pipeline’ımızda sinyal ayrıştırmasından broker sevkine 50 ms altı gecikme.',
        layout: 'tall',
        icon: 'zap',
      },
      {
        label: 'Bulut platform',
        metric: '100%',
        metricVariant: 'teal',
        description:
          '100% bulut tabanlı — indirme yok, terminalinizde EA yok, VPS gerekmiyor. EA izni olsun veya olmasın her prop firm ile çalışır.',
        layout: 'short',
        icon: 'cloud',
      },
      {
        label: 'Broker ölçeği',
        metric: '100',
        metricVariant: 'neutral',
        description: 'Bağlı hesaplarınızda kullanıcı başına 100’e kadar MT5/MT4 bağlantısı.',
        layout: 'short',
        icon: 'link',
      },
      {
        label: 'Operasyonlar',
        metric: '24/7',
        metricVariant: 'teal',
        description: '7/24 operasyonlar — yerel bir makineyi gözetmeden her seansta kopyalayın.',
        layout: 'short',
        icon: 'clock',
      },
      {
        label: 'Kopyalama motoru',
        metric: 'Gelişmiş',
        metricVariant: 'teal',
        description:
          'Gelişmiş kopyalama stratejisi — şablonlar, filtreler, backtest ve kanal bazlı kurallar tek bir motorda.',
        layout: 'featured',
        icon: 'settings',
      },
      {
        label: 'Güvenilirlik',
        metric: '99.99%',
        metricVariant: 'teal',
        description: 'Piyasalar hareket ederken copier’ınızın çevrimiçi kalmasını sağlayan 99.99% çalışma süresi.',
        layout: 'short',
        icon: 'activity',
      },
      {
        label: 'Risk kontrolleri',
        metric: 'Katmanlama',
        metricVariant: 'neutral',
        description: 'Aralık bacakları ve çoklu TP sinyalleri için katmanlama ve daha kötü girişlerin kapatılması.',
        layout: 'tall',
        icon: 'layers',
      },
      {
        label: 'İşlem modları',
        metric: 'Tekil & Aralık',
        metricVariant: 'neutral',
        description: 'Ortak lot kuralları ve yönetim talimatlarıyla tekil ve aralık işlemesi.',
        layout: 'short',
        icon: 'chart',
      },
      {
        label: 'Çok dilli',
        metric: 'Sinyaller',
        metricVariant: 'teal',
        description: 'İngilizce, İspanyolca, Rusça, Lehçe ve daha fazlasında paylaşan kanallardan al, sat, SL ve TP’yi ayrıştırın.',
        layout: 'tall',
        icon: 'messages',
      },
      {
        label: 'Backtest',
        metric: 'Tekrar',
        metricVariant: 'teal',
        description: 'Canlı sermayenizi riske atmadan önce kurallarınızla kanal geçmişini yeniden oynatın.',
        layout: 'short',
        icon: 'history',
      },
    ],
  },
  providers: {
    eyebrow: 'Sinyal sağlayıcıları için',
    title: 'Sinyal hizmetinizi UniCopier üzerinden satın.',
    description:
      'Kendi fiyatınızı belirleyin, topluluğunuzu oluşturun ve diğer trader’ların işlemlerinizi aylık ücret karşılığı kopyalamasına izin verin. Kârın %100’ü sizde kalır.',
    points: [
      { title: 'Fiyatınızı belirleyin', description: 'Aylık ücret talep edin veya trader’ların sizi ücretsiz kopyalamasına izin verin.' },
      { title: 'Topluluğunuzu oluşturun', description: 'Sizi otomatik kopyayan trader’ları bir araya getirin.' },
      { title: 'Kârın %100’ü sizde kalsın', description: 'Kopyalayıcılarınızın size ödediği her şey sizindir.' },
    ],
  },
  features: {
    eyebrow: 'Platform özellikleri',
    title: 'Ciddi sinyal kopyalama için tasarlandı',
    subtitle:
      'Telegram işlemlerini kontrolünüzden vazgeçmeden otomatikleştirmek için ihtiyacınız olan her şey — uygulamada kullandığınız aynı akışlarla gösterilmiş.',
    showcases: [
      {
        eyebrow: 'Signal Copier',
        title: 'Telegram sinyallerini MT4 ve MT5’e hassasiyetle kopyalayın',
        description:
          'Güvenilir kanalları broker hesaplarınıza yansıtın. UniCopier girişleri, take-profit’leri, aralık bacaklarını ve yönetim talimatlarını ayrıştırır; ardından lot kurallarınız, çoklu işlem bölünmesi ve aralık katmanlamasıyla her bağlı hesapta yürütür.',
        visual: 'copier',
      },
      {
        eyebrow: 'Çok dilli sinyaller',
        title: 'Birden fazla dilde sinyalleri destekler',
        description:
          'İngilizce, İspanyolca, Fransızca, Rusça, Lehçe, Japonca ve daha fazlasında paylaşan kanalları kopyalayın. UniCopier diller arasında al/sat, SL, TP ve yönetim ifadelerini tanır — ayrıca sağlayıcınızın tam ifade tarzı için kanal bazında AI eğitimi.',
        visual: 'multilingual',
      },
      {
        eyebrow: 'Kanal kontrolü',
        title: 'Kanal bazlı filtreler ve anahtar kelime kuralları',
        description:
          'Talimat türlerini kanal bazında izin verin veya engelleyin — kapatmalar, break-even hareketleri, SL/TP düzenlemeleri ve daha fazlası. Broker’ınıza yalnızca istediğiniz sinyaller ulaşır.',
        visual: 'filters',
      },
      {
        eyebrow: 'Mesaj düzenlemeleri',
        title: 'Düzenlenmiş mesajlardan sinyal değişikliği',
        description:
          'Bir sağlayıcı stop loss veya take-profit seviyelerini değiştirmek için Telegram mesajını düzenlediğinde, UniCopier bu revizyonu alır ve broker’daki açık sepetinizi günceller — yeni giriş yok, her bacakta senkronize SL/TP.',
        visual: 'signalEdit',
      },
      {
        eyebrow: 'Backtest',
        title: 'Canlıya geçmeden önce kanal geçmişini yeniden oynatın',
        description:
          'Geçmiş sinyalleri manuel ayarlarınızla çalıştırın ve copier nasıl işlem açardı görün. Sermayenizi riske atmadan ayrıştırmayı, lot mantığını ve sonuçları doğrulayın.',
        visual: 'backtest',
      },
      {
        eyebrow: 'Copier günlükleri',
        title: 'Her çalıştırmada tam şeffaflık',
        description:
          'Worker’ın neyi ayrıştırdığını, planladığını ve gönderdiğini tam olarak görün — milisaniye zaman damgalarıyla kanalları hata ayıklayabilir ve gerçekleşen işlemleri gerçek zamanlı doğrulayabilirsiniz.',
        visual: 'logs',
      },
      {
        eyebrow: 'Piyasa araçları',
        title: 'Haberler ve ekonomik takvim yerleşik',
        description:
          'Aynı Dashboard’dan yüksek etkili olayları ve özenle seçilmiş piyasa başlıklarını takip edin — haberler çevresinde kopyalamayı durdurma kurallarıyla istediğiniz an duraklatabilirsiniz.',
        visual: 'news',
      },
    ],
    visuals: {
      copier: {
        telegramLabel: 'Sinyal kanalı',
        channelName: 'Gold Signals Pro',
        channelMeta: '3 yeni sinyal · az önce',
        hubLabel: 'UniCopier',
        mt4Label: 'MT4 hesabı',
        mt4Meta: 'Kopyalanıyor · 0.10 lot kuralları',
        mt5Label: 'MT5 hesabı',
        mt5Meta: 'Kopyalanıyor · çoklu TP bölünmesi',
        pillLayering: 'Aralık katmanlama',
        pillLots: 'Lot büyüklüğü',
        pillChannels: 'Canlı kanallar',
      },
      filters: {
        allowLabel: 'İzin ver',
        ignoreLabel: 'Yoksay',
        rules: [
          {
            label: 'Tüm pozisyonu kapat',
            example: 'örn. “kapat”, “işlemden çık”, “tümünü kapat”',
            decision: 'allow',
          },
          {
            label: 'Break-even',
            example: 'örn. “SL’yi girişe taşı”, “BE şimdi”',
            decision: 'allow',
          },
          {
            label: 'TP’yi ayarla',
            example: 'örn. “TP’yi 4600’e değiştir”',
            decision: 'allow',
          },
          {
            label: 'Tüm açık işlemleri kapat',
            example: 'örn. “hepsini kapat”, “tümünü kapat”',
            decision: 'allow',
          },
          {
            label: 'Bekleyen emirleri iptal et',
            example: 'örn. “limiti iptal et”, “bekleyeni sil”',
            decision: 'allow',
          },
        ],
      },
      multilingual: {
        languagesBadge: '10+ dil',
        moreLanguages: 'Türkçe, Almanca, Arapça, Portekizce, İtalyanca ve daha fazlası',
        parsedLabel: 'Ayrıştırıldı',
        ribbonFlags: ['us', 'gb', 'es', 'fr', 'pl', 'ru', 'se', 'nl', 'jp'],
        signals: [
          {
            flagId: 'us',
            language: 'İngilizce',
            message: 'BUY XAUUSD now · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'es',
            language: 'İspanyolca',
            message: 'COMPRA XAUUSD ahora · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'fr',
            language: 'Fransızca',
            message: 'ACHAT XAUUSD immédiat · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'ru',
            language: 'Rusça',
            message: 'ПОКУПКА XAUUSD сейчас · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'ja',
            language: 'Japonca',
            message: 'XAUUSD 買い 成行 · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
        ],
      },
      signalEdit: {
        channelName: 'Gold Signals Pro',
        channelMeta: 'Telegram · mesaj düzenlendi',
        editedLabel: 'Düzenlendi',
        messageBuy: 'BUY XAUUSD',
        beforeLabel: 'Önceki',
        beforeSl: 'SL 4190',
        beforeTp: 'TP1 4220',
        afterLabel: 'Güncellenen',
        afterSl: 'SL 4175',
        afterTp: 'TP1 4230 · TP2 4240',
        workerTitle: 'Kanal worker’ı',
        workerMessage: '7 açık XAUUSD pozisyonundaki SL/TP güncellendi (yeni işlem açılmadı)',
        workerTime: 'Az önce',
      },
      backtest: {
        resultsTitle: 'Backtest sonuçları',
        resultsSubtitle: 'XAUUSD · Kanal',
        newRunLabel: 'Yeni çalıştırma',
        totalPipsLabel: 'Toplam pip',
        totalPips: '+544.0p',
        winRateLabel: 'Kazanma oranı',
        winRate: '67%',
        winLossLabel: 'W / L',
        winLoss: '16/8',
        signalsLabel: 'Sinyaller',
        signalsCount: '24',
        signalsListLabel: '24 sinyal',
        signals: [
          {
            symbol: 'XAUUSD',
            side: 'sell',
            timestamp: '2026-05-18 09:37',
            outcome: 'Tüm TP’ler',
            pips: '+62.0p',
            pipsTone: 'good',
            duration: '23 dk',
          },
          {
            symbol: 'EURUSD',
            side: 'buy',
            timestamp: '2026-05-17 14:22',
            outcome: 'SL gerçekleşti',
            pips: '-18.0p',
            pipsTone: 'bad',
            duration: '1 sa 12 dk',
          },
          {
            symbol: 'NAS100',
            side: 'sell',
            timestamp: '2026-05-16 11:05',
            outcome: 'Kısmi',
            pips: '+24.5p',
            pipsTone: 'good',
            duration: '45 dk',
          },
        ],
      },
      logs: {
        rows: [
          { symbol: 'XAUUSD', type: 'close', time: '22 Mayıs, 19:50' },
          { symbol: 'XAUUSD', type: 'sell', time: '22 Mayıs, 19:50' },
          { symbol: 'XAUUSD', type: 'breakeven', time: '22 Mayıs, 19:50' },
          { symbol: 'XAUUSD', type: 'buy', time: '22 Mayıs, 19:49' },
          { symbol: 'XAUUSD', type: 'partial_profit', time: '22 Mayıs, 19:49' },
          { symbol: 'XAUUSD', type: 'modify', time: '22 Mayıs, 19:48' },
          { symbol: 'XAUUSD', type: 'partial_breakeven', time: '22 Mayıs, 19:48' },
        ],
      },
      news: {
        dayHeading: 'Perşembe, 21 Mayıs',
        events: [
          {
            time: '01:00',
            currency: 'JPY',
            name: 'Yıllık Enflasyon Oranı (Nis)',
            impact: 'high',
            actual: '1.40%',
            forecast: '1.80%',
            previous: '2.00%',
            actualTone: 'bad',
          },
          {
            time: '01:30',
            currency: 'JPY',
            name: 'BoJ Faiz Kararı',
            impact: 'high',
            actual: '0.50%',
            forecast: '0.50%',
            previous: '0.25%',
            actualTone: 'neutral',
          },
          {
            time: '08:30',
            currency: 'USD',
            name: 'İlk İşsizlik Başvuruları',
            impact: 'high',
            actual: '228K',
            forecast: '230K',
            previous: '224K',
            actualTone: 'good',
          },
          {
            time: '09:30',
            currency: 'GBP',
            name: 'S&P Global İmalat PMI (May)',
            impact: 'high',
            actual: '51.2',
            forecast: '50.8',
            previous: '50.3',
            actualTone: 'good',
          },
        ],
        articles: [
          {
            headline:
              'Altın (XAUUSD), Gümüş, Platin Tahminleri – Traderlar Endişelenirken Altın Geri Çekiliyor...',
            source: 'fxempire.com',
            relativeTime: '10 saat önce',
          },
          {
            headline: 'EUR/USD: Euro boğaları 1,10 direncini kırmak için daha zayıf bir dolar istiyor',
            source: 'fxstreet.com',
            relativeTime: '12 saat önce',
          },
          {
            headline: 'USD/JPY, NFP öncesi getiri farkları genişlerken zirvelerin yakınında kalıyor',
            source: 'investing.com',
            relativeTime: '14 saat önce',
          },
        ],
      },
    },
  },
  steps: {
    eyebrow: 'Hızlı başlangıç',
    title: 'Nasıl çalışır',
    subtitle: 'Telegram kanalından broker dolgusuna kadar üç adımda — uygulamadaki aynı ekranları kullanarak.',
    items: [
      {
        title: 'Telegram’ı bağlayın',
        description:
          'Telegram hesabınızı bağlayın, sinyal kanallarını seçin ve her kanalı kopyalaması gereken MT4/MT5 hesaplarına bağlayın.',
        visual: 'telegram',
      },
      {
        title: 'Broker’ınızı yapılandırın',
        description:
          'Her bağlı hesap için lot büyüklüğü, TP bölünmeleri, aralık kuralları ve kanal bazlı izin ver/yoksay filtrelerini ayarlayın.',
        visual: 'configure',
      },
      {
        title: 'Sinyalleri kopyalayın',
        description:
          'Kanal worker’ı her mesajı ayrıştırır; copier günlükleri her çalıştırmayı Dashboard’ınızda gerçek zamanlı gösterir.',
        visual: 'copy',
      },
    ],
    visuals: {
      telegram: {
        channels: [
          {
            name: 'Gold Signals Pro',
            username: 'goldsignalspro',
            active: true,
            brokers: ['MT5 · #88291'],
          },
          {
            name: 'FX Scalper VIP',
            username: 'fxscalpervip',
            active: true,
            brokers: ['MT4 · #44102'],
          },
        ],
      },
      configure: {
        accountName: 'IC Markets · MT5',
        login: 'Giriş #88291',
        lotSize: '0.10',
        rangeLabel: 'Aralık katmanlama',
        rangeValue: '50% · 3 pip',
        tpRows: [
          { label: 'TP1', percent: '50%' },
          { label: 'TP2', percent: '30%' },
          { label: 'TP3', percent: '20%' },
        ],
        filters: [
          { label: 'Kapatma sinyalleri', decision: 'allow' },
          { label: 'SL / TP düzenleme', decision: 'allow' },
          { label: 'BE hareketleri', decision: 'allow' },
        ],
      },
      copy: {
        workerLogs: [
          {
            message: 'BUY XAUUSD ayrıştırıldı · Gold Signals Pro’dan 2 TP',
            time: '22 Mayıs, 09:37',
          },
          {
            message: 'MT5’e 0.10 lot sevk edildi · hesap #88291',
            time: '22 Mayıs, 09:37',
          },
        ],
        logRows: [
          { symbol: 'XAUUSD', type: 'buy', time: '09:37' },
          { symbol: 'XAUUSD', type: 'sell', time: '09:35' },
        ],
      },
    },
  },
  faq: {
    eyebrow: 'SSS',
    title: 'Sıkça Sorulan Sorular',
    subtitle: 'Kurulum, kopyalama ve UniCopier’ı farklı kılan şeyler hakkında hızlı yanıtlar.',
    items: [
      {
        question: 'EA indirmem veya VPS çalıştırmam gerekir mi?',
        answer:
          'Hayır. UniCopier tamamen bulut tabanlıdır. Tarayıcınızdan giriş yapar, Telegram’ı ve MT4/MT5 hesaplarınızı bağlarsınız; copier bizim altyapımızda çalışır — kurulacak bir EA veya bakımı gereken bir VPS yoktur.',
      },
      {
        question: 'UniCopier, EA’ları yasaklayan prop firm’larla çalışır mı?',
        answer:
          'Evet. UniCopier tamamen bulutta çalışır — MT4/MT5 terminalinize hiçbir şey kurulmaz. Kuralları Expert Advisor’a izin versin veya vermesin, herhangi bir prop firm hesabına sinyal kopyalayabilirsiniz.',
      },
      {
        question: 'UniCopier hangi platformları destekler?',
        answer:
          'Telegram sinyal kanallarını bağlarsınız ve MetaTrader 4 ve MetaTrader 5 hesaplarına kopyalarsınız. Birden fazla broker bağlayın ve her kanalı seçtiğiniz hesaplara yönlendirin.',
      },
      {
        question: 'İşlemler ne kadar hızlı kopyalanır?',
        answer:
          'Pipeline’ımız düşük gecikme için tasarlandı — sinyal ayrıştırmasından broker sevkine tipik olarak 150 ms altında — böylece girişler, düzenlemeler ve kapatmalar fiyat hâlâ geçerliyken terminalinize ulaşır.',
      },
      {
        question: 'Kaç hesap bağlayabilirim?',
        answer:
          'Planınıza bağlı olarak kullanıcı başına 100 MT4/MT5 bağlantısı bağlayabilirsiniz. Her Telegram kanalı, Kanallar sayfasından bir veya daha fazla broker hesabına bağlanabilir.',
      },
      {
        question: 'UniCopier benim özel Telegram mesajlarımı okur mu?',
        answer:
          'UniCopier kişisel sohbetlerinizi okumaz. Telegram’ı bağlamak yalnızca üyesi olduğunuz kanal ve gruplara erişim verir; böylece copier, eklediğiniz kaynaklardan sinyal mesajları alır.',
      },
      {
        question: 'Canlıya geçmeden önce bir kanalı test edebilir miyim?',
        answer:
          'Evet. Backtest’i kullanarak bir kanalın geçmiş sinyallerini lot kurallarınıza, TP bölünmelerinize, aralık ayarlarınıza ve filtrelerinize göre yeniden oynatın — ardından canlı kopyalamayı etkinleştirmeden önce sonuçları inceleyin.',
      },
      {
        question: 'Aralık işlemleri, katmanlama ve yönetim sinyallerini destekliyor musunuz?',
        answer:
          'Evet. UniCopier; tekil ve aralık girişlerini, çoklu TP lot bölünmesini, katmanlamayı, daha kötü girişlerin kapatılmasını, break-even hareketlerini, kısmi kârları ve diğer yönetim talimatlarını — kanal bazında izin ver/yoksay filtreleriyle — işler.',
      },
      {
        question: 'Basic ve Advanced ne içeriyor?',
        answer:
          'Basic, bir hesapta backtest’ler ve temel filtrelerle birlikte temel kopyalamayı kapsar. Advanced; çoklu hesap kopyalaması, aralık katmanlaması, otomatik yönetim özellikleri ve sınırsız Telegram kanalları ekler. Tüm plan ayrıntıları için fiyatlandırma sayfamıza bakın.',
      },
    ],
  },
  reviews: {
    title: 'Trader’lar ne diyor',
    trustpilotLabel: 'Trustpilot',
    items: testimonialsTr,
  },
  comparison: {
    eyebrow: 'Trader’lar neden geçiyor',
    title: 'UniCopier ile seviyenizi yükseltin',
    subtitle: 'Tipik Telegram copier’ları ile hız, netlik ve ölçek için tasarlanmış bir bulut platformunun karşılaştırması.',
    otherLabel: 'Diğer copier’lar',
    tscopierLabel: 'UniCopier',
    cta: '5 günlük ücretsiz denemenizi başlatın',
    rows: [
      {
        aspect: 'Kurulum',
        other: 'Kurulumu zor — birçok kullanıcı canlıya çıkmak için bile birebir destek almak zorunda.',
        tscopier: 'Tarayıcıda rehberli kurulum; çoğu trader yaklaşık iki dakikada kopyalamaya başlar.',
      },
      {
        aspect: 'Dashboard',
        other: 'Önemli olanı gömen dağınık, kalabalık Dashboard’lar.',
        tscopier: 'Kanal, yürütme ve hesap sağlığına odaklanan temiz bir Dashboard.',
      },
      {
        aspect: 'Yapılandırma',
        other: 'Çok fazla ayar ve anahtar — yanlış yapılandırmak ve güven kaybetmek kolay.',
        tscopier: 'Gerçekten ihtiyacınız olduğunda derin kanal bazlı kontrolle akıllı varsayılanlar.',
      },
      {
        aspect: 'Altyapı',
        other: 'EA’ları saatlerce çalıştırmak için VPS gerekir.',
        tscopier: '100% bulut — indirme yok, EA yok, bakımı yapılacak VPS yok.',
      },
      {
        aspect: 'Prop firm’lar',
        other:
          'Birçok copier terminalinizdeki Expert Advisor’lara güvenir — bir prop firm otomatik işlemi yasakladığında bloklanır.',
        tscopier:
          'Hesabınızda EA olmadan bulut yürütme — EA izni versin veya vermesin tüm prop firm’larla çalışır.',
      },
      {
        aspect: 'Yürütme',
        other: 'Sinyal Telegram’a düştükten sonra yavaş işlem yürütme.',
        tscopier: 'Ayrıştırmadan broker sevkine 150 ms altı pipeline.',
      },
      {
        aspect: 'Hesap limitleri',
        other: 'Genellikle 3–4 bağlı hesapla sınırlı.',
        tscopier: 'Kullanıcı başına 100 MT4/MT5 bağlantısına kadar.',
      },
      {
        aspect: 'Fiyatlandırma',
        other: 'Karmaşık katmanlar, eklentiler ve sürpriz limitler.',
        tscopier: 'Temel copier özellikleri dahil net planlar.',
      },
      {
        aspect: 'İşlem yönetimi',
        other: 'Düzenlemeler, kısmi kapatmalar ve kapatmalar için hâlâ manuel müdahale gerekir.',
        tscopier: 'Otomatik girişler, katmanlama, SL/TP hareketleri ve yönetim sinyalleri.',
      },
      {
        aspect: 'Platform',
        other: 'Temel yetenekler ayrı ürün veya yükseltme olarak satılıyor.',
        tscopier: 'Copier, backtest, günlükler, haberler ve takvim tek abonelikte.',
      },
      {
        aspect: 'İşlem birleştirme',
        other:
          '“Gold buy now” işlemler açar; ardından SL/TP’li “Gold buy now” tekrar açar — çiftlersiniz veya elle düzeltirsiniz.',
        tscopier:
          '“Gold buy now” işlemi açar. SL ve TP bir sonraki mesajla geldiğinde o işlemleri güncelleriz — Gold’u tekrar açmayız.',
      },
      {
        aspect: 'Düzenlenmiş mesajlar',
        other: 'Düzenlenmiş Telegram mesajları yok sayılır — SL/TP güncellemelerini kaçırır veya işlemleri elle düzeltirsiniz.',
        tscopier:
          'Düzenlenmiş mesajlardan sinyal değişikliği, stop loss ve take-profit’leri açık sepetiniz boyunca senkronize eder — yeni işlem yok.',
      },
      {
        aspect: 'Backtest',
        other: 'Kanal geçmişinin kurallarınıza göre gerçek bir yeniden oynatımı yok veya çok az.',
        tscopier: 'Canlıya geçmeden önce geçmiş sinyalleri gerçek kopyalama ayarlarınızla backtest edin.',
      },
    ],
  },
  pricing: {
    title: 'Planınızı seçin',
    subtitle: 'Sinyalleri işlem hesaplarınıza kopyalamaya bugün başlayın.',
  },
  planComparison: {
    eyebrow: 'Planları karşılaştırın',
    title: 'Size uygun planı bulun',
    subtitle: 'Her planın neler içerdiğine yan yana bir bakış.',
    basicColumn: 'Basic',
    advancedColumn: 'Advanced',
    customColumn: 'Özel',
    rows: [
      {
        feature: 'Broker hesapları',
        basic: '1',
        advanced: '5 (100’e kadar)',
        custom: 'Özel',
      },
      {
        feature: 'Sinyal backtest’leri',
        basic: '5 / ay',
        advanced: 'Sınırsız',
        custom: 'Özel',
      },
      {
        feature: 'Telegram kanalları',
        basic: '5',
        advanced: 'Sınırsız',
        custom: 'Özel',
      },
      {
        feature: 'TradingView webhook’ları',
        basic: '2',
        advanced: 'Sınırsız',
        custom: 'Özel',
      },
      {
        feature: 'Take-profit seviyeleri',
        basic: '3 TP',
        advanced: 'Sınırsız TP/SL',
        custom: 'Özel',
      },
      {
        feature: 'Aralık işlemesi ve katmanlama',
        basic: 'no',
        advanced: 'yes',
        custom: 'yes',
      },
      {
        feature: 'Otomatik break-even ve yönetim',
        basic: 'no',
        advanced: 'yes',
        custom: 'yes',
      },
      {
        feature: 'Kanal anahtar kelime takibi',
        basic: 'no',
        advanced: 'yes',
        custom: 'yes',
      },
      {
        feature: 'Öncelikli destek',
        basic: 'no',
        advanced: 'no',
        custom: 'yes',
      },
      {
        feature: 'Özel kurulum',
        basic: 'no',
        advanced: 'no',
        custom: 'yes',
      },
      {
        feature: 'Ücretsiz deneme',
        basic: 'no',
        advanced: '5 gün',
        custom: 'Özel',
      },
      {
        feature: 'Başlangıç fiyatı',
        basic: '$9.99 / ay',
        advanced: '$39.99 / ay',
        custom: 'Bize ulaşın',
      },
    ],
  },
  pricingFaq: {
    eyebrow: 'Fiyatlandırma SSS',
    title: 'Fiyatlandırma soruları',
    subtitle: 'Faturalandırma, deneme süreleri ve plan değişiklikleri açıklamalı.',
    items: [
      {
        question: 'Ücretsiz deneme var mı?',
        answer:
          'Evet. Advanced, ilk kez abone olanlar için 5 günlük ücretsiz deneme içerir (ödeme adımında kart gerekir; faturalandırma deneme süresinden sonra başlar). Basic ilk günden itibaren ücretlidir. Basic $9.99/ay (veya $95.90/yıl). Advanced $39.99/ay (veya $383.90/yıl).',
      },
      {
        question: 'Aylık ve yıllık faturalandırma arasındaki fark nedir?',
        answer:
          'Yıllık faturalandırma, bir yıl boyunca aylık ödemeye kıyasla %20 tasarruf sağlar. Basic $9.99/ay’dan $7.99/ay’a iner ($95.90/yıl). Advanced $39.99/ay’dan $31.99/ay’a iner ($383.90/yıl). Advanced’taki ek hesaplar yıllık faturalandırmada da indirimlidir.',
      },
      {
        question: 'Advanced’taki ek hesaplar nasıl çalışır?',
        answer:
          'Advanced, 5 demo/canlı broker hesabı içerir. Hesap başına $10/ay’a (yıllık faturalandırmada hesap başına $96/yıl) 95 hesap daha ekleyebilirsiniz; kullanıcı başına en fazla 100 bağlı hesap.',
      },
      {
        question: 'Daha sonra plan değiştirebilir miyim?',
        answer:
          'Evet. Dashboard’unuzdaki Faturalandırma bölümünden istediğiniz zaman yükseltme veya düşürme yapabilirsiniz. Değişiklikler faturalandırma döneminize göre yürürlüğe girer ve planlar arasında geçişte Stripe oranılamayı yönetir.',
      },
      {
        question: 'Hangi ödeme yöntemlerini kabul ediyorsunuz?',
        answer:
          'Stripe aracılığıyla başlıca kredi ve banka kartlarını kabul ediyoruz. Faturalar ve ödeme geçmişi Faturalandırma sayfanızdan indirilebilir.',
      },
      {
        question: 'Ne zaman Özel planı seçmeliyim?',
        answer:
          'Özel plan; hesap limitleri, faturalandırma veya kurulum iş akışınıza göre özelleştirilmesi gereken prop firm’lar, işlem ekipleri veya yüksek hacimli operatörler içindir. Satış ekibimizle iletişime geçin, size uygun bir plan hazırlayalım.',
      },
      {
        question: 'İstediğim zaman iptal edebilir miyim?',
        answer:
          'Evet. Faturalandırma’dan veya Stripe müşteri portalından iptal edebilirsiniz. Erişiminiz mevcut faturalandırma döneminin sonuna kadar sürer. Basic veya Advanced’te uzun süreli sözleşme yoktur.',
      },
    ],
  },
  pricingSocialProof: {
    banner: '{count} trader bugün satın aldı',
    purchaseToast: '{country} bölgesinden bir trader az önce {plan} aboneliği satın aldı.',
    timeAgoJustNow: 'Az önce',
    timeAgoOneMinute: '1 dakika önce',
  },
  pricingSnippet: {
    basic: 'Basic — $9.99/ay',
    advanced: 'Advanced — $39.99/ay',
  },
  footer: {
    cta: {
      title: 'Manuel uğraş olmadan sinyal kopyalamaya hazır mısınız?',
      subtitle:
        'Telegram’ı bağlayın, MT4 veya MT5’i ekleyin ve dakikalar içinde kopyalamaya başlayın — VPS yok, kurulum yok.',
      primary: '5 günlük ücretsiz denemenizi başlatın',
      secondary: 'Giriş yap',
    },
    tagline: 'Her Forex ve Crypto Trader İçin All-In-One Copier',
    columns: {
      product: 'Ürün',
      resources: 'Kaynaklar',
      account: 'Hesap',
    },
    links: {
      overview: 'Genel bakış',
      features: 'Özellikler',
      pricing: 'Fiyatlandırma',
      howItWorks: 'Nasıl çalışır',
      faq: 'SSS',
      docs: 'Dokümantasyon',
      status: 'Sistem durumu',
      telegram: 'Telegram desteği',
      riskDisclaimer: 'Risk uyarısı',
      termsOfService: 'Kullanım Koşulları',
      privacyPolicy: 'Gizlilik Politikası',
      cookiePolicy: 'Çerez Politikası',
      signIn: 'Giriş yap',
      signUp: 'Hesap oluştur',
      openApp: 'Dashboard’ı aç',
    },
    platforms: 'Çalıştığı platformlar',
    copyright: '© {year} Tartarix Inc. Tüm hakları saklıdır.',
    disclaimer:
      'İşlem yapmak risk içerir. UniCopier bir kopyalama aracıdır — yatırım tavsiyesi değildir.',
  },
}
