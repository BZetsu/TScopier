import { authDe } from '../auth/de'
import { channelWorkerDe } from '../channelWorker/de'
import { contactSupportDe } from '../contactSupport/de'
import { supportWidgetDe } from '../supportWidget/de'
import { riskDisclaimerDe } from '../riskDisclaimer/de'
import { tradeNotificationsDe } from '../tradeNotifications/de'
import { statusPageDe } from '../statusPage/de'
import { accountConfigDe } from './accountConfig/de'
import { backtestDe } from './backtest/de'
import { chromeDe } from './chrome/de'
import { copierEngineDe } from './copierEngine/de'
import { copyRiskDe } from './copyRiskLabels'
import { dashboardDe } from './dashboard/de'
import { en } from './en'
import { landingDe } from './landing/de'
import { legalDe } from './legalBundle/de'
import { logsDe } from './logs/de'
import { mergeLocaleBundle } from './merge'
import { pricingDe } from './pricing/de'
import { settingsDe } from './settings/de'
import { socialTradingDe } from './socialTrading/de'
import { toolsDe } from './tools/de'
import { tradingDe } from './trading/de'
import type { Translations } from './types'

/**
 * German product interface.
 *
 * Full assembly: every section of the English bundle is either supplied by a
 * German module (spread or assigned below) or translated inline, so nothing is
 * English today. `mergeLocaleBundle` still overlays English for any key a
 * future English change adds and this bundle does not supply — the committed
 * `completeness.test.ts` enforces full leaf and placeholder parity for de and
 * tr. The inline sections — trustpilotPrompt, mirrorTradingPage,
 * mirrorSlaveGuard, configurationsPage, management, signalHistoryPage,
 * brokersPage and wallet — are complete objects, so `mergeLocaleBundle` only
 * has to rebuild `copierLogs.skipReasons` from the English catalog, the
 * localized Channel Worker labels and the `logs/de.ts` overrides.
 */
