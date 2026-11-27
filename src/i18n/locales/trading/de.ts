import type { TradingPagesBundleTranslations } from './types'

export const tradingDe: TradingPagesBundleTranslations = {
  trades: {
    title: 'Kontotrades',
    subtitle: 'Live-Positionen und kürzlich geschlossene Trades von Ihren verbundenen Brokerkonten',
    filterOpen: 'Offen',
    filterClosed: 'Geschlossen',
    filterAll: 'Alle',
    refresh: 'Aktualisieren',
    emptyTitle: 'Keine Trades zum Anzeigen',
    emptySubtitleConnect:
      'Verbinden Sie ein Brokerkonto in {page}, um hier Live-Trades zu sehen.',
    emptySubtitleOpen: 'Keine offenen Positionen auf einem Ihrer verbundenen Brokerkonten.',
    emptySubtitleClosed: 'Keine kürzlich geschlossenen Orders in dieser MT-Sitzung.',
    modalTitle: 'Trade-Details',
    close: 'Schließen',
    manage: 'Verwalten',
    tradeSummary: 'Trade',
    signalChannel: 'Signalkanal',
    telegramMessage: 'Telegram-Nachricht',
    parsedInstruction: 'Analysierte Anweisung',
    signalTime: 'Signal empfangen',
    noLinkedSignal: 'Für diesen Trade gibt es kein zugehöriges UniCopier-Signal.',
    copiedFromMasterTitle: 'Mirror-Kopie',
    copiedFromMaster: 'Kopiert vom Master-Konto {login}',
    copiedFromSocialTitle: 'Social Trading',
    copiedFromSocial: 'Kopiert von {provider}',
    socialProviderTicket: 'Provider-Ticket #{ticket}',
    closeCopy: 'Kopie schließen',
    closeCopyConfirm:
      'Diesen kopierten Trade auf dem Slave-Konto schließen? Der Master-Trade bleibt offen — diese Kopie wird nicht erneut geöffnet.',
    closeCopyWorking: 'Kopie wird geschlossen…',
    closeCopyDone: 'Kopie geschlossen',
    closeCopyTimeout:
      'Schließen angefordert — der Worker schließt sie innerhalb von etwa einer Minute. Aktualisieren Sie die Seite, falls sie weiterhin als offen angezeigt wird.',
    closeCopyRetry: 'Schließen erneut versuchen',
    closeCopyError: 'Die Kopie konnte nicht geschlossen werden: {error}',
    closeCopyErrorFallback: 'Die Kopie konnte nicht geschlossen werden. Versuchen Sie es erneut.',
    execNotesTitle: 'Ausführungshinweise',
    execNoteTpSplit:
      'Einige partiellen Take-Profits wurden übersprungen — dieses Lot ist zu klein für eine Aufteilung (diese Teilpositionen lägen unter dem Broker-Minimum). Die verbleibenden Take-Profits gelten weiterhin.',
    execNotePartialCloseTooSmall:
      'Ein angeforderter partieller Schluss konnte nicht ausgeführt werden — diese Position war zu klein für eine Aufteilung (der angeforderte Teil läge unter dem Broker-Minimum-Lot); dadurch wurde nichts geschlossen und der Trade blieb in voller Größe.',
    execNoteStaleEntry:
      'Der Signaleinstieg lag bei {entry}, aber der Trade wurde zu {fill} eröffnet — der Preis hatte sich bereits bewegt, als die Order gesendet wurde.',
    execNoteTpStripped:
      'Take-Profits {levels} wurden entfernt — der Trade wurde zu {fill} eröffnet, bereits hinter dem Take-Profit-Preis, weshalb ihre Ansetzung den Trade sofort geschlossen hätte.',
    imageSignal: '(Bildsignal)',
    loadingSignal: 'Signal wird geladen…',
    loadSignalError: 'Die Signaldetails konnten nicht geladen werden.',
    viewDetails: 'Details anzeigen',
    statusOpen: 'Offen',
    statusClosed: 'Geschlossen',
    colBroker: 'Broker',
    colEntry: 'Einstieg',
    colSl: 'SL',
    colTp: 'TP',
    colLots: 'Lots',
    colPnl: 'PnL',
    colTime: 'Datum & Uhrzeit',
    colCurrent: 'Live-Preis',
    colClosePrice: 'Schlusskurs',
    instructionAction: 'Aktion',
    instructionSymbol: 'Symbol',
    instructionEntry: 'Einstieg',
    instructionEntryZone: 'Einstiegszone',
    instructionSl: 'Stop-Loss',
    instructionTp: 'Take-Profit',
    instructionLotSize: 'Lotgröße',
    instructionMessage: 'Anweisung',
    report: 'Melden',
    reportTitle: 'Diesen Trade melden',
    reportSubtitle:
      'Sagen Sie uns, was falsch aussieht — unser Support-Team prüft jede Meldung.',
    reportCategory: 'Was sieht falsch aus?',
    catWrongEntry: 'Falscher Einstiegspreis',
    catWrongSl: 'Falscher Stop-Loss',
    catWrongTp: 'Falscher Take-Profit',
    catWrongDirection: 'Falsche Richtung',
    catWrongLots: 'Falsche Lotgröße',
    catNotExecuted: 'Trade wurde nicht ausgeführt',
    catOther: 'Sonstiges',
    reportReason: 'Beschreiben Sie das Problem',
    reportReasonPlaceholder:
      'z. B. der Einstieg lag bei 4235, aber mein Trade wurde zu 4250 gefüllt…',
    reportSubmit: 'Meldung absenden',
    reportSuccess: 'Meldung gesendet — unser Support-Team prüft sie in Kürze.',
    reportError: 'Die Meldung konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',
    reportsTitle: 'Gemeldete Trades',
    reportsSubtitle:
      'Status der Trades, die Sie gemeldet haben. Unser Support-Team prüft jede Meldung.',
    reportsEmpty:
      'Sie haben noch keine Trades gemeldet. Sie können einen Trade auf der Seite Kontotrades melden oder den Assistenten fragen.',
    reportsStatusOpen: 'Offen',
    reportsStatusResolved: 'Behoben',
    brokerErrorTitle: 'Brokerfehler',
    brokerErrorIntro:
      'Der Broker hat eine oder mehrere Orders dieses Trades abgelehnt oder sie konnten nicht ausgeführt werden.',
    viewCopierLogs: 'In den Copier-Protokollen anzeigen',
    closeReason: 'Schließgrund',
    reasonNewsPreClose:
      'Automatisch vor einer geplanten Nachricht mit hoher Marktwirkung geschlossen.',
    reasonSignalClose:
      'Geschlossen, weil der Signalkanal eine Schließanweisung gesendet hat.',
    reasonSignalRevision: 'Geschlossen, weil ein überarbeitetes Signal es ersetzt hat.',
    reasonOppositeSignal:
      'Geschlossen, weil ein gegensätzliches Signal einen neuen Trade eröffnet hat.',
    reasonPartialTp:
      'Geschlossen, nachdem der letzte Teil eines Take-Profit-Schlusses abgeschlossen war.',
    reasonAutoManagement: 'Durch automatisches Trade-Management geschlossen.',
    reasonCloseWorseEntries: 'Geschlossen, um Platz für bessere Einstiege zu schaffen.',
    reasonCopyLimitFlatten:
      'Automatisch geschlossen, als das Kopierlimit erreicht wurde.',
    reasonUserForceClose: 'Von Ihnen geschlossen.',
    reasonSignalDeleted: 'Geschlossen, weil die Signalnachricht gelöscht wurde.',
    reasonPositionGone:
      'Die Position war beim Broker bereits verschwunden, als wir geprüft haben.',
    reasonStopLoss: 'Der Broker hat sie zum Stop-Loss geschlossen ({price}).',
    reasonTakeProfit: 'Der Broker hat sie zum Take-Profit geschlossen ({price}).',
    reasonUnknown: 'Für diesen Trade wurde kein Schließgrund erfasst.',
    cancel: 'Abbrechen',
    reasonMirrorSourceClosed:
      'Der Originaltrade wurde geschlossen, daher wurde auch diese Kopie geschlossen.',
    reasonMirrorCopyClosed:
      'Dieser kopierte Trade wurde geschlossen, bevor Schließgründe erfasst wurden.',
  },
  channelsPage: {
    title: 'Signale',
    subtitle: 'Verwalten Sie, welche Telegram-Kanäle Sie überwachen',
    addChannel: 'Kanal hinzufügen',
    addFormTitle: 'Kanal manuell hinzufügen',
    channelName: 'Kanalname',
    channelNamePlaceholder: 'z. B. Gold Signals Pro',
    usernameOptional: 'Benutzername (optional)',
    usernamePlaceholder: '@kanalname',
    channelIdOptional: 'Kanal-ID (optional)',
    channelIdPlaceholder: 'Telegram-Kanal-ID',
    channelIdHint: 'Leer lassen, um den Benutzernamen zu verwenden',
    nameRequired: 'Kanalname ist erforderlich',
    emptyTitle: 'Noch keine Kanäle',
    emptySubtitle: 'Fügen Sie einen Signalkanal hinzu, um mit dem Überwachen zu beginnen',
    statusPaused: 'Pausiert',
    overridesTitle: 'Überschreibungen je Kanal',
    lotSizeOverride: 'Lotgröße überschreiben',
    pipToleranceOverride: 'Pip-Toleranz überschreiben',
    useBrokerDefault: 'Broker-Standard verwenden',
    tabTelegram: 'Telegram',
    tabDiscord: 'Discord',
    tabWhatsApp: 'WhatsApp',
    tabTradingView: 'TradingView',
    comingSoon: 'Demnächst',
    comingSoonBody: 'Diese Quelle ist noch nicht verfügbar.',
    tradingViewIntro:
      'Erstellen Sie ein Webhook, fügen Sie es in eine TradingView-Warnung ein und verlinken Sie diese Quelle auf der Konfigurationskarte mit Brokerkonten.',
    tradingViewCreate: 'Webhook erstellen',
    tradingViewName: 'Name',
    tradingViewUrl: 'Webhook-URL',
    tradingViewTemplate: 'Warnungsnachricht',
    tradingViewTemplateStrategy: 'Nur für Strategien',
    tradingViewTemplateIndicators: 'Für Indikatoren',
    tradingViewTemplateBuy: 'Kaufsignale',
    tradingViewTemplateSell: 'Verkaufssignale',
    tradingViewTemplateSymbolHint:
      'Für andere Symbole ändern Sie das "XAUUSD" in "symbol" in TradingView.',
    tradingViewTemplateHelp:
      'Verwenden Sie "Konfigurieren", um JSON für Indikator- oder Strategiewarnungen mit optionalen SL und TPs zu erstellen. Fügen Sie die generierte Nachricht in TradingView ein. Setzen Sie action auf close, um kopierte Trades für dieses Symbol zu schließen.',
    tradingViewHowToTitle: 'So fügen Sie es in TradingView hinzu',
    tradingViewHowTo1:
      'Öffnen Sie in TradingView "Warnungen" und erstellen Sie eine neue Warnung am Chart (verwenden Sie eine Chart-Bedingung — nicht „Nur ein Aufruf der alert()-Funktion“).',
    tradingViewHowTo2:
      'Aktivieren Sie Webhook URL und fügen Sie die aktuelle Webhook-URL aus diesem Dialog ein (kopieren Sie sie nach dem Erneuern der URL oder dem Erstellen des Webhooks erneut). Wenn Sie noch eine ältere Supabase-Functions-URL verwenden, ersetzen Sie sie durch die hier angezeigte URL, damit Warnungen den ständig aktiven Worker erreichen.',
    tradingViewHowTo3:
      'Öffnen Sie bei diesem Webhook "Konfigurieren", wählen Sie Indikator oder Strategie, setzen Sie die SL/TP-Optionen und fügen Sie anschließend das generierte JSON in das Feld Message ein. Verwenden Sie für Indikatorwarnungen ein echtes Symbol — lassen Sie {{ticker}} nicht in der Nachricht stehen.',
    tradingViewHowTo4:
      'Speichern Sie die Warnung. Bei den letzten Warnungen hier muss Accepted mit einem echten Symbol angezeigt werden. "Webhook successfully delivered" in TradingView bedeutet nur HTTP 200 — wenn Skipped (unresolved symbol) angezeigt wird, wurde kein Trade erstellt.',
    tradingViewSkipUnresolvedSymbol:
      'Die Symbol-Platzhalter wurden nicht aufgelöst — ändern Sie die Nachricht in ein echtes Symbol (z. B. XAUUSD) und erstellen Sie die Warnung neu',
    tradingViewSkipUnresolvedAction:
      'Der Action-Platzhalter wurde nicht aufgelöst — verwenden Sie die Kauf-/Verkaufsvorlage oder eine Strategiewarnung mit einer Chart-Bedingung',
    tradingViewCopy: 'Kopieren',
    tradingViewCopied: 'Kopiert',
    tradingViewRotate: 'URL erneuern',
    tradingViewActive: 'Aktiv',
    tradingViewDelete: 'Löschen',
    tradingViewShowDetails: 'Details anzeigen',
    tradingViewConfigure: 'Konfigurieren',
    tradingViewConfigureTitle: 'Alert-JSON konfigurieren',
    tradingViewConfigureHint:
      'Erstellen Sie JSON für Indikator- oder Strategiewarnungen mit optionalen Entry-/SL/TP-Ebenen über plot. Die Authentifizierung erfolgt über die Webhook-URL — geben Sie kein Secret in die Nachricht.',
    tradingViewConfigureCta: 'Alert-JSON konfigurieren',
    tradingViewAlertType: 'Warnungstyp',
    tradingViewAlertTypeIndicator: 'Indikator',
    tradingViewAlertTypeStrategy: 'Strategie',
    tradingViewIncludeSl: 'Stop-Loss (SL) einfügen',
    tradingViewIncludeSlHint:
      'Fügt "sl": {{plot("SL")}} hinzu. Der Pine-Plot-Titel muss SL lauten.',
    tradingViewIncludeTp: 'Take-Profits (TP) einfügen',
    tradingViewIncludeTpHint:
      'Fügt tp1…tpN als {{plot("TP1")}}… hinzu. Die Plot-Titel müssen übereinstimmen (TP1, TP2, …).',
    tradingViewTpCount: 'Anzahl der TPs',
    tradingViewSymbol: 'Symbol',
    tradingViewSymbolHint:
      'Wird im Kauf-/Verkaufs-JSON des Indikators verwendet. Ändern Sie es entsprechend Ihrem Chart.',
    tradingViewJsonPreview: 'Alert-JSON',
    tradingViewJsonPlaceholderHint:
      'In das Feld Message der TradingView-Warnung einfügen. Die Plot-Titel (Entry, SL, TP1…) müssen zu Ihrem Pine-Skript passen. Die Webhook-URL ist Ihr Secret — lassen Sie SL/TP hier aus, um stattdessen das SL/TP-Override des Brokers zu verwenden.',
    tradingViewSaveConfig: 'Konfiguration speichern',
    tradingViewEmpty: 'Noch keine TradingView-Webhooks.',
    tradingViewHeroTitle: 'TradingView verbinden',
    tradingViewHeroSubtitle:
      'Erstellen Sie ein Webhook und fügen Sie es in eine TradingView-Warnung ein, um diese Trades zu kopieren.',
    tradingViewHow1: 'Erstellen Sie ein Webhook für Ihre TradingView-Warnungen',
    tradingViewHow2:
      'Fügen Sie die Webhook-URL und die Warnungsnachricht in TradingView ein',
    tradingViewHow3:
      'Verlinken Sie diese Quelle mit den Brokerkonten, die sie kopieren sollen',
    tradingViewConnect: 'TradingView verbinden',
    tradingViewListTitle: 'Ihre Webhooks',
    tradingViewCreated: 'Erstellt',
    tradingViewLastEvent: 'Letztes Ereignis',
    tradingViewNameRequired: 'Geben Sie einen Namen für dieses Webhook ein.',
    tradingViewDeliveries: 'Letzte Warnungen',
    tradingViewNoDeliveries: 'Noch keine Warnungen.',
    tradingViewAccepted: 'Akzeptiert',
    tradingViewSkipped: 'Übersprungen',
    tradingViewError: 'Fehler',
    tradingViewDuplicate: 'Duplikat',
    tradingViewCopyTo: 'Kopieren nach',
    tradingViewNoBrokers:
      'Verbinden Sie ein Brokerkonto, bevor Warnungen kopieren können.',
    tradingViewLimit:
      'Der Basic-Plan umfasst 2 TradingView-Webhooks. Führen Sie ein Upgrade durch, um unbegrenzte Webhooks zu erhalten.',
    discordHeroTitle: 'Discord verbinden',
    discordHeroSubtitle:
      'Laden Sie den UniCopier-Bot auf Ihren Server ein und wählen Sie die Textkanäle, die kopiert werden sollen.',
    discordHow1: 'Laden Sie den UniCopier-Bot auf einen Server ein, den Sie verwalten',
    discordHow2: 'Wählen Sie die Textkanäle, auf denen Signale gepostet werden',
    discordHow3:
      'Verlinken Sie diese Kanäle mit den Brokerkonten, die sie kopieren sollen',
    discordConnect: 'Discord verbinden',
    discordDisconnect: 'Discord trennen',
    discordListTitle: 'Ihre Discord-Kanäle',
    discordEmptyChannels: 'Noch keine Discord-Kanäle hinzugefügt.',
    discordPickChannels: 'Textkanäle',
    discordNoTextChannels:
      'Es sind noch keine Textkanäle verfügbar. Öffnen Sie Discord, stellen Sie sicher, dass der Bot den Kanal sehen kann, und aktualisieren Sie dann.',
    discordClientMissing: 'Die Discord-Einladung ist noch nicht konfiguriert.',
    discordAdd: 'Hinzufügen',
    discordSync: 'Kanäle aktualisieren',
    whatsappHeroTitle: 'WhatsApp verbinden',
    whatsappHeroSubtitle:
      'Verlinken Sie Ihr WhatsApp und wählen Sie die Gruppen, die kopiert werden sollen.',
    whatsappHow1: 'Scannen Sie den QR-Code in WhatsApp unter Verknüpfte Geräte',
    whatsappHow2: 'Wählen Sie die Gruppen, auf denen Signale gepostet werden',
    whatsappHow3:
      'Verlinken Sie diese Gruppen mit den Brokerkonten, die sie kopieren sollen',
    whatsappConnect: 'WhatsApp verbinden',
    whatsappListTitle: 'Ihre WhatsApp-Gruppen',
    whatsappEmptyGroups: 'Noch keine WhatsApp-Gruppen hinzugefügt.',
    whatsappPickGroups: 'Ihre Gruppen',
    whatsappNoGroups:
      'Es sind noch keine Gruppen verfügbar. Aktualisieren Sie die Liste, sobald die Verlinkung abgeschlossen ist.',
    whatsappDisconnect: 'Trennen',
    whatsappQrHelp:
      'Öffnen Sie WhatsApp, gehen Sie zu Verknüpfte Geräte und scannen Sie diesen Code.',
    whatsappListenerMissing: 'Der WhatsApp-Listener ist noch nicht konfiguriert.',
    whatsappListenerUnavailable:
      'Der WhatsApp-Listener läuft nicht. Starten Sie ihn und versuchen Sie es erneut.',
    whatsappAdd: 'Hinzufügen',
    whatsappRefresh: 'Gruppen aktualisieren',
    whatsappConnectedHint:
      'Fügen Sie unten Gruppen hinzu, um mit dem Kopieren von Signalen zu beginnen',
    whatsappSearchPlaceholder: 'Gruppen suchen…',
    whatsappActiveGroups: 'Aktive Gruppen',
  },
  popularChannelsPage: {
    title: 'Beliebte Kanäle',
    subtitle:
      'Signalkanäle, sortiert nach der Anzahl der Abonnenten über alle UniCopier-Nutzer hinweg',
    emptyTitle: 'Noch keine Kanäle',
    emptySubtitle: 'Kanäle erscheinen hier, sobald Nutzer sie abonnieren',
  },
}
