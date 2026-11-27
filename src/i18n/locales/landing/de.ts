import { testimonialsDe } from '../../testimonials/de'
import type { LandingTranslations } from './types'

export const landingDe: LandingTranslations = {
  promo: {
    regionLabel: 'Aktion',
    days: 'Tage',
    hours: 'Std.',
    minutes: 'Min.',
    seconds: 'Sek.',
    endsIn: 'Angebot endet in',
    couponLabel: 'Gutscheincode',
    copyCoupon: 'Gutscheincode kopieren',
    copied: 'Kopiert',
    dismiss: 'Aktion schließen',
  },
  nav: {
    product: 'Produkt',
    features: 'Funktionen',
    pricing: 'Preise',
    faq: 'FAQ',
    docs: 'Dokumentation',
    forTraders: 'Für Trader',
    forProviders: 'Für Anbieter',
    signIn: 'Anmelden',
    getStarted: 'Registrieren',
    dashboard: 'Dashboard',
    menuOpen: 'Menü öffnen',
    menuClose: 'Menü schließen',
    productMenu: {
      heading: 'Produkte',
      signalCopier: { title: 'Signal-Copier', description: 'Kopieren Sie Signale von Telegram, WhatsApp, Discord und TradingView direkt zu Ihrem Broker.' },
      socialTrading: { title: 'Social Trading', description: 'Entdecken Sie Top-Trader nach ROI und Gewinnrate und kopieren Sie sie kostenlos oder gegen eine monatliche Gebühr.' },
      accountMirroring: { title: 'Konto-Mirroring', description: 'Spielen Sie die Trades eines Master-Kontos in Echtzeit auf Ihre anderen Konten ab.' },
      featuredTitle: 'Funktioniert mit 8+ Plattformen',
      featuredBody: 'MT4, MT5, cTrader, Binance, Bybit und KuCoin. Kein VPS erforderlich.',
      socialPanel: { title: 'Bewährte Trader kopieren', body: 'Vergleichen Sie die Performance und folgen Sie den Tradern, denen Sie vertrauen.' },
      mirrorPanel: { title: 'Ein Master, viele Konten', body: 'Verbinden Sie ein Master-Konto, und jedes Slave-Konto übernimmt seine Trades automatisch.' },
      labels: { roi: 'ROI', winRate: 'Gewinnrate', following: 'Follower', copyTrader: 'Trader kopieren', master: 'Master', slave: 'Slave' },
      exploreFeatures: 'Alle Funktionen entdecken',
      viewPricing: 'Preise ansehen',
    },
  },
  hero: {
    headline: 'Copy Trading neu definiert.',
    headlinePhrases: [],
    subheadline:
      'Führen Sie Trades von Signal-Anbietern auf Telegram, WhatsApp und Discord aus, richten Sie TradingView-Webhooks ein, spiegeln Sie Master-Konten auf Slave-Konten oder kopieren Sie bewährte Trader auf 8+ Broker-Plattformen – in unter 50 ms. Kein VPS erforderlich.',
    socialProof: 'TScopier.ai ist jetzt UniCopier',
    primaryCta: 'Plan wählen',
    secondaryCta: 'So funktioniert es',
    imageAlt:
      'UniCopier-Dashboard mit Guthaben, Tagesgewinn, Trade-Ergebnissen und Diagrammen zum Kontowachstum',
    previewUrl: 'app.tscopier.ai/dashboard',
    dashboard: {
      headlineStats: [
        {
          key: 'totalBalance',
          value: '$54,650.00',
          live: { from: 48120, cap: 54650, stepMin: 14, stepMax: 52 },
          sub: 'Über 5 verbundene Konten',
          valueTone: 'neutral',
        },
        {
          key: 'todaysProfit',
          value: '+$542.50',
          sub: 'gegenüber gestern +$712',
          valueTone: 'good',
          showHint: true,
        },
        {
          key: 'tradesTakenToday',
          value: '12',
          sub: '8 gewonnen · 4 verloren',
          valueTone: 'neutral',
        },
        {
          key: 'openPnl',
          value: '+$134.80',
          live: { from: 102.3, cap: 134.8, stepMin: 0.25, stepMax: 1.75, signed: true },
          sub: 'Von 2 Konten',
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
          reason: 'Order beim Broker platziert.',
          channel: 'Gold Signals Pro',
          destination: 'Live · Exness',
          symbol: 'XAUUSD',
          message: 'XAUUSD jetzt kaufen SL 2640 TP 2660',
          type: 'Kauf',
          side: 'buy',
          time: '22. Mai, 09:37',
        },
        {
          status: 'skipped',
          reason: 'Kein offener Trade im Copier',
          channel: 'FX Scalper VIP',
          destination: 'Live · Exness',
          symbol: 'EURUSD',
          message: 'EURUSD teilweise schließen 50%',
          type: 'Schließen',
          side: 'sell',
          time: '22. Mai, 09:35',
        },
        {
          status: 'executed',
          reason: 'Order beim Broker platziert.',
          channel: 'Indices Daily',
          destination: 'Live · IC Markets',
          symbol: 'NAS100',
          message: 'NAS100 jetzt verkaufen',
          type: 'Verkauf',
          side: 'sell',
          time: '22. Mai, 09:31',
        },
      ],
      linkedAccounts: [
        {
          name: 'Live',
          broker: 'Exness',
          accountType: 'Live',
          balance: '$540,110.50',
          pnl: '+$40,116.95',
          pnlTone: 'good',
          openPnl: '$0.00',
          winRate: '36%',
          dd: '3,6%',
          status: 'connected',
        },
        {
          name: 'Live Hauptkonto',
          broker: 'IC Markets',
          accountType: 'Live',
          balance: '$112,790.03',
          pnl: '+$8,240.10',
          pnlTone: 'good',
          openPnl: '+$134.80',
          winRate: '58%',
          dd: '2,1%',
          status: 'connected',
        },
      ],
    },
  },
  integrations: {
    eyebrow: 'Integrationen',
    title: 'Funktioniert mit führenden Plattformen',
  },
  supportedPlatforms: {
    title: 'Unterstützte Signal- und Handelsplattformen',
  },
  completePicture: {
    eyebrow: 'Das Gesamtbild',
    title: 'Entwickelt für seriöse Copy-Trader.',
    description: 'Alles, was Sie brauchen, um Signale zuverlässig zu kopieren – von der ersten Nachricht bis zum letzten Schließen.',
    cards: [
      { title: 'Mehrere Signalquellen', description: 'Kopieren Sie Trades aus der Signalquelle, die Ihr Anbieter bereits verwendet.' },
      { title: 'Unterstützt 8+ Plattformen', description: 'UniCopier unterstützt jede beliebte Plattform – vom Forex- bis zum Kryptohandel.' },
      { title: 'Nahtlose TradingView-Integration', description: 'Entwickeln Sie Ihre Strategien in TradingView und verbinden Sie sie per Webhook mit UniCopier.' },
      { title: 'Mit AI inklusive', description: 'Unsere AI schlägt nicht nur vor. Sie führt echte Aktionen aus, hilft bei der Einrichtung, analysiert Ihre Trades und verbessert Ihr Copy-Trading-Erlebnis.' },
    ],
  },
  showcase: {
    eyebrow: 'UniCopier',
    title: 'Entwickelt, um die Komplexität des modernen Handels zu reduzieren und bessere Entscheidungen zu unterstützen',
    cta: 'Mehr erfahren',
    cards: [
      { headline: 'Verbinden Sie alle Konten und legen Sie Ihre Regeln einmal fest.', description: 'Verbinden Sie Ihre MT4-, MT5-, cTrader-, Binance-, Bybit- und KuCoin-Konten und wählen Sie dann für jedes Konto Lotgröße, Risiko, Ziele und Signalquellen.' },
      { headline: 'Spiegeln Sie Trades sofort vom Master- auf Slave-Konten.', description: 'Wählen Sie ein Master-Konto und lassen Sie Ihre anderen Konten ihm mit festen Lots, Multiplikatoren oder saldobasierter Positionsgröße folgen – plus Schutzoptionen.' },
      { headline: 'Folgen Sie Top-Tradern und kopieren Sie sie mit wenigen Klicks.', description: 'Vergleichen Sie ROI, Gewinnrate und Bewertungen und kopieren Sie Anbieter kostenlos oder gegen eine monatliche Gebühr – oder teilen Sie Ihre eigene Performance.' },
    ],
  },
  whyChoose: {
    statsCaption: 'Von Tradern der beliebtesten Telegram-Signalanbieter genutzt',
    stats: [
      { label: 'Trader', value: '30K+' },
      { label: 'Verbundene Broker', value: '25K+' },
      { label: 'Aktive Telegram-Kanäle', value: '150K+' },
      { label: 'Eröffnete Trades', value: '500K+' },
    ],
    eyebrow: 'Intelligenteres Kopieren beginnt mit besseren Werkzeugen',
    title:
      'Endlich ein Signal-Copier, der für jeden Signaltyp funktioniert',
    cards: [
      {
        label: 'Ausführungsgeschwindigkeit',
        metric: '<50ms',
        metricVariant: 'teal',
        description: 'Latenz unter 50 ms vom Parsen des Signals bis zum Versand an den Broker in unserer Cloud-Pipeline.',
        layout: 'tall',
        icon: 'zap',
      },
      {
        label: 'Cloud-Plattform',
        metric: '100%',
        metricVariant: 'teal',
        description:
          '100 % cloudbasiert – kein Download, kein EA auf Ihrem Terminal und kein VPS nötig. Funktioniert mit jeder Prop-Firm, ob EA erlaubt oder nicht.',
        layout: 'short',
        icon: 'cloud',
      },
      {
        label: 'Broker-Skala',
        metric: '100',
        metricVariant: 'neutral',
        description: 'Bis zu 100 MT5/MT4-Verbindungen pro Nutzer über Ihre verbundenen Konten.',
        layout: 'short',
        icon: 'link',
      },
      {
        label: 'Betrieb',
        metric: '24/7',
        metricVariant: 'teal',
        description: '24/7-Betrieb – kopieren Sie durch jede Sitzung, ohne eine lokale Maschine beaufsichtigen zu müssen.',
        layout: 'short',
        icon: 'clock',
      },
      {
        label: 'Copier-Engine',
        metric: 'Fortgeschritten',
        metricVariant: 'teal',
        description:
          'Fortschrittliche Copy-Strategie – Vorlagen, Filter, Backtest und Regeln pro Kanal in einer Engine.',
        layout: 'featured',
        icon: 'settings',
      },
      {
        label: 'Zuverlässigkeit',
        metric: '99,99%',
        metricVariant: 'teal',
        description: '99,99 % Verfügbarkeit, damit Ihr Copier online bleibt, wenn sich die Märkte bewegen.',
        layout: 'short',
        icon: 'activity',
      },
      {
        label: 'Risikokontrollen',
        metric: 'Layering',
        metricVariant: 'neutral',
        description: 'Layering und das Schließen schlechterer Einstiege für Range-Legs und Multi-TP-Signale.',
        layout: 'tall',
        icon: 'layers',
      },
      {
        label: 'Handelsmodi',
        metric: 'Einzel & Range',
        metricVariant: 'neutral',
        description: 'Einzel- und Range-Handel mit gemeinsamen Lot-Regeln und Management-Instruktionen.',
        layout: 'short',
        icon: 'chart',
      },
      {
        label: 'Mehrsprachig',
        metric: 'Signale',
        metricVariant: 'teal',
        description: 'Erkennen Sie Kauf- und Verkaufssignale sowie SL und TP in Kanälen, die auf Englisch, Spanisch, Russisch, Polnisch und weiteren Sprachen posten.',
        layout: 'tall',
        icon: 'messages',
      },
      {
        label: 'Backtest',
        metric: 'Wiedergabe',
        metricVariant: 'teal',
        description: 'Spielen Sie die Kanalhistorie mit Ihren Regeln ab, bevor Sie echtes Kapital riskieren.',
        layout: 'short',
        icon: 'history',
      },
    ],
  },
  providers: {
    eyebrow: 'Für Signalanbieter',
    title: 'Verkaufen Sie Ihren Signal-Service mit UniCopier.',
    description: 'Legen Sie Ihren eigenen Preis fest, bauen Sie Ihre Community auf und lassen Sie andere Trader gegen eine monatliche Gebühr Ihre Trades kopieren. Sie behalten 100 % des Gewinns.',
    points: [
      { title: 'Legen Sie Ihren Preis fest', description: 'Erheben Sie eine monatliche Gebühr oder lassen Sie Trader Sie kostenlos kopieren.' },
      { title: 'Bauen Sie Ihre Community auf', description: 'Versammeln Sie Trader, die Sie automatisch kopieren.' },
      { title: 'Behalten Sie 100 % des Gewinns', description: 'Alles, was Ihre Copier Ihnen zahlen, gehört Ihnen.' },
    ],
  },
  features: {
    eyebrow: 'Plattformfunktionen',
    title: 'Entwickelt für seriöses Signal-Kopieren',
    subtitle:
      'Alles, was Sie brauchen, um Telegram-Trades zu automatisieren, ohne die Kontrolle abzugeben – illustriert mit denselben Abläufen, die Sie in der App verwenden.',
    showcases: [
      {
        eyebrow: 'Signal-Copier',
        title: 'Telegram-Signale präzise zu MT4 & MT5 kopieren',
        description:
          'Spiegeln Sie vertrauenswürdige Kanäle in Ihre Broker-Konten. UniCopier parst Einstiege, Take-Profits, Range-Legs und Management-Instruktionen – und führt sie dann mit Ihren Lot-Regeln, Multi-Trade-Splits und Range-Layering auf jedem verbundenen Konto aus.',
        visual: 'copier',
      },
      {
        eyebrow: 'Mehrsprachige Signale',
        title: 'Unterstützt Signale in mehreren Sprachen',
        description:
          'Kopieren Sie Kanäle, die auf Englisch, Spanisch, Französisch, Russisch, Polnisch, Japanisch und weiteren Sprachen posten. UniCopier erkennt Kauf-/Verkaufs-, SL-, TP- und Management-Formulierungen über Sprachen hinweg – plus AI-Training pro Kanal für die exakte Wortwahl Ihres Anbieters.',
        visual: 'multilingual',
      },
      {
        eyebrow: 'Kanalsteuerung',
        title: 'Filter und Keyword-Regeln pro Kanal',
        description:
          'Erlauben oder blockieren Sie Anweisungstypen pro Kanal – Schließen, Break-even-Verschiebungen, SL/TP-Anpassungen und mehr. Nur die Signale, die Sie wollen, erreichen Ihren Broker.',
        visual: 'filters',
      },
      {
        eyebrow: 'Nachrichtenbearbeitung',
        title: 'Signaländerung aus bearbeiteten Nachrichten',
        description:
          'Wenn ein Anbieter eine Telegram-Nachricht bearbeitet, um Stop-Loss- oder Take-Profit-Level zu ändern, übernimmt UniCopier die Änderung und aktualisiert Ihren offenen Korb beim Broker – keine neuen Einstiege, nur synchronisierte SL/TP über jeden Leg hinweg.',
        visual: 'signalEdit',
      },
      {
        eyebrow: 'Backtest',
        title: 'Kanalhistorie abspielen, bevor Sie live gehen',
        description:
          'Führen Sie vergangene Signale gegen Ihre manuellen Einstellungen aus und sehen Sie, wie der Copier gehandelt hätte. Validieren Sie das Parsing, die Lot-Logik und die Ergebnisse, ohne Kapital zu riskieren.',
        visual: 'backtest',
      },
      {
        eyebrow: 'Copier-Protokolle',
        title: 'Volle Transparenz bei jeder Ausführung',
        description:
          'Sehen Sie genau, was der Worker geparst, geplant und gesendet hat – mit Millisekunden-Zeitstempeln, damit Sie Kanäle debuggen und Ausführungen in Echtzeit überprüfen können.',
        visual: 'logs',
      },
      {
        eyebrow: 'Marktwerkzeuge',
        title: 'Nachrichten und Wirtschaftskalender integriert',
        description:
          'Verfolgen Sie Ereignisse mit hoher Marktwirkung und kuratierte Marktschlagzeilen im selben Dashboard – und pausieren Sie das Kopieren rund um Nachrichten optional mit Blackout-Regeln.',
        visual: 'news',
      },
    ],
    visuals: {
      copier: {
        telegramLabel: 'Signalkanal',
        channelName: 'Gold Signals Pro',
        channelMeta: '3 neue Signale · gerade eben',
        hubLabel: 'UniCopier',
        mt4Label: 'MT4-Konto',
        mt4Meta: 'Kopieren · 0,10-Lot-Regeln',
        mt5Label: 'MT5-Konto',
        mt5Meta: 'Kopieren · Multi-TP-Split',
        pillLayering: 'Range-Layering',
        pillLots: 'Lot-Größe',
        pillChannels: 'Live-Kanäle',
      },
      filters: {
        allowLabel: 'Erlauben',
        ignoreLabel: 'Ignorieren',
        rules: [
          {
            label: 'Gesamte Position schließen',
            example: 'z. B. „schließen“, „Position schließen“, „flach machen“',
            decision: 'allow',
          },
          {
            label: 'Break-even',
            example: 'z. B. „SL auf Einstieg setzen“, „BE jetzt“',
            decision: 'allow',
          },
          {
            label: 'TP anpassen',
            example: 'z. B. „TP auf 4600 ändern“',
            decision: 'allow',
          },
          {
            label: 'Alle offenen Trades schließen',
            example: 'z. B. „alle schließen“, „alles flach“',
            decision: 'allow',
          },
          {
            label: 'Pending-Orders stornieren',
            example: 'z. B. „Limit stornieren“, „Pending löschen“',
            decision: 'allow',
          },
        ],
      },
      multilingual: {
        languagesBadge: '10+ Sprachen',
        moreLanguages: 'Türkisch, Deutsch, Arabisch, Portugiesisch, Italienisch & mehr',
        parsedLabel: 'Geparst',
        ribbonFlags: ['us', 'gb', 'es', 'fr', 'pl', 'ru', 'se', 'nl', 'jp'],
        signals: [
          {
            flagId: 'us',
            language: 'Englisch',
            message: 'BUY XAUUSD now · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'es',
            language: 'Spanisch',
            message: 'COMPRA XAUUSD ahora · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'fr',
            language: 'Französisch',
            message: 'ACHAT XAUUSD immédiat · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'ru',
            language: 'Russisch',
            message: 'ПОКУПКА XAUUSD сейчас · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
          {
            flagId: 'ja',
            language: 'Japanisch',
            message: 'XAUUSD 買い 成行 · SL 2640 · TP 2670',
            parsedAction: 'BUY XAUUSD',
            side: 'buy',
          },
        ],
      },
      signalEdit: {
        channelName: 'Gold Signals Pro',
        channelMeta: 'Telegram · Nachricht bearbeitet',
        editedLabel: 'Bearbeitet',
        messageBuy: 'XAUUSD kaufen',
        beforeLabel: 'Vorher',
        beforeSl: 'SL 4190',
        beforeTp: 'TP1 4220',
        afterLabel: 'Aktualisiert',
        afterSl: 'SL 4175',
        afterTp: 'TP1 4230 · TP2 4240',
        workerTitle: 'Kanal-Worker',
        workerMessage: 'SL/TP auf 7 offenen XAUUSD-Legs aktualisiert (keine neuen Trades eröffnet)',
        workerTime: 'Gerade eben',
      },
      backtest: {
        resultsTitle: 'Backtest-Ergebnisse',
        resultsSubtitle: 'XAUUSD · Kanal',
        newRunLabel: 'Neuer Lauf',
        totalPipsLabel: 'Pips gesamt',
        totalPips: '+544,0p',
        winRateLabel: 'Gewinnrate',
        winRate: '67%',
        winLossLabel: 'G / V',
        winLoss: '16/8',
        signalsLabel: 'Signale',
        signalsCount: '24',
        signalsListLabel: '24 Signale',
        signals: [
          {
            symbol: 'XAUUSD',
            side: 'sell',
            timestamp: '18.05.2026 09:37',
            outcome: 'Alle TPs',
            pips: '+62,0p',
            pipsTone: 'good',
            duration: '23 Min.',
          },
          {
            symbol: 'EURUSD',
            side: 'buy',
            timestamp: '17.05.2026 14:22',
            outcome: 'SL getroffen',
            pips: '-18,0p',
            pipsTone: 'bad',
            duration: '1 Std. 12 Min.',
          },
          {
            symbol: 'NAS100',
            side: 'sell',
            timestamp: '16.05.2026 11:05',
            outcome: 'Teilweise',
            pips: '+24,5p',
            pipsTone: 'good',
            duration: '45 Min.',
          },
        ],
      },
      logs: {
        rows: [
          { symbol: 'XAUUSD', type: 'close', time: '22. Mai, 19:50' },
          { symbol: 'XAUUSD', type: 'sell', time: '22. Mai, 19:50' },
          { symbol: 'XAUUSD', type: 'breakeven', time: '22. Mai, 19:50' },
          { symbol: 'XAUUSD', type: 'buy', time: '22. Mai, 19:49' },
          { symbol: 'XAUUSD', type: 'partial_profit', time: '22. Mai, 19:49' },
          { symbol: 'XAUUSD', type: 'modify', time: '22. Mai, 19:48' },
          { symbol: 'XAUUSD', type: 'partial_breakeven', time: '22. Mai, 19:48' },
        ],
      },
      news: {
        dayHeading: 'Donnerstag, 21. Mai',
        events: [
          {
            time: '01:00',
            currency: 'JPY',
            name: 'Inflationsrate im Jahresvergleich (Apr.)',
            impact: 'high',
            actual: '1,40%',
            forecast: '1,80%',
            previous: '2,00%',
            actualTone: 'bad',
          },
          {
            time: '01:30',
            currency: 'JPY',
            name: 'Zinsentscheidung der BoJ',
            impact: 'high',
            actual: '0,50%',
            forecast: '0,50%',
            previous: '0,25%',
            actualTone: 'neutral',
          },
          {
            time: '08:30',
            currency: 'USD',
            name: 'Erstanträge auf Arbeitslosenhilfe',
            impact: 'high',
            actual: '228K',
            forecast: '230K',
            previous: '224K',
            actualTone: 'good',
          },
          {
            time: '09:30',
            currency: 'GBP',
            name: 'S&P-Global-Industrie-PMI (Mai)',
            impact: 'high',
            actual: '51,2',
            forecast: '50,8',
            previous: '50,3',
            actualTone: 'good',
          },
        ],
        articles: [
          {
            headline:
              'Gold (XAUUSD), Silber, Platin-Prognosen – Gold zieht sich zurück, während Trader sich Sorgen ma...',
            source: 'fxempire.com',
            relativeTime: 'vor 10 Std.',
          },
          {
            headline: 'EUR/USD: Euro-Bullen brauchen einen schwächeren Dollar, um den Widerstand bei 1,10 zu durchbrechen',
            source: 'fxstreet.com',
            relativeTime: 'vor 12 Std.',
          },
          {
            headline: 'USD/JPY hält sich nahe den Höchstständen, während die Renditespreads vor den NFP steigen',
            source: 'investing.com',
            relativeTime: 'vor 14 Std.',
          },
        ],
      },
    },
  },
  steps: {
    eyebrow: 'Erste Schritte',
    title: 'So funktioniert es',
    subtitle: 'Von Telegram-Kanal bis zur Ausführung beim Broker in drei Schritten – mit denselben Bildschirmen, die Sie in der App erhalten.',
    items: [
      {
        title: 'Telegram verbinden',
        description:
          'Verbinden Sie Ihr Telegram-Konto, wählen Sie Signalkanäle und verbinden Sie jeden Kanal mit den MT4/MT5-Konten, die ihn kopieren sollen.',
        visual: 'telegram',
      },
      {
        title: 'Broker konfigurieren',
        description:
          'Legen Sie für jedes verknüpfte Konto Lotgröße, TP-Splits, Range-Regeln und Kanal-Filter zum Erlauben/Ignorieren fest.',
        visual: 'configure',
      },
      {
        title: 'Signale kopieren',
        description:
          'Der Kanal-Worker parst jede Nachricht; die Copier-Protokolle zeigen jede Ausführung in Echtzeit in Ihrem Dashboard.',
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
        login: 'Login #88291',
        lotSize: '0,10',
        rangeLabel: 'Range-Layering',
        rangeValue: '50 % · 3 Pips',
        tpRows: [
          { label: 'TP1', percent: '50%' },
          { label: 'TP2', percent: '30%' },
          { label: 'TP3', percent: '20%' },
        ],
        filters: [
          { label: 'Schließ-Signale', decision: 'allow' },
          { label: 'SL / TP ändern', decision: 'allow' },
          { label: 'Break-even-Verschiebungen', decision: 'allow' },
        ],
      },
      copy: {
        workerLogs: [
          {
            message: 'BUY XAUUSD geparst · 2 TPs von Gold Signals Pro',
            time: '22. Mai, 09:37',
          },
          {
            message: '0,10 Lot an MT5 gesendet · Konto #88291',
            time: '22. Mai, 09:37',
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
    eyebrow: 'FAQ',
    title: 'Häufig gestellte Fragen',
    subtitle: 'Schnelle Antworten zu Einrichtung, Kopierung und dem, was UniCopier anders macht.',
    items: [
      {
        question: 'Muss ich ein EA herunterladen oder einen VPS betreiben?',
        answer:
          'Nein. UniCopier ist vollständig cloudbasiert. Sie melden sich im Browser an, verbinden Telegram und Ihre MT4/MT5-Konten, und der Copier läuft auf unserer Infrastruktur – keine Expert-Advisor-Installationen und kein VPS zum Pflegen.',
      },
      {
        question: 'Funktioniert UniCopier mit Prop-Firms, die EAs verbieten?',
        answer:
          'Ja. UniCopier läuft vollständig in der Cloud – auf Ihrem MT4/MT5-Terminal wird nichts installiert. Sie können Signale auf jedes Prop-Firm-Konto kopieren, egal ob deren Regeln Expert Advisors erlauben oder nicht.',
      },
      {
        question: 'Welche Plattformen unterstützt UniCopier?',
        answer:
          'Sie verbinden Telegram-Signalkanäle und kopieren auf MetaTrader-4- und MetaTrader-5-Konten. Verknüpfen Sie mehrere Broker und leiten Sie jeden Kanal zu den Konten Ihrer Wahl.',
      },
      {
        question: 'Wie schnell werden Trades kopiert?',
        answer:
          'Unsere Pipeline ist für niedrige Latenz ausgelegt – typischerweise unter 150 ms vom Signal-Parsing bis zum Versand an den Broker –, sodass Einstiege, Änderungen und Schließungen Ihr Terminal erreichen, während der Preis noch relevant ist.',
      },
      {
        question: 'Wie viele Konten kann ich verbinden?',
        answer:
          'Sie können je nach Plan bis zu 100 MT4/MT5-Verbindungen pro Nutzer verknüpfen. Jeder Telegram-Kanal kann auf der Seite „Kanäle“ mit einem oder mehreren Broker-Konten verbunden werden.',
      },
      {
        question: 'Liest UniCopier meine privaten Telegram-Nachrichten?',
        answer:
          'UniCopier liest Ihre persönlichen Chats nicht. Das Verbinden von Telegram gewährt nur Zugriff auf Kanäle und Gruppen, in denen Sie Mitglied sind, damit der Copier Signale von Quellen empfängt, die Sie hinzufügen.',
      },
      {
        question: 'Kann ich einen Kanal testen, bevor ich live gehe?',
        answer:
          'Ja. Nutzen Sie Backtest, um vergangene Signale eines Kanals gegen Ihre Lot-Regeln, TP-Splits, Range-Einstellungen und Filter abzuspielen – und prüfen Sie die Ergebnisse, bevor Sie das Live-Kopieren aktivieren.',
      },
      {
        question: 'Unterstützen Sie Range-Trades, Layering und Management-Signale?',
        answer:
          'Ja. UniCopier verarbeitet Einzel- und Range-Einstiege, Multi-TP-Lot-Splits, Layering, Close-worse-Entries, Break-even-Verschiebungen, Teilgewinne und andere Management-Instruktionen – mit Filtern zum Erlauben/Ignorieren pro Kanal.',
      },
      {
        question: 'Was ist im Plan Basic im Vergleich zu Advanced enthalten?',
        answer:
          'Basic umfasst das Kopieren auf einem Konto mit den Kernfunktionen, Backtests und wesentlichen Filtern. Advanced ergänzt Multi-Konto-Kopieren, Range-Layering, Auto-Management-Funktionen und unbegrenzte Telegram-Kanäle. Alle Plandetails finden Sie auf unserer Preisseite.',
      },
    ],
  },
  reviews: {
    title: 'Was Trader sagen',
    trustpilotLabel: 'Trustpilot',
    items: testimonialsDe,
  },
  comparison: {
    eyebrow: 'Warum Trader wechseln',
    title: 'Steigen Sie mit UniCopier auf',
    subtitle: 'Typische Telegram-Copier versus eine Cloud-Plattform, gebaut für Tempo, Klarheit und Skalierung.',
    otherLabel: 'Andere Copier',
    tscopierLabel: 'UniCopier',
    cta: 'Starten Sie Ihre 5-tägige kostenlose Testphase',
    rows: [
      {
        aspect: 'Einrichtung',
        other: 'Schwer einzurichten – viele Nutzer brauchen persönliche Hilfe, um live zu gehen.',
        tscopier: 'Geführtes Onboarding im Browser; die meisten Trader kopieren nach etwa zwei Minuten.',
      },
      {
        aspect: 'Dashboard',
        other: 'Überladene, vollgestopfte Dashboards, die das Wichtige begraben.',
        tscopier: 'Ein sauberes Dashboard mit Fokus auf Kanäle, Ausführung und Kontozustand.',
      },
      {
        aspect: 'Konfiguration',
        other: 'Zu viele Regler und Schalter – leicht falsch konfiguriert und das Vertrauen verloren.',
        tscopier: 'Intelligente Standardwerte mit tiefer Kanalsteuerung, wenn Sie sie wirklich brauchen.',
      },
      {
        aspect: 'Infrastruktur',
        other: 'VPS erforderlich, damit EAs rund um die Uhr laufen.',
        tscopier: '100 % Cloud – kein Download, kein EA und kein VPS zum Pflegen.',
      },
      {
        aspect: 'Prop-Firms',
        other:
          'Viele Copier verwenden Expert Advisors auf Ihrem Terminal – blockiert, wenn eine Prop-Firm automatisierten Handel verbietet.',
        tscopier:
          'Cloud-Ausführung ohne EA auf Ihrem Konto – funktioniert mit allen Prop-Firms, egal ob sie EAs erlauben.',
      },
      {
        aspect: 'Ausführung',
        other: 'Langsame Trade-Ausführung, nachdem das Signal Telegram erreicht.',
        tscopier: 'Pipeline unter 150 ms vom Parsing bis zum Versand an den Broker.',
      },
      {
        aspect: 'Kontolimits',
        other: 'Oft auf 3–4 verknüpfte Konten begrenzt.',
        tscopier: 'Bis zu 100 MT4/MT5-Verbindungen pro Nutzer.',
      },
      {
        aspect: 'Preise',
        other: 'Komplexe Stufen, Add-ons und unerwartete Limits.',
        tscopier: 'Klare Pläne mit den Kern-Copier-Funktionen inklusive.',
      },
      {
        aspect: 'Trade-Management',
        other: 'Weiterhin manuelle Eingriffe bei Änderungen, Teil-Schließungen und Schließungen nötig.',
        tscopier: 'Automatisierte Einstiege, Layering, SL/TP-Verschiebungen und Management-Signale.',
      },
      {
        aspect: 'Plattform',
        other: 'Wichtige Funktionen werden als separate Produkte oder Upgrades verkauft.',
        tscopier: 'Copier, Backtest, Protokolle, Nachrichten und Kalender in einem Abo.',
      },
      {
        aspect: 'Trade-Zusammenführung',
        other:
          '„Gold jetzt kaufen“ eröffnet Trades, danach eröffnet „Gold jetzt kaufen“ mit SL/TP erneut – Sie verdoppeln oder korrigieren es manuell.',
        tscopier:
          '„Gold jetzt kaufen“ eröffnet den Trade. Wenn SL und TP in der nächsten Nachricht kommen, aktualisieren wir diese Trades – wir eröffnen Gold nicht erneut.',
      },
      {
        aspect: 'Bearbeitete Nachrichten',
        other: 'Bearbeitete Telegram-Nachrichten werden ignoriert – Sie verpassen SL/TP-Updates oder korrigieren Trades von Hand.',
        tscopier:
          'Signaländerung aus bearbeiteten Nachrichten synchronisiert Stop-Loss und Take-Profits über Ihren offenen Korb hinweg – keine neuen Trades.',
      },
      {
        aspect: 'Backtesting',
        other: 'Wenig oder kein echtes Abspielen der Kanalhistorie mit Ihren Regeln.',
        tscopier: 'Backtest vergangener Signale mit Ihren tatsächlichen Kopiereinstellungen, bevor Sie live gehen.',
      },
    ],
  },
  pricing: {
    title: 'Wählen Sie Ihren Plan',
    subtitle: 'Beginnen Sie noch heute, Signale auf Ihre Handelskonten zu kopieren.',
  },
  planComparison: {
    eyebrow: 'Pläne vergleichen',
    title: 'Finden Sie den passenden Plan',
    subtitle: 'Der direkte Vergleich dessen, was jeder Plan enthält.',
    basicColumn: 'Basic',
    advancedColumn: 'Advanced',
    customColumn: 'Custom',
    rows: [
      {
        feature: 'Broker-Konten',
        basic: '1',
        advanced: '5 (bis zu 100)',
        custom: 'Custom',
      },
      {
        feature: 'Signal-Backtests',
        basic: '5 / Monat',
        advanced: 'Unbegrenzt',
        custom: 'Custom',
      },
      {
        feature: 'Telegram-Kanäle',
        basic: '5',
        advanced: 'Unbegrenzt',
        custom: 'Custom',
      },
      {
        feature: 'TradingView-Webhooks',
        basic: '2',
        advanced: 'Unbegrenzt',
        custom: 'Custom',
      },
      {
        feature: 'Take-Profit-Level',
        basic: '3 TPs',
        advanced: 'Unbegrenzte TPs/SLs',
        custom: 'Custom',
      },
      {
        feature: 'Range-Handel & Layering',
        basic: 'no',
        advanced: 'yes',
        custom: 'yes',
      },
      {
        feature: 'Automatischer Break-even & Management',
        basic: 'no',
        advanced: 'yes',
        custom: 'yes',
      },
      {
        feature: 'Kanal-Keyword-Verfolgung',
        basic: 'no',
        advanced: 'yes',
        custom: 'yes',
      },
      {
        feature: 'Priorisierter Support',
        basic: 'no',
        advanced: 'no',
        custom: 'yes',
      },
      {
        feature: 'Persönliches Onboarding',
        basic: 'no',
        advanced: 'no',
        custom: 'yes',
      },
      {
        feature: 'Kostenlose Testphase',
        basic: 'no',
        advanced: '5 Tage',
        custom: 'Custom',
      },
      {
        feature: 'Einstiegspreis',
        basic: '9,99 $ / Monat',
        advanced: '39,99 $ / Monat',
        custom: 'Kontaktieren Sie uns',
      },
    ],
  },
  pricingFaq: {
    eyebrow: 'FAQ zu Preisen',
    title: 'Fragen zu Preisen',
    subtitle: 'Abrechnung, Testphasen und Planwechsel erklärt.',
    items: [
      {
        question: 'Gibt es eine kostenlose Testphase?',
        answer:
          'Ja. Advanced enthält eine 5-tägige kostenlose Testphase für neue Abonnenten (Karte bei der Kasse erforderlich; die Abrechnung startet nach der Testphase). Basic wird ab dem ersten Tag berechnet. Basic kostet 9,99 $/Monat (oder 95,90 $/Jahr). Advanced kostet 39,99 $/Monat (oder 383,90 $/Jahr).',
      },
      {
        question: 'Was ist der Unterschied zwischen monatlicher und jährlicher Abrechnung?',
        answer:
          'Die jährliche Abrechnung spart 20 % im Vergleich zu monatlichen Zahlungen über ein ganzes Jahr. Basic sinkt von 9,99 $/Monat auf effektiv 7,99 $/Monat (95,90 $/Jahr). Advanced sinkt von 39,99 $/Monat auf effektiv 31,99 $/Monat (383,90 $/Jahr). Zusätzliche Konten bei Advanced sind bei jährlicher Abrechnung ebenfalls vergünstigt.',
      },
      {
        question: 'Wie funktionieren zusätzliche Konten bei Advanced?',
        answer:
          'Advanced umfasst 5 Demo-/Live-Brokerkonten. Sie können bis zu 95 weitere für 10 $/Konto/Monat (oder 96 $/Konto/Jahr bei jährlicher Abrechnung) hinzufügen – maximal 100 verbundene Konten pro Nutzer.',
      },
      {
        question: 'Kann ich später den Plan wechseln?',
        answer:
          'Ja. Führen Sie jederzeit über „Abrechnung“ in Ihrem Dashboard ein Upgrade oder Downgrade durch. Änderungen treten je nach Abrechnungszyklus in Kraft, und Stripe rechnet anteilig ab, wenn Sie zwischen Plänen wechseln.',
      },
      {
        question: 'Welche Zahlungsmittel akzeptieren Sie?',
        answer:
          'Wir akzeptieren gängige Kredit- und Debitkarten über Stripe. Rechnungen und Zahlungsverlauf können Sie auf Ihrer Abrechnungsseite herunterladen.',
      },
      {
        question: 'Wann sollte ich Custom wählen?',
        answer:
          'Custom ist für Prop-Firms, Trading-Teams oder Händler mit hohem Volumen gedacht, die Kontolimits, Abrechnung oder Onboarding auf ihren Arbeitsablauf zuschneiden möchten. Kontaktieren Sie den Vertrieb, und wir erstellen einen passenden Plan.',
      },
      {
        question: 'Kann ich jederzeit kündigen?',
        answer:
          'Ja. Kündigen Sie über „Abrechnung“ oder das Stripe-Kundenportal. Der Zugriff bleibt bis zum Ende des aktuellen Abrechnungszeitraums bestehen. Basic und Advanced haben keine langfristigen Verträge.',
      },
    ],
  },
  pricingSocialProof: {
    banner: '{count} Trader haben heute gekauft',
    purchaseToast: 'Ein Trader aus {country} hat gerade ein {plan}-Abonnement gekauft.',
    timeAgoJustNow: 'Gerade eben',
    timeAgoOneMinute: 'Vor 1 Minute',
  },
  pricingSnippet: {
    basic: 'Basic — 9,99 $/Monat',
    advanced: 'Advanced — 39,99 $/Monat',
  },
  footer: {
    cta: {
      title: 'Bereit, Signale ohne manuelle Arbeit zu kopieren?',
      subtitle:
        'Verbinden Sie Telegram, MT4 oder MT5 und beginnen Sie in Minuten mit dem Kopieren – kein VPS, keine Installation.',
      primary: 'Starten Sie Ihre 5-tägige kostenlose Testphase',
      secondary: 'Anmelden',
    },
    tagline: 'Der All-in-One-Copier für jeden Forex- und Krypto-Trader',
    columns: {
      product: 'Produkt',
      resources: 'Ressourcen',
      account: 'Konto',
    },
    links: {
      overview: 'Überblick',
      features: 'Funktionen',
      pricing: 'Preise',
      howItWorks: 'So funktioniert es',
      faq: 'FAQ',
      docs: 'Dokumentation',
      status: 'Systemstatus',
      telegram: 'Telegram-Support',
      riskDisclaimer: 'Risikohinweis',
      termsOfService: 'Nutzungsbedingungen',
      privacyPolicy: 'Datenschutzerklärung',
      cookiePolicy: 'Cookie-Richtlinie',
      signIn: 'Anmelden',
      signUp: 'Konto erstellen',
      openApp: 'Dashboard öffnen',
    },
    platforms: 'Funktioniert mit',
    copyright: '© {year} Tartarix Inc. Alle Rechte vorbehalten.',
    disclaimer:
      'Handel birgt Risiken. UniCopier ist ein Kopiwerkzeug – keine Finanzberatung.',
  },
}