export const de: Translations = mergeLocaleBundle(en, {
  ...chromeDe, // nav, globalSearch, common, pages
  ...dashboardDe, // dashboard
  ...logsDe, // copierLogs
  ...settingsDe, // settings
  ...accountConfigDe, // accountConfig
  ...backtestDe, // backtest
  ...pricingDe, // pricing
  ...toolsDe, // marketNews, economicCalendar, performance, affiliate
  ...tradingDe, // trades, channelsPage, popularChannelsPage
  ...socialTradingDe, // socialTradingPage
  ...copierEngineDe, // copierEnginePage
  ...legalDe, // termsOfServicePage, privacyPolicyPage, cookiePolicyPage
  landing: landingDe,
  auth: authDe,
  channelWorker: channelWorkerDe,
  contactSupportPage: contactSupportDe,
  supportWidget: supportWidgetDe,
  riskDisclaimerPage: riskDisclaimerDe,
  tradeNotifications: tradeNotificationsDe,
  statusPage: statusPageDe,
  copyRisk: copyRiskDe,

  trustpilotPrompt: {
    eyebrow: 'Feedback',
    title: 'Wie bewerten Sie Ihre Erfahrung?',
    body: 'Bewerten Sie uns auf Trustpilot und helfen Sie anderen Tradern bei der Entscheidung.',
    starsAria: 'Sternbewertung',
    starAria: '{n} Sterne',
    tapStars: 'Tippen Sie auf einen Stern, um zu bewerten',
    selected: '{n} von 5',
    rateCta: 'Auf Trustpilot bewerten',
    remindLater: 'Später erinnern',
    close: 'Schließen',
  },

  mirrorTradingPage: {
    title: 'Mirror-Konten',
    subtitle: 'Kopieren Sie Trades von einem Master-Konto auf Slave-Konten.',
    searchDescription: 'Kopieren Sie Trades von einem Master-Konto auf Slave-Konten.',
    masters: 'Master-Konten',
    slaves: 'Slave-Konten',
    addMaster: 'Master-Konto hinzufügen',
    addSlave: 'Slave-Konto hinzufügen',
    mastersEmpty: 'Verbinden Sie das Konto, dessen Trades kopiert werden sollen.',
    emptyTitle: 'Noch keine Mirror-Konten',
    emptyBody:
      'Verbinden Sie ein Master-Konto, dessen Trades kopiert werden sollen, und fügen Sie dann Slave-Konten mit eigenen Risikoeinstellungen hinzu.',
    emptyStep1: 'Master hinzufügen',
    emptyStep2: 'Slaves verbinden',
    emptyStep3: 'Kopieren starten',
    slavesEmpty: 'Verbinden Sie die Konten, die einem Master folgen sollen.',
    connectNew: 'Neues Konto verbinden',
    noAccounts: 'Noch keine anderen verbundenen Konten.',
    copies: 'Kopien',
    copiesNone: 'Keine',
    remove: 'Entfernen',
    login: 'Login',
    balance: 'Kontostand',
    master: 'Master',
    slave: 'Slave',
    colAccount: 'Kontoname',
    colCopyFrom: 'Kopieren von',
    colRiskType: 'Risikotyp',
    colRiskSetting: 'Risikoeinstellung',
    colStatus: 'Status',
    colActions: 'Aktionen',
    configure: 'Konfigurieren',
    pause: 'Pausieren',
    resume: 'Fortsetzen',
    delete: 'Löschen',
    riskFixedLot: 'Festes Lot',
    riskBalancePercent: 'Prozent des Kontostands',
    expandSlaves: 'Slaves anzeigen',
    collapseSlaves: 'Slaves ausblenden',
    resultPerPage: 'Ergebnis pro Seite',
    pageStatus: '{start}–{end} von {total}',
    back: 'Zurück',
    next: 'Weiter',
    loadError: 'Diese Änderung konnte nicht gespeichert werden.',
    startCopying: 'Kopieren starten',
    pauseCopying: 'Kopieren pausieren',
    stopCopying: 'Kopieren stoppen',
    stopCopyingConfirm:
      'Kopieren stoppen und alle kopierten Trades auf diesem Slave-Konto schließen? Das Kopieren bleibt aus, bis Sie es erneut starten.',
    closingCopies: 'Kopierte Trades werden geschlossen…',
    removeSlaveConfirm:
      'Dieses Slave-Konto entfernen? Alle darauf noch offenen kopierten Trades werden zuerst geschlossen.',
    statusActive: 'Kopieren aktiv',
    statusPaused: 'Pausiert',
    statusStopped: 'Gestoppt',
    statusStopping: 'Wird gestoppt…',
    statusError: 'Kopierfehler',
    slaveChannelConflictTitle: 'Konto mit Telegram-Kanälen verbunden',
    slaveChannelConflictBody:
      'Dieses Konto ist derzeit mit Telegram-Kanälen verbunden, die Ihnen gehören. Damit es ein Slave-Konto sein kann, müssen Sie die Kanäle trennen. Dies geschieht, um doppelte Trades zu verhindern.',
    slaveChannelConflictChannelsLabel: 'Verbundene Kanäle',
    slaveChannelConflictUseDifferent: 'Anderes Konto verwenden',
    slaveChannelConflictDisconnect: 'Kanäle trennen',
    slaveChannelConflictDisconnecting: 'Kanäle werden getrennt…',
    setup: {
      title: '{account} konfigurieren',
      preview: 'Einrichtungsvorschau',
      subtitle: 'Wählen Sie, wie dieses Slave-Konto Trades vom Master-Konto kopiert.',
      copyMethod: 'Kopiermethode',
      protections: 'Schutzoptionen',
      moreSettings: 'Weitere Limits',
      symbolMapping: {
        title: 'Symbolzuordnung',
        hint: 'Benennen Sie die Symbole des Masters in die Namen um, die dieses Konto verwendet (z. B. XAUUSD zu GOLD). Nicht aufgeführte Symbole werden unverändert kopiert.',
        master: 'Master-Symbol',
        slave: 'Slave-Symbol',
        add: 'Zuordnung hinzufügen',
        remove: 'Zuordnung entfernen',
        empty: 'Noch keine Zuordnungen — Symbole werden mit ihren Originalnamen kopiert.',
      },
      exampleTrade: 'Beispiel-Trade des Masters',
      masterSize: 'Master-Größe',
      slaveAccount: 'Slave-Konto',
      estimatedLot: 'Geschätztes kopiertes Lot',
      copied: 'Kopiert',
      notCopied: 'Nicht kopiert',
      riskProfile: 'Risikoprofil',
      estimateUnavailable: 'Wird angezeigt, wenn ein Live-Trade einen Stop hat',
      lots: 'Lots',
      done: 'Fertig',
      advanced: 'Erweitert',
      advancedHint: 'Alle Kopiermethoden und Limits anzeigen.',
      proportional: 'Proportional zum Kontostand',
      riskMultiplier: 'Risikomultiplikator',
      proportionalProfile: 'Proportional zum Kontostand',
      fixedCopiedLot: 'Festes kopiertes Lot',
      copiedLot: 'Kopiertes Lot',
      modes: {
        fixed_lot: 'Für jeden kopierten Trade dieselbe Lot-Größe verwenden.',
        lot_multiplier: 'Die Lot-Größe des Masters mit dem von Ihnen gewählten Faktor multiplizieren.',
        balance_ratio: 'Das Lot des Masters anhand der beiden Kontostände skalieren.',
        equity_ratio: 'Das Lot des Masters anhand der Equity beider Konten skalieren.',
        percent_risk: 'Ein Prozentsatz der Equity als Risiko, wenn der Stop getroffen wird.',
        cash_risk: 'Ein Geldbetrag als Risiko, wenn der Stop getroffen wird.',
        stop_distance: 'Das Lot anhand der Stop-Distanz des Masters skalieren.',
      },
    },
  },

  mirrorSlaveGuard: {
    channelConnectTitle: 'Bereits im Mirror-Trading verwendet',
    channelConnectBody:
      'Dieses Konto wird derzeit im Mirror-Trading als Slave verwendet. Wenn Sie es mit einem Kanal verbinden, den der Master bereits kopiert, kann das zu doppelten Trades führen.',
    masterAccountLabel: 'Master-Konto',
    proceed: 'Fortfahren',
    disconnectMirror: 'Mirror-Trading trennen',
    disconnectingMirror: 'Wird getrennt…',
  },

  configurationsPage: {
    title: 'Konfigurationen',
    searchDescription: 'Sehen Sie die Handelseinstellungen, die jeder Broker für jeden Kanal verwendet.',
    copyingOn: 'Kopieren ein',
    master: 'Master',
    copyingOff: 'Kopieren aus',
    login: 'Login',
    username: 'Benutzername',
    channelId: 'ID',
    subscribers: 'Abonnenten',
    balance: 'Kontostand',
    equity: 'Equity',
    accountType: 'Kontotyp',
    accountTypeLive: 'Live',
    accountTypeDemo: 'Demo',
    accountTypePropFirm: 'Prop-Firm',
    noChannelsLinked: 'Keine Kanäle verknüpft',
    noConfigurationsYet: 'Noch keine Konfigurationen',
    openConfiguration: 'Konfiguration öffnen',
    emptyTitle: 'Noch keine Broker',
    emptyBody:
      'Verbinden Sie einen Broker und verknüpfen Sie einen Kanal, um seine Konfiguration hier zu sehen.',
    openBrokers: 'Zu Brokers gehen',
    unknownChannel: 'Unbekannter Kanal',
    on: 'EIN',
    off: 'AUS',
    lotSize: 'Lot-Größe',
    layeringMode: 'Layering-Modus',
    layeringAutomatic: 'Automatisch',
    layeringPending: 'Pending-Orders des Brokers',
    allSymbols: 'Alle',
    none: 'Keine',
    editConfiguration: '{channel} auf {broker} bearbeiten',
    viewConfiguration: '{channel} auf {broker} ansehen',
    edit: 'Bearbeiten',
    addChannel: 'Quelle hinzufügen',
    addBroker: 'Neuen Broker hinzufügen',
    addDestination: 'Ziel hinzufügen',
    copyFrom: 'Kopieren von:',
    copyTo: 'Kopieren nach:',
    dragToConnect: 'Ziehen Sie {channel} zu einem Broker',
    dragToDisconnect: 'Ziehen Sie {channel} von {broker} weg, um die Verbindung zu trennen',
    removeChannel: 'Kanal entfernen',
    removeSource: 'Quelle entfernen',
    removeDestination: 'Ziel entfernen',
    noAvailableChannels: 'Alle Ihre Kanäle sind bereits auf dieser Seite.',
    noAvailableBrokers: 'Alle Ihre Broker sind bereits Quellen.',
    sourceKindPrompt: 'Von wo möchten Sie kopieren?',
    sourceTelegram: 'Telegram-Kanal',
    sourceBroker: 'MT4/MT5-Broker',
    loadError: 'Die Kanalkonfigurationen konnten nicht geladen werden.',
  },

  management: {
    title: 'Copier-Prozess',
    subtitle: 'Sehen Sie sich die Aktivitäten des Copier-Prozesses aus Ihren Signalkanälen an.',
    filterAll: 'Alle',
    filterSuccessful: 'Erfolgreich',
    filterSkipped: 'Übersprungen',
    filterFailed: 'Fehlgeschlagen',
    statusSuccessful: 'Erfolgreich',
    statusSkipped: 'Übersprungen',
    statusFailed: 'Fehlgeschlagen',
    retry: 'Erneut versuchen',
    retryAll: 'Alle erneut versuchen',
    retrySuccess: 'Erneutes Versuchen gesendet — eine neue Aktivität erscheint gleich.',
    retryAllSuccess: '{count} fehlgeschlagene Aktivitäten erneut versucht.',
    retryFailedGeneric: 'Diese Aktivität konnte nicht erneut versucht werden.',
    retryFailedDetail: 'Erneutes Versuchen fehlgeschlagen: {reason}',
    retryReasonNotFound: 'Aktivität nicht gefunden.',
    retryReasonNotFailed: 'Nur fehlgeschlagene Aktivitäten können erneut versucht werden.',
    retryReasonNotEligible: 'Dieser Aktivitätstyp kann nicht erneut versucht werden.',
    retryReasonNoSignal: 'Das verknüpfte Signal fehlt.',
    retryReasonNotRetryable: 'Das Signal kann nicht erneut ausgeführt werden.',
    retryReasonDispatchRejected: 'Der Copier konnte den erneuten Versuch nicht annehmen.',
    retryReasonWorkerUnavailable:
      'Der Trade-Worker ist nicht verfügbar — versuchen Sie es gleich erneut.',
    emptyTitle: 'Noch keine Aktivitäten',
    emptySubtitle:
      'Aktivitäten des Copier-Prozesses erscheinen hier, sobald Ihr Copier Aktionen aus Signalkanälen ausführt.',
    emptyFailedTitle: 'Keine fehlgeschlagenen Aktivitäten',
    kindBreakeven: 'SL auf Break-even',
    kindClose: 'Trade schließen',
    kindCloseWorseEntries: 'Schlechtere Einstiege schließen',
    kindModify: 'SL/TP aktualisieren',
    kindOrder: 'Orderausführung',
    kindLayering: 'Gestaffelter Einstieg',
    kindPipeline: 'Signalverarbeitung',
    kindOther: 'Trade-Aktivität',
  },

  signalHistoryPage: {
    allChannels: 'Alle Kanäle',
    dateFrom: 'Von',
    dateTo: 'Bis',
    presetAll: 'Gesamter Zeitraum',
    presetToday: 'Heute',
    preset7d: 'Letzte 7 Tage',
    preset30d: 'Letzte 30 Tage',
    presetCustom: 'Eigener Zeitraum',
    resetFilters: 'Filter zurücksetzen',
    totalFound: '{count} Trade-Signale',
    noSignals: 'Keine Trade-Signale für die gewählten Filter.',
    colChannel: 'Kanal',
    colSignal: 'Signal',
    colTime: 'Zeit',
    signalsToday: 'Signale heute',
    signalsLast7d: 'Letzte 7 Tage',
    signalsLast30d: 'Letzte 30 Tage',
    signalsTotal: 'Gesamter Zeitraum',
    actionBuy: 'Kaufen',
    actionSell: 'Verkaufen',
    actionClose: 'Schließen',
    actionCloseWorseEntries: 'Schlechtere Einstiege schließen',
    actionBreakeven: 'SL auf Break-even setzen',
    actionModify: 'SL/TP aktualisieren',
    actionPartialProfit: 'Teilgewinn entnehmen',
    actionPartialBreakeven: 'Teilgewinn + Break-even',
    onSymbol: 'bei {symbol}',
    entryAt: 'Einstieg {price}',
    slAt: 'SL {price}',
    tpAt: 'TP {prices}',
    statusOpen: 'Offen',
    statusClosed: 'Geschlossen',
    editSignal: 'SL/TP bearbeiten',
    updateLiveTrades: 'Live-Trades aktualisieren',
    resendParameters: 'Parameter erneut senden',
    saving: 'Order wird gesendet',
    originalSignal: 'Kanalsignal',
    overrideSignal: 'Aktuelle Überschreibung',
    channelMessageLabel: 'Kanalnachricht',
    brokerAccountLabel: 'Broker-Konto',
    accountsHolding: 'Broker-Konten mit diesem Signal',
    closeOneAccount: 'Dieses Konto schließen',
    applySuccess: 'Überschreibung gespeichert. Auf {count} offene(s) Bein(e) angewendet.',
    applyQueued:
      'Überschreibung gespeichert. SL/TP wird im Hintergrund auf offene Trades angewendet.',
    applyBrokerSummary: '{updated} von {total} Broker(n) aktualisiert.',
    applyPartialBrokers:
      'Überschreibung gespeichert. {updated} von {total} Broker(n) aktualisiert — die restlichen werden abgeglichen.',
    applyFailed: 'Überschreibung konnte nicht gespeichert werden',
    invalidLevels: 'Geben Sie einen gültigen SL und/oder mindestens ein TP-Level ein.',
    closedReadOnly: 'Geschlossene Signale sind schreibgeschützt.',
    stopLoss: 'Stop-Loss',
    takeProfits: 'Take-Profit-Level',
    addTp: 'TP hinzufügen',
    removeTp: 'TP entfernen',
    closeModal: 'Schließen',
    closeTrade: 'Diesen Trade schließen',
    closeConfirmTitle: 'Diesen Trade schließen?',
    closeConfirmBody:
      'Dies schließt die Live-Position(en), die aus diesem Signal auf Ihrem Broker-Konto eröffnet wurden. Das kann nicht rückgängig gemacht werden.',
    confirmClose: 'Ja, Trade schließen',
    cancelAction: 'Abbrechen',
    closing: 'Wird geschlossen…',
    closeSuccess: 'Trade geschlossen. {count} Position(en) geschlossen.',
    closePartial:
      '{closed} von {total} Position(en) geschlossen. Einige konnten nicht geschlossen werden.',
    closeFailed: 'Der Trade konnte nicht geschlossen werden.',
    closeMarketClosed:
      'Der Markt ist gerade geschlossen — Sie können diesen Trade schließen, wenn er wieder geöffnet ist.',
    applyMarketClosed:
      'Der Markt ist gerade geschlossen — die SL/TP-Änderung konnte nicht angewendet werden. Versuchen Sie es erneut, wenn der Markt wieder geöffnet ist.',
    closeNoOpenTrades: 'Für dieses Signal wurden keine offenen Positionen gefunden.',
    closeNotConnected: 'Das Broker-Konto ist nicht verbunden.',
    closeRetry: 'Der Trade-Dienst hat nicht geantwortet. Bitte versuchen Sie es erneut.',
    closeQueuedRemoved:
      '{count} wartende Einträge entfernt. Es gab keine offenen Positionen zum Schließen.',
    closeSignalGone: 'Dieses Signal ist nicht mehr verfügbar.',
    autoCloseIn: 'Wird automatisch in {seconds} Sekunden geschlossen.',
    doneTitle: 'Fertig',
    colStatus: 'Status',
    updatesReceivedToday: 'Signale heute',
    updatesReceivedLast7d: 'Letzte 7 Tage',
    updatesReceivedLast30d: 'Letzte 30 Tage',
    updatesReceivedTotal: 'Gesamter Zeitraum',
    updatesReceivedThisWeek: 'Diese Woche',
    updatesReceivedThisMonth: 'Dieser Monat',
  },

  brokersPage: {
    title: 'MT5-Broker-Terminals',
    subtitle:
      'Verbinden und testen Sie Cloud-MT5-Terminals Seite an Seite mit Ihren bisherigen mt4api.dev-Brokern.',
    mt5OnlyNote:
      'Das Verknüpfen von Cloud-MT5 unterstützt nur MT5. Der Vergleich mit dem Bestandssystem kann MT4 sein — Kurs und Übersicht funktionieren weiterhin; der Demo-Trade-Vergleich wird bei MT4 übersprungen.',
    apiKeyRotationNote:
      'Nach dem Rotieren Ihres Broker-API-Schlüssels warten Sie etwa 5 Minuten, bis die Terminals den neuen Schlüssel übernehmen. Kurzzeitige 5xx-Antworten während des Neustarts sind normal.',
    setupNote:
      'Verknüpfen Sie MT5-Konten mit Login, Passwort und Server — nur das Edge-Geheimnis FXSOCKET_API_KEY ist erforderlich (POST /v1/accounts). Entfernen Sie alle alten FXSOCKET_CONNECT_URL-Geheimnisse.',
    sectionAccounts: 'Verknüpfte MT5-Konten',
    sectionCompare: 'Vergleich Seite an Seite',
    sectionRawLog: 'Rohes API-Protokoll',
    connectTitle: 'MT5-Konto verbinden',
    labelField: 'Bezeichnung',
    loginField: 'MT5-Login',
    passwordField: 'Passwort',
    serverField: 'Broker-Server',
    connectButton: 'Verbinden',
    connecting: 'Terminal wird gestartet…',
    refresh: 'Aktualisieren',
    delete: 'Entfernen',
    copyUuid: 'UUID kopieren',
    uuidCopied: 'UUID kopiert',
    openSwagger: 'Swagger öffnen',
    lastSynced: 'Zuletzt synchronisiert {time}',
    noAccounts:
      'Noch keine verknüpften MT5-Konten. Verbinden Sie ein Demo-Konto, um mit dem Testen zu beginnen.',
    compareFxAccount: 'Cloud-MT5-Konto',
    compareLegacyBroker: 'Bestandsbroker (Konfiguration)',
    symbolField: 'Symbol für Kurstest',
    runDiagnostics: 'Diagnose ausführen',
    runDemoTrade: 'Demo-Trade-Test ausführen',
    compareRunning: 'Vergleich wird ausgeführt…',
    compareTableOperation: 'Operation',
    compareTableFxMs: 'Cloud (ms)',
    compareTableLegacyMs: 'Bestand (ms)',
    compareTableDelta: 'Delta',
    compareTableStatus: 'Status',
    statusOk: 'OK',
    statusError: 'Fehler',
    demoTradeTitle: 'Demo-Trade-Test bestätigen',
    demoTradeBody:
      'Dies sendet einen Micro-Lot-Marktkauf sowohl an das Cloud-MT5-Terminal als auch an den ausgewählten Bestands-Demo-Broker (nur MT5). Fahren Sie nur mit Demo-Konten fort, die Ihnen gehören.',
    demoTradeConfirm: 'Demo-Testtrade senden',
    demoTradeCancel: 'Abbrechen',
    connectionStatus: {
      connecting: 'Verbinden',
      connected: 'Verbunden',
      error: 'Fehler',
      disconnected: 'Getrennt',
    },
    opLabels: {
      account_summary: 'Kontoübersicht',
      quote: 'Kurs',
      opened_orders: 'Eröffnete Orders',
      order_send: 'Demo-Order senden',
    },
    loadError: 'Die verknüpften MT5-Konten konnten nicht geladen werden.',
    connectError: 'Verbindung fehlgeschlagen.',
    deleteConfirm: 'Dieses MT5-Konto aus UniCopier entfernen?',
    selectFxAccount: 'Cloud-MT5-Konto auswählen',
    selectLegacyBroker: 'Bestandsbroker auswählen',
    docsUrl: 'https://fxsocket.com/docs#request-builder',
    docsLinkLabel: 'Trading-API (Request Builder)',
    v1DocsUrl: 'https://api.fxsocket.com/v1/docs#/',
    v1DocsLinkLabel: 'Konten-Verknüpfungs-API (v1)',
    docsEndpointNote:
      'Trading- und Datenaufrufe laufen serverseitig über Edge — die Broker-API hat keine CORS-Header.',
    linkExistingTitle:
      'Erweitert: Ein Konto verknüpfen, das bereits auf der Cloud-Plattform verbunden ist',
    existingUuidField: 'Konto-UUID (aus dem Dashboard Ihres Cloud-Terminals)',
    linkExistingButton: 'Konto verknüpfen',
    connectModeCredentials: 'Mit MT5-Zugangsdaten verbinden',
    connectModeLinkUuid: 'Vorhandene UUID verknüpfen',
  },

  wallet: {
    title: 'Wallet',
    subtitle: 'Anbieter-Einnahmen und Auszahlungsdetails für Gebühren von Kopierabonnements.',
    available: 'Verfügbar',
    pending: 'Ausstehend',
    refresh: 'Aktualisieren',
    history: 'Zahlungshistorie',
    colDate: 'Datum',
    colDescription: 'Beschreibung',
    colAmount: 'Betrag',
    colStatus: 'Status',
    colRole: 'Rolle',
    statusPending: 'Ausstehend',
    statusPaid: 'Bezahlt',
    statusReversed: 'Storniert',
    rolePayer: 'Gezahlt',
    roleProvider: 'Erhalten',
    empty: 'Noch keine Zahlungen.',
    loadError: 'Ihre Wallet konnte nicht geladen werden.',
    payoutTitle: 'Auszahlungsmethode',
    payoutBody:
      'Fügen Sie eine TRC20-Wallet-Adresse hinzu, um USDT- oder USDC-Auszahlungen zu erhalten.',
    payoutAsset: 'Asset',
    payoutNetwork: 'Netzwerk',
    payoutAddress: 'Wallet-Adresse',
    payoutAddressPlaceholder: 'T…',
    payoutSave: 'Auszahlungsmethode speichern',
    payoutClear: 'Entfernen',
    payoutSaved: 'Auszahlungsmethode gespeichert.',
    payoutSaveError: 'Die Auszahlungsmethode konnte nicht gespeichert werden.',
    payoutFeeNote:
      'Bei der Verarbeitung von Auszahlungen kann eine Plattform-Auszahlungsgebühr anfallen.',
  },
})
