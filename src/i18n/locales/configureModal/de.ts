import type { ConfigureModalTranslations } from './types'

export const configureModalDe: ConfigureModalTranslations = {
  title: 'Trading',
  configureChannelOnBroker: '{channel} auf {broker} konfigurieren',
  close: 'Schließen',
  saved: 'Gespeichert',
  cancel: 'Abbrechen',
  save: 'Speichern',
  channelsSidebar: 'Quelle',
  addChannel: 'Kanal hinzufügen',
  editLinkedChannels: 'Verknüpfte Kanäle bearbeiten',
  doneEditingLinkedChannels: 'Kanalbearbeitung abschließen',
  removeLinkedChannel: '{channel} entfernen',
  selectChannelToConfigure:
    'Wählen oder verknüpfen Sie einen Kanal, um seine Trading-Einstellungen zu konfigurieren.',
  selectChannelPrompt:
    'Wählen Sie einen Kanal aus der Liste aus, um ihn zu konfigurieren oder mit diesem Broker zu verbinden.',
  connectChannelPrompt:
    'Verknüpfen Sie {channel} mit {broker}, um dessen Signale zu kopieren und die Trading-Einstellungen anzupassen.',
  connectChannelHint:
    'Das Verknüpfen fügt diesen Kanal zur Signalliste des Brokers hinzu. Anschließend können Sie direkt Lots, Ziele und Filter anpassen.',
  connectChannelButton: '{channel} mit {broker} verbinden',
  channelLinkedBadge: 'Verbunden',
  channelNotLinkedBadge: 'Nicht verbunden',
  applyPreset: 'Voreinstellung anwenden',
  applyPresetPlaceholder: 'Voreinstellung wählen…',
  managePresetsHint:
    'Wenden Sie eine Voreinstellung auf diesen Kanal an oder bearbeiten und löschen Sie gespeicherte Voreinstellungen.',
  managePresetsApplyHint: 'Klicken Sie auf eine Voreinstellung, um sie auf diesen Kanal anzuwenden.',
  managePresetsEdit: 'Voreinstellung bearbeiten',
  managePresetsDelete: 'Voreinstellung löschen',
  editPresetTitle: 'Voreinstellung bearbeiten',
  editPresetAction: 'Änderungen speichern',
  deletePresetTitle: 'Voreinstellung löschen?',
  deletePresetConfirm: 'Voreinstellung „{name}“ löschen? Dies kann nicht rückgängig gemacht werden.',
  deletePresetAction: 'Löschen',
  presetDeleted: 'Voreinstellung gelöscht',
  exportPresets: 'Voreinstellungen exportieren',
  importPresets: 'Voreinstellungen importieren',
  exportPresetsTitle: 'Voreinstellungen exportieren',
  exportPresetsNameLabel: 'Exportname',
  exportPresetsNamePlaceholder: 'z. B. meine-trading-voreinstellungen',
  exportPresetsAction: 'Exportieren',
  exportPresetsSelectHint: 'Wählen Sie, welche Voreinstellungen in den Export aufgenommen werden sollen.',
  exportPresetsSelectAll: 'Alle auswählen',
  exportPresetsSelectNone: 'Keine auswählen',
  presetsExported: 'Voreinstellungen exportiert',
  presetsImported: '{count} Voreinstellung(en) importiert',
  presetsImportFailed: 'Voreinstellungen konnten nicht importiert werden',
  applyPresetTitle: 'Voreinstellung anwenden?',
  applyPresetConfirm:
    'Einstellungen von {channel} durch die Voreinstellung „{name}“ ersetzen?',
  applyPresetChannelLabel: 'Kanal',
  applyPresetPresetLabel: 'Voreinstellung',
  applyPresetWarning:
    'Die Einstellungen werden sofort gespeichert und vom Copier für diesen Kanal verwendet.',
  applyPresetAction: 'Anwenden & speichern',
  closeUnsavedConfirm:
    'Sie haben ungespeicherte Trading-Einstellungen. Der Copier verwendet Ihre Änderungen erst, wenn Sie sie speichern. Trotzdem schließen?',
  closeUnsavedTitle: 'Ungespeicherte Einstellungen verwerfen?',
  discardChanges: 'Änderungen verwerfen',
  noPresetsYet:
    'Noch keine Voreinstellungen — verwenden Sie „Als Voreinstellung speichern“, um eine zu erstellen.',
  saveAsPreset: 'Als Voreinstellung speichern',
  saveAsPresetTitle: 'Als Voreinstellung speichern',
  saveAsPresetNameLabel: 'Name der Voreinstellung',
  saveAsPresetNamePlaceholder: 'z. B. Multi-trade GOLD',
  saveAsPresetAction: 'Voreinstellung speichern',
  presetSaved: 'Voreinstellung gespeichert',
  presetSelectChannelFirst:
    'Wählen Sie zuerst einen Kanal aus, bevor Sie eine Voreinstellung speichern.',
  channelConfigNotSaved:
    'Die Trading-Einstellungen dieses Kanals sind noch nicht gespeichert. Klicken Sie auf Speichern, sonst verwendet der Worker Ihre Lotgröße und Ihren Trade-Style nicht.',
  channelConfigUnsavedChanges:
    'Sie haben ungespeicherte Änderungen für diesen Kanal. Klicken Sie auf Speichern, um sie zu übernehmen.',
  channelConfigSaveIncomplete:
    'Jeder verknüpfte Kanal benötigt vor dem Speichern eine feste Lotgröße und einen Trade-Style (Single oder Multi).',
  tabs: {
    trade: 'Trading',
    channels: 'Kanäle',
  },
  manualSubTabs: {
    symbols: 'Symbole',
    channelInstructions: 'Anweisungen',
    risk: 'Risiko',
    stops: 'Ziele',
    management: 'Management',
    filters: 'Filter',
    aiTraining: 'Signalbeispiele',
  },
  manualSubTabDescriptions: {
    aiTraining: 'Bringen Sie dem Copier bei, wie dieser Kanal Signale verfasst und aktualisiert.',
    symbols:
      'Beschränken Sie, welche Symbole aus diesem Kanal kopiert werden, oder schließen Sie einige aus.',
    channelInstructions:
      'Erlauben oder ignorieren Sie Kanalnachrichten, die Trades ändern, schließen oder verwalten.',
    risk: 'Lotgröße, Single- vs. Multi-Trade-Style und die Bemessung jeder Position.',
    stops: 'Stop-Loss, Take-Profit-Level und vordefinierte Zielüberschreibungen.',
    management: 'Break-even, Trailing Stop, Pending-Ablauf und Order-Kommentare.',
    filters: 'Kopieren nach Tageszeit, Wochentagen und Nachrichten mit hoher Wirkung einschränken.',
  },
  aiTraining: {
    title: 'AI-Signaltraining',
    intro:
      'Trainieren Sie diesen Kanal, damit der Copier seine genaue Signalsprache und -struktur erlernt. Vor dem Speichern können Sie alles bearbeiten.',
    signalExamplesTitle: 'Signalbeispiele',
    signalExamplesIntro:
      'Beschriftete Nachrichten aus diesem Kanal bringen dem Copier bei, seine Signale in jeder Sprache zu lesen. Die Beispiele werden beim Training des Kanals automatisch erstellt.',
    signalExamplesHint:
      'Jedes Beispiel verknüpft eine echte Kanalnachricht mit der Interpretation durch den Copier (Einstieg, Aktualisierung oder Ignorieren). Wird für das AI-Parsing verwendet — nicht an Ihren Broker übermittelt.',
    signalExamplesEmpty: 'Noch keine Signalbeispiele',
    signalExamplesEmptyHint:
      'Trainieren Sie diesen Kanal, um die letzten Nachrichten zu analysieren und beschriftete Beispiele für sein Signalformat zu erstellen.',
    signalExamplesRefresh: 'Aktualisieren',
    signalExamplesCount: '{count} Beispiele aus dem Kanaltraining',
    signalExamplesLoadError: 'Signalbeispiele konnten nicht geladen werden',
    exampleLabelEntry: 'Einstieg',
    exampleLabelUpdate: 'Trade-Aktualisierung',
    exampleLabelIgnore: 'Ignorieren',
    trainButton: 'Automatisch erkennen',
    training: 'Wird erkannt…',
    saveButton: 'Training speichern',
    loadingExisting: 'Vorhandenes Training wird geladen…',
    trainHint:
      'Führen Sie das Training aus, um kanalspezifische Formate (auch nicht-englische Begriffe) zu ermitteln, und bearbeiten und speichern Sie sie anschließend.',
    addCustomExample: 'Eigenes Beispiel hinzufügen',
    customExampleTitle: 'Eigenes Signalbeispiel',
    customExampleEditTitle: 'Signalbeispiel bearbeiten',
    pasteSignalPlaceholder: 'Fügen Sie hier eine Kanalnachricht ein…',
    analyzeExample: 'Analysieren',
    analyzingExample: 'Wird analysiert…',
    saveExample: 'Beispiel speichern',
    signalTypeLabel: 'Signaltyp',
    signalTypeAuto: 'Automatische Erkennung',
    signalTypeEntry: 'Einstieg',
    signalTypeUpdate: 'Trade-Aktualisierung',
    updateKindLabel: 'Aktualisierungstyp',
    updateKindModify: 'SL/TP ändern',
    updateKindClose: 'Schließen',
    updateKindBreakeven: 'Break-even',
    updateKindPartial: 'Teilschließen',
    sideLabel: 'Seite',
    sideBuy: 'Kaufen',
    sideSell: 'Verkaufen',
    sideNone: 'Keine',
    fieldSymbol: 'Symbol',
    fieldEntry: 'Einstieg',
    fieldEntryZoneLow: 'Einstiegszone unten',
    fieldEntryZoneHigh: 'Einstiegszone oben',
    fieldSl: 'Stop-Loss',
    fieldTp: 'Take-Profit',
    addTp: 'TP hinzufügen',
    exampleRejectedCommentary:
      'Das sieht nach einem Kommentar aus, nicht nach einem handelbaren Signal.',
    exampleRejectedEmpty: 'Fügen Sie zuerst eine Signalnachricht ein.',
    exampleRejectedMissingSide:
      'Wählen Sie für Einstiegsbeispiele Kaufen oder Verkaufen.',
    exampleRejectedMissingPrices: 'Geben Sie mindestens einen Einstieg, SL oder TP an.',
    exampleRejectedGeneric:
      'Diese Nachricht konnte nicht analysiert werden. Prüfen Sie sie und versuchen Sie es erneut.',
    exampleSaved: 'Beispiel gespeichert.',
    deleteExample: 'Löschen',
    editExample: 'Bearbeiten',
    manualBadge: 'Manuell',
    deleteExampleConfirm: 'Dieses Signalbeispiel löschen?',
    deleteExampleTitle: 'Signalbeispiel löschen',
    cancel: 'Abbrechen',
    entryCues: 'Einstiegshinweise',
    buyCues: 'Kauf-Hinweise',
    sellCues: 'Verkauf-Hinweise',
    stopLossCues: 'Stop-Loss-Hinweise',
    takeProfitCues: 'Take-Profit-Hinweise',
    takeProfitTierCues: 'TP-Stufen-Hinweise',
    managementCues: 'Management-Hinweise',
    languageHints: 'Sprachhinweise',
    sampleExamples: 'Musterbeispiele für Signale',
    signalOrderPattern: 'Reihenfolge von Signal und Preis',
    signalRequiresPrice: 'Signale erfordern einen expliziten Preis',
    notes: 'Notizen',
    signalOrderPatternOptions: {
      signalThenPrice: 'Zuerst Signal, dann Preis',
      priceThenSignal: 'Zuerst Preis, dann Signal',
      mixed: 'Gemischt',
      unknown: 'Unbekannt',
    },
    requiresPriceOptions: {
      unknown: 'Unbekannt',
      yes: 'Ja',
      no: 'Nein',
    },
    commaSeparatedHint: 'Durch Komma getrennte Werte',
    autoTrainingInProgress: 'Training läuft… {progress} %',
    autoTrainingDone: 'Training abgeschlossen und gespeichert.',
    trainingLearnedFrom: 'Schlüsselwörter aus {count} Beispielnachrichten gelernt.',
    trainFailed:
      'Das Training wurde nicht abgeschlossen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    multilingualRetrainHint:
      'Kanal nicht auf Englisch? Führen Sie nach dem Verknüpfen „Kanal trainieren“ aus, damit der Copier Kauf-, Verkaufs-, SL- und TP-Begriffe lernt. Wenn die Copier-Protokolle übersprungene Signale anzeigen, trainieren Sie hier erneut.',
  },
  channelSymbols: {
    title: 'Symbolfilter',
    intro:
      'Die Signal-Symbole werden beim Verbinden des Kontos automatisch den Instrumentnamen Ihres Brokers zugeordnet (einschließlich gängiger Präfixe und Suffixe wie XAUUSD+ oder BTCUSDm). Verwenden Sie die Felder unten nur, um bestimmte Symbole aus diesem Kanal freizuschalten oder zu blockieren.',
    tradeOnlyLabel: 'Zu handelnde Symbole',
    tradeOnlyHint:
      'Leer lassen, um jedes Symbol aus diesem Kanal zu kopieren. Sind Symbole aufgelistet, werden nur Signale kopiert, die zu diesen Symbolen passen (durch Komma getrennt, z. B. XAUUSD, EURUSD).',
    tradeOnlyPlaceholder: 'z. B. XAUUSD, EURUSD',
    avoidLabel: 'Zu vermeidende Symbole',
    avoidHint:
      'Leer lassen, um alle Symbole zuzulassen (vorbehaltlich „Zu handelnde Symbole“). Aufgelistete Symbole werden aus diesem Kanal nie kopiert.',
    avoidPlaceholder: 'z. B. BTCUSD, US30',
  },
  ai: {
    title: 'AI-Konfiguration',
    intro:
      'Der AI-Expert-Modus verhält sich wie ein menschlicher Expertenhändler: dynamische Lot-Bemessung nach Saldo, Behandlung von Range-Einstiegen, TP-basiertes Management und Interpretation von Kanalanweisungen.',
    moneyManagementTitle: 'Money-Management',
    moneyManagementBody:
      'Standardmäßig lineare Bemessung; optionaler Margin-Modus; Mindest-Lot des Brokers; Feinabstimmung der SL-Distanz bei Forex.',
    signalTitle: 'Signalinterpretation',
    signalBody:
      'Behandelt Einstiege ohne Preis, Einzeleinstiege, Range-Einstiege und verzögerte TP-/SL-Aktualisierungen.',
    tradeTitle: 'Trade-Management',
    tradeBody:
      'Unterstützt Teilschließen, Break-even und Kanalbefehle wie Schließen oder Gewinne sichern.',
    modificationTitle: 'Erkennung von Änderungen',
    modificationBody:
      'Unterscheidet neue Einstiege von nachfolgenden Änderungsanweisungen.',
  },
  risk: {
    riskMode: 'Risiko-Modus',
    fixedLot: 'Feste Lotgröße',
    dynamicBalance: 'Dynamisch (% Balance)',
    dynamicBalanceLotSize: 'Lotgröße für dieses Signal',
    dynamicBalanceLotSizeHint: '{lot} Lots aus {percent} % von {balance} Balance',
    dynamicBalanceLotSizeFallback:
      '{lot} Lots (Festwert-Lot verwendet — Kontostand nicht geladen)',
    tradeStyle: 'Trade-Style',
    tradeStyleHint:
      'Einzeleinstiege: eröffnet für jede aktivierte Take-Profit-% einen eigenen Broker-Trade (gleiche Gesamt-Lotgröße). Range-Trading: teilt diese Lotgröße in viele kleinere Orders über die Take-Profit-Level des Signals hinweg auf.',
    singleTrade: 'Einzeleinstiege',
    multiTrades: 'Range-Trading',
    singleTpTarget: 'Einzelnes TP-Ziel',
    singleTpTargetHint:
      'Für Einzeleinstiege veraltet — jedes aktivierte Take-Profit-Level öffnet einen eigenen Broker-Trade mit diesem sichtbaren TP.',
    singleTpTargetFarthest: 'Entferntester TP (automatisch)',
    singleTpTargetTp1: 'TP1',
    singleTpTargetTp2: 'TP2',
    singleTpTargetTp3: 'TP3',
    singleTpLotBreakdownTitle: 'Lot-Aufteilung',
    singleTpLotBreakdownSlice: '{lot} Lots werden @ {tp} eröffnet',
    partialTpMinLotWarning:
      'Bei einer Lotgröße von {lot} können diese Level nicht als eigene Trades geöffnet werden: {levels}. Ihr Anteil wird zum entferntesten TP addiert. Jedes Level benötigt mindestens 0.01 Lot — erhöhen Sie die Lotgröße, um jedes Level zu eröffnen.',
    singleTpLotBreakdownJoin: ', ',
    signalEntryTitle: 'Ausführung des Signaleinstiegs',
    signalEntryBody:
      '„Signaleinstiegspreis verwenden“ gilt nur im Single-Trade-Modus. Wenn aktiviert, muss das Signal einen explizit geparsten Einstieg enthalten (Preis, Zone, @-Preis oder Labels wie „Entry Price:“). Nach einer beliebigen Kanalverzögerung vergleicht der Worker den Live-Kurs mit diesem Einstieg: Buy wird nur dann zum Marktpreis ausgeführt, wenn der Ask unter oder auf dem Einstieg liegt; andernsten wird eine Buy-Limit-Order auf den Einstieg gesetzt. Sell ist umgekehrt. Sind mehrere Take-Profit-Level aktiv, öffnen Einzeleinstiege für jeden TP einen eigenen Broker-Trade mit Ihren Ziel-Prozenten. Der Copier verfolgt jede Pending-Order mit striktem Einstieg, damit die Ausführungen mit Ihrer Tradeliste synchron bleiben; Pending-Orders werden storniert, wenn der Korb geschlossen ist. Nackte „Jetzt kaufen“-Nachrichten ohne Einstieg werden übersprungen.',
    useSignalEntryPrice: 'Signaleinstiegspreis verwenden',
    signalEntryPrefer: 'Einstiegspreis',
    signalEntryPreferHint:
      'Wenn das Signal zwei Einstiegspreise nennt, verwendet „Erster Preis“ das ungünstigere Level für die jeweilige Seite (Buy: höher, Sell: niedriger) und „Letzter Preis“ das beste. Die Pip-Toleranz gilt dann für diesen einen Preis.',
    signalEntryPreferFirst: 'Erster Preis (ungünstiger)',
    signalEntryPreferLast: 'Letzter Preis (bester)',
    pipToleranceLegacy: 'Pip-Toleranz',
    pipToleranceHint:
      'Zulässiger Abstand zum Signaleinstiegslevel, bevor der Einstieg verschoben wird (strikt-Einstieg im Single Trade und Range des Signals).',
    multiIntro:
      'Range-Trading teilt Ihre feste Lotgröße in viele kleinere Orders (z. B. 1,0 Lot @ 5 % pro Leg = 20 Trades à 0,05). Die Legs werden über die TPs des Signals anhand der Prozentzeilen verteilt. Fällt die Größe pro Leg unter das Symbolminimum des Brokers, greift der Planner auf einen einzigen Trade in voller Größe zurück und protokolliert den Grund.',
    perLegSize: 'Größe pro Leg (% der festen Lotgröße)',
    totalOpenTrades: 'Offene Trades gesamt',
    previewFallbackSingle:
      '{lot} Lots x 1 Trade (Aufteilung bei 0.01 min / 0.01 Schritt in der Vorschau nicht möglich)',
    multiTradeSplitSaveBlocked:
      'Speichern nicht möglich: Aufteilung bei 0.01 min / 0.01 Schritt in der Vorschau nicht möglich. Erhöhen Sie die Lotgröße oder den Wert pro Leg (%).',
    previewLotsXTrades: '{lot} Lots x {total} Trades',
    previewLotsXTradesLayered:
      '{lot} Lots x {total} Trades ({immediate} sofort + {pending} für Layering)',
    previewFooter:
      'Wie viele Trades der Copier für ein Signal zu eröffnen plant. Basierend auf Lotgröße, Größe pro Leg, reserviertem Layering-%, Schritt und Range-Distanz. Das Layering eröffnet nie mehr als diese Gesamtzahl. Ihr Broker kann weniger eröffnen, wenn der Preis die Zone nicht abdeckt.',
    previewDynamicRisk:
      ' Die Lotgröße wird aus Ihrem Kontostand und dem Prozentsatz unter „Dynamisch (% Balance)“ berechnet.',
    previewLadderSpan:
      ' Range-Layering: {active} Order(s) in {step}-Pip-Schritten (die Leiter reicht bis zu {distance} Pips vom Einstieg entfernt).',
    previewLadderDistanceCap:
      ' Die Range-Distanz begrenzt das Layering auf {active} von {pending} per % reservierten Orders.',
    previewCweLegs:
      ' {count} Trade(s) werden sofort eröffnet und können geschlossen werden, wenn sich der Preis {pips} Pips zu Ihren Gunsten bewegt.',
    rangeLayering: 'Range-Layering',
    rangeIntro:
      'Legen Sie einige Trades als virtuelle Pending-Orders mit Abständen ab dem Ausgangspreis fest (Durchschnittspreis senken). Wird kein bestimmter Einstiegspreis angegeben, dient der aktuelle Live-Marktpreis (Bid/Ask) als Ausgangspunkt. Alle Pending-Orders übernehmen die Stop-Loss- und Take-Profit-Einstellungen Ihrer direkten Trades.',
    reservedLot: 'Reserviertes Lot (% der Gesamtmenge)',
    reservedLotHint:
      'Anteil der Gesamt-Legs, der als Pending-Orders reserviert wird.',
    stepPips: 'Schritt (Pips pro Layering)',
    stepPipsFallback:
      'Auto verteilt die Layering-Trades gleichmäßig über die Range-Distanz (mindestens 1 Pip zwischen den Layern). Manuell verwendet einen festen Pip-Schritt zwischen jedem Layer.',
    stepModeAuto: 'Auto',
    stepModeManual: 'Manuell',
    stepManualPips: 'Pip-Schritt',
    stepManualPipsFallback: 'Fester Pip-Abstand zwischen jedem Layer.',
    rangeDistance: 'Range-Distanz (Pips)',
    rangeDistanceFallback:
      'Die Range-Distanz, die Ihr Signalanbieter angibt. Sie bestimmt, wie weit der Trade gelayert wird.',
    layerTillClose: 'Bis zum Schließen layern',
    layerTillCloseBody:
      'Ein: Die Range-Pending-Orders werden eröffnet, bis der gesamte Trade geschlossen ist, auch wenn der Preis nach einem Take-Profit oder „Schlechtere Einstiege schließen“ zurückläuft. Aus: Pending-Orders werden nach dem ersten Take-Profit oder wenn eine Order geschlossen wird storniert, damit bei einer Umkehr keine tieferen Orders eröffnet werden.',
    layeringType: 'Layering-Typ',
    layeringTypeAuto: 'Auto-Layering',
    layeringTypeAutoHint:
      'Löst Market-Orders aus, wenn sich der Preis gegen das Signal an jedem Leiterschritt bewegt (virtuelle Pendings, schnellere Auslöse-Reaktion).',
    layeringTypePendingOrder: 'Pending Order',
    layeringTypePendingOrderHint:
      'Setzt Buy-Limit-/Sell-Limit-Orders beim Broker an jedem Leiterschritt ab Ihrem Ausführungskurs. Manche Broker lehnen Limits ab, die zu nah am Markt liegen — es werden weniger Legs platziert. Mehrere Orders können denselben Limitpreis haben.',
    useSignalRange: 'Nur Signal-Range handeln',
    useSignalRangeBody:
      'Wenn aktiviert, muss das Signal einen geparsten Einstiegspreis oder eine Zone enthalten (z. B. 4505, 4505/4500 oder @ 4505). Nackte „Jetzt kaufen“-Nachrichten ohne Preis werden übersprungen und als Warten auf einen Preisbereich angezeigt. Anders als bei „Signaleinstiegspreis verwenden“ wird keine Pending-Order beim Broker platziert — der Copier wartet virtuell und eröffnet, sobald sich der Live-Preis irgendwo innerhalb der Signaleinstiegszone befindet, wobei die Pip-Toleranz leicht über beide Grenzen hinausreicht. Die Layering-Tiefe stammt weiterhin aus der Signaleinstiegszone, sofern vorhanden.',
    useSignalRangePipTolerance: 'Pip-Toleranz',
    useSignalRangePipToleranceHint:
      'Zusätzliche Pips über den Zonengrenzen (beide Seiten), innerhalb derer der Einstieg noch auslösen darf. Signale mit einem Preis verwenden die Toleranz über (Buy) oder unter (Sell) dem Einstiegslevel.',
    useSignalRangeDistanceDisabledHint:
      'Die Tiefe wird der Signaleinstiegszone entnommen, wenn das Signal eine enthält.',
    previewSignalRangeFootnote:
      ' Wenn „Nur Signal-Range handeln“ aktiviert ist, wartet der Einstieg, bis der Preis innerhalb der Signalzone liegt (± Toleranz an beiden Grenzen).',
    closeWorseEntries: 'Schlechtere Einstiege schließen',
    closeWorseBody:
      'Wenn sich der Preis ab dem Ausgangseinstieg +X Pips zu Ihren Gunsten bewegt, schließt das System Ihre direkten Trades automatisch. Wird eine Nachricht „Schlechtere Einstiege schließen“ aktiviert und ausgelöst, schließt das System jeden offenen Trade, der innerhalb von X Pips vom aktuellen Marktpreis liegt. Von „Schlechtere Einstiege schließen“ betroffene Trades haben auf Brokerseite keinen Take-Profit (TP) gesetzt. An den Broker wird nur der Stop-Loss (SL) gesendet.',
    closeWorsePips: 'Gewinne vom schlechteren Einstieg schließen (Pips)',
    closeWorsePipsFallback:
      'Abstand zum Live-Preis (Anweisung) oder Anker + X Pips (auto).',
    basicPlanTradeStyleLimit:
      'Nur der Single-Trade-Modus ist erlaubt. Die Einstellungen für Multi-Trade und Range-Layering sind im Advanced-Tarif verfügbar.',
    openLotCalculator: 'Risiko / Lotgröße berechnen',
    minLotPartialCloseWarning:
      'Ihre Lot pro Trade beträgt 0.01 (Broker-Minimum). Kanalanweisungen wie „Halbe schließen“, „teilweise schließen“ oder „Teilgewinne mitnehmen“ können keine kleinere Position hinterlassen — der Copier schließt den gesamten Trade. Erhöhen Sie die Lotgröße oder stellen Sie „Halb / teilweise schließen“ für diesen Kanal auf „Ignorieren“.',
    fieldErrors: {
      required: 'Geben Sie einen Wert ein',
      invalid: 'Geben Sie eine gültige Zahl ein',
      min: 'Muss mindestens {min} betragen',
      max: 'Darf höchstens {max} betragen',
      positive: 'Muss größer als 0 sein',
      fixBeforeSave: 'Korrigieren Sie die hervorgehobenen Risiko-Felder vor dem Speichern.',
    },
    lotCalculator: {
      title: 'Risiko- & Lotgrößen-Rechner',
      intro:
        'Schätzen Sie, wie viel Sie pro Signal riskieren und was Sie an Ihren Take-Profit-Leveln verdienen könnten. Passen Sie die Eingaben an, bis das Risiko zu Ihrem Konto passt, und wenden Sie es dann auf diesen Kanal an.',
      accountBalance: 'Start-Kontostand',
      symbol: 'Symbol',
      symbolHint:
        'Wird für Schätzungen des Pip-Werts verwendet. Standardwert aus „Zu handelnde Symbole“, sofern gesetzt.',
      slPips: 'Stop-Loss (Pips)',
      usePredefinedSl: 'Als vordefinierter SL verwenden',
      usePredefinedTp: 'Als vordefinierter TP verwenden',
      tpLevelsTitle: 'Take-Profit-Level',
      tpLevelsHint:
        'Pips = Abstand zum Einstieg für jeden TP. % = Anteil des Volumens, der bei diesem TP eröffnet wird (Einzeleinstiege eröffnen einen Trade pro Level; Range-Trading verteilt die Legs).',
      tpPipsCol: 'Pips',
      tpPercentCol: '%-Ziel',
      tpLabel: 'TP{index}',
      tpPercentTotal: 'Aktiviert gesamt',
      tpUnallocated: '{pct} % nicht verteilt',
      tpOverCap: 'Summe überschreitet 100 %',
      addTp: 'TP hinzufügen',
      remove: 'Entfernen',
      tradeStyle: 'Trade-Style',
      singleTrade: 'Einzeleinstiege',
      multiTrades: 'Range-Trading (Multi)',
      perLegSize: 'Größe pro Leg (% der festen Lotgröße)',
      rangeLayering: 'Range-Layering',
      rangePercent: 'Reserviertes Lot (% der Legs)',
      rangeStep: 'Schritt (Pips)',
      rangeDistance: 'Range-Distanz (Pips)',
      layeringType: 'Layering-Typ',
      layeringTypeAuto: 'Auto-Layering',
      layeringTypeAutoHint:
        'Market-Orders, wenn der Preis jeden Leiterschritt erreicht (virtuelle Pendings).',
      layeringTypePendingOrder: 'Pending Order',
      layeringTypePendingOrderHint:
        'Buy-/Sell-Limit beim Broker an jedem Schritt; manche Broker lehnen zu nah am Markt liegende Limits ab.',
      fixedLot: 'Feste Lotgröße',
      targetRiskPct: 'Zielrisiko (% des Saldos)',
      targetRiskHint:
        'Optional — schlägt eine Lotgröße vor, die sich pro Signal nahe diesem Risiko hält (schlechtestenfalls).',
      useSuggestedLot: 'Vorgeschlagene Lotgröße verwenden',
      enabled: 'Ein',
      advanced: 'Advanced',
      winRate: 'Angenommene Gewinnquote (%)',
      winRateHint:
        'Optional. Schätzt die Wahrscheinlichkeit eines Kontoverlusts anhand Ihres berechneten Verhältnisses von Gewinn zu Risiko und eines festen Risikos pro Signal. Keine Garantie.',
      resultsTitle: 'Ergebnisse',
      riskFull: 'Risiko bei ausgelöstem SL (gesamter Korb)',
      riskImmediate: 'Risiko bei ausgelöstem SL (nur direkte Legs)',
      riskPct: 'Risiko in % des Saldos',
      rewardTotal: 'Gewinn im Bestfall (alle TPs)',
      rewardRiskRatio: 'Gewinn : Risiko',
      legSummary: 'Leg-Aufteilung',
      legSummarySingle: '1 Order mit {lot} Lots',
      legSummaryMulti:
        '{total} Orders × {lot} Lots ({immediate} sofort + {pending} pending)',
      legSummaryRange:
        'Leiterbreite ~{distance} Pips ({pending} pending × {step} Pips)',
      lossesToRuin: 'Aufeinanderfolgende volle SL-Treffer bis zum Kontoverlust',
      riskOfRuin: 'Geschätztes Risiko eines Kontoverlusts',
      perTpReward: 'Gewinn je TP (Pips × %-Ziel)',
      brokerPreviewNote:
        'Die Leg-Anzahlen verwenden die Vorschauwerte 0.01 min Lot / 0.01 Schritt. Die Symbol-Einstellungen Ihres Brokers können leicht abweichen.',
      fallbackSingleNote:
        'Die Größe pro Leg liegt unter dem Broker-Minimum — der Copier würde stattdessen einen einzelnen Trade in voller Größe eröffnen.',
      riskWarningModerate:
        'Über 1 % Risiko pro Signal — erwägen Sie, die Lotgröße zu reduzieren.',
      riskWarningHigh: 'Über 2 % Risiko pro Signal — hohes Drawdown-Risiko.',
      riskWarningExtreme:
        'Über 5 % Risiko pro Signal — für die meisten Konten gefährlich.',
      apply: 'Einstellungen übernehmen',
      cancel: 'Abbrechen',
      close: 'Schließen',
    },
  },
  stops: {
    predefinedTitle: 'Vordefinierter SL & TP',
    predefinedIntro:
      'Wenn aktiviert, ersetzt der Copier den Stop-Loss und/oder Take-Profit des Signals durch Ihre Pip-Abstände zum Einstieg. Kanal-SL/TP aus der Nachricht werden für die aktivierten Seiten nicht verwendet.',
    overrideSl: 'Signal-SL überschreiben',
    slPips: 'Stop-Loss (Pips vom Einstieg)',
    slPipsHint:
      'Buy: Einstieg − Pips. Sell: Einstieg + Pips. Ignoriert den SL aus dem Telegram-Signal.',
    overrideTps: 'Signal-TPs überschreiben',
    tpRowsIntro:
      'Jede Zeile sind Pips vom Einstieg (TP1, TP2, …). Ignoriert die Take-Profit-Preise des Signals.',
    addTp: 'TP hinzufügen',
    tpPipsLabel: 'TP{index} (Pips)',
    remove: 'Entfernen',
    tpDistributionTitle: 'TP-Verteilung (% der Legs)',
    tpDistributionIntro:
      'Legen Sie den Anteil jedes aktivierten TP manuell fest. Die Summe der aktivierten Zeilen darf 100 % nicht überschreiten — jede Eingabe wird auf das verbleibende Budget begrenzt. Deaktivierte Zeilen sind auf 0 % festgesetzt.',
    multiTradeNote:
      'Range-Trading: verteilt die geplanten Legs anhand dieser Prozente auf die TPs (z. B. 50/30/20 von 20 Legs → 10/6/4 bei TP1/TP2/TP3).',
    singleTradeNote:
      'Einzeleinstiege: öffnet für jeden aktivierten TP einen eigenen Broker-Trade mit diesen Prozenten (z. B. 50/30/20 bei 3.0 Lot → 1.5 @ TP1, 0.9 @ TP2, 0.6 @ TP3). Jeder Trade hat seinen eigenen Take-Profit beim Broker — keine Teilschließungen durch den Worker.',
    enabledTotal: 'Aktiviert gesamt:',
    unallocated: '{pct} % nicht verteilt',
    overCap: 'Über 100 % (wird beim nächsten Bearbeiten begrenzt)',
    enabled: 'Aktiviert',
    maxRowTitle: 'Maximal {budget} % für diese Zeile verfügbar',
    enableRowTitle: 'Aktivieren Sie die Zeile, um ihren Anteil zu bearbeiten',
    summarySl: 'SL {pips} Pips vom Einstieg',
    summaryTps: 'TPs bei {list}',
    summaryJoin: '; ',
    summaryPrefix:
      'Kanal-SL/TP werden für die aktivierten Seiten ignoriert — der Copier verwendet {parts}.',
    basicPlanMoreTpsLimit: 'Mehr TPs sind im Advanced-Tarif verfügbar.',
    profitTargetsTitle: 'Gewinnziele',
    profitTargetsIntro:
      'Wenn aktiviert, schließt das Erreichen eines Ziels alle offenen Kanal-Trades automatisch, und der Copier verarbeitet bis zum Zurücksetzen der Periode keine weiteren Anweisungen. Betragsziele verwenden die Veränderung des Equity ab Beginn der Periode (z. B. schließt bei $1,000, wenn das Equity um $1,000 gestiegen ist).',
    profitTargetsToggle: 'Gewinnziele aktivieren',
    maxRiskTitle: 'Maximaler Verlust',
    maxRiskIntro:
      'Wenn das Equity Ihres Kontos ab Beginn der Periode um Ihren Verlustlimit fällt (oder bei Prozentregeln der Drawdown vom Periode-Hoch), werden alle offenen Kanal-Trades automatisch geschlossen, und der Copier verarbeitet bis zum Zurücksetzen der Periode keine weiteren Anweisungen.',
    maxRiskToggle: 'Maximalen Verlust aktivieren',
    addTarget: 'Ziel hinzufügen',
    addRiskRule: 'Verlustlimit hinzufügen',
    riskValue: 'Verlustlimit',
    periodDaily: 'Täglich',
    periodWeekly: 'Wöchentlich',
    periodMonthly: 'Monatlich',
    periodOverall: 'Gesamt',
    valueTypeAmount: 'Betrag ($)',
    valueTypePercent: 'Prozent (%)',
    targetValue: 'Zielwert',
    periodLabel: 'Periode',
    typeLabel: 'Typ',
    timezoneTitle: 'Zeitzone der Periode',
    timezoneProfile: 'Zeitzone meines Profils verwenden ({tz})',
    timezoneCustom: 'Eigene Zeitzone',
    timezoneHint:
      'Tägliche, wöchentliche und monatliche Limits werden um Mitternacht in dieser Zeitzone zurückgesetzt.',
    pausedProfitBanner:
      'Gewinnziel erreicht — die Kanal-Trades wurden geschlossen und das Kopieren pausiert, bis die Periode zurückgesetzt wird.',
    pausedRiskBanner:
      'Maximaler Verlust erreicht — die Kanal-Trades wurden geschlossen und das Kopieren pausiert, bis die Periode zurückgesetzt wird.',
    pausedOverallBanner:
      'Limit erreicht — die Kanal-Trades wurden geschlossen, und das Kopieren bleibt pausiert, bis Sie diese Regel ändern oder deaktivieren.',
  },
  management: {
    monitorIntroMulti:
      'Der Worker überwacht offene Trades alle paar Sekunden. Die Regeln gelten pro offenes Leg (jedes Multi-Trade-Leg wird separat verfolgt).',
    moveSlTitle: 'SL nach Bewegung verschieben',
    moveSlSubtitle:
      'Stop-Loss automatisch auf Break-even verschieben (plus optional Teilschließen), sobald der Preis Ihren Schwellwert erreicht.',
    basicPlanAutoManagementLimit:
      'Das automatische Verschieben des Stop-Loss auf Break-even ist im Advanced-Tarif verfügbar.',
    activeRule: 'Aktive Regel:',
    triggerTitle: 'Auslöser — SL verschieben, wenn',
    triggerPips: 'Pip-Bewegung',
    triggerPipsHint:
      'Wie viele Pips im Gewinn, bevor der Stop-Loss auf Break-even verschoben wird.',
    triggerRr: 'Risiko:Gewinn-Verhältnis',
    triggerRrLabel: 'Risiko:Gewinn-Verhältnis',
    triggerRrHint:
      'RR, das erreicht wird, bevor der Stop-Loss auf Break-even verschoben wird (z. B. 1 = 1:1).',
    triggerMoney: 'Gewinn ($)',
    triggerMoneyHint:
      'Unrealisierter Gewinn in Kontowährung, bevor der Stop-Loss auf Break-even verschoben wird.',
    triggerTpHit: 'TP erreicht',
    takeProfit: 'Take-Profit',
    tpHitHint:
      'Welches Take-Profit-Level erreicht sein muss, bevor der Stop-Loss auf Break-even verschoben wird.',
    breakevenOffset: 'Break-even-Versatz (Pips)',
    breakevenOffsetHint:
      'Pips über dem Einstieg beim Setzen des Break-even-Stops (sichert einen kleinen Gewinn).',
    breakevenTypeTitle: 'Break-even-Typ',
    breakevenTypeSubtitle: 'Was passiert, wenn die Auslösebedingung erfüllt ist.',
    moveOnly: 'Nur verschieben',
    moveOnlyHint: 'Nur den Stop-Loss auf Break-even verschieben.',
    moveAndPartial: 'SL verschieben und teilweise schließen',
    moveAndPartialHint:
      'Stop-Loss auf Break-even verschieben und einen Teil der Position schließen.',
    partialClose: 'Teilschließen (%)',
    partialCloseHint:
      'Prozentsatz des Positionsvolumens, der beim Auslösen geschlossen wird.',
    trailingTitle: 'Trailing Stop',
    trailingSubtitle:
      'Zieht den Stop-Loss kontinuierlich nach, wenn sich der Preis zu Ihren Gunsten bewegt (nur Single Trade).',
    trailStart: 'Trailing-Beginn (Pips)',
    trailStartHint: 'Gewinn-Pips, bevor das Trailing beginnt.',
    trailStep: 'Trailing-Schritt (Pips)',
    trailStepHint:
      'Minimale Bewegung zu Ihren Gunsten, bevor der SL erneut nachzieht.',
    trailDistance: 'Trailing-Distanz (Pips)',
    trailDistanceHint:
      'Der SL bleibt diese Anzahl Pips hinter dem Höchstpreis.',
    trailingSingleOnly:
      'Der Trailing Stop ist nur im Single-Trade-Modus verfügbar. Auto-Break-even läuft weiterhin auf jedem Multi-Trade-Leg.',
    triggerModes: {
      pips: 'Pips',
      pipsHint: 'Preisbewegung zu Ihren Gunsten',
      rr: 'R:R',
      rrHint: 'Risiko/Gewinn gegenüber offenem Stop-Loss',
      money: '$ Gewinn',
      moneyHint: 'Unrealisierter Gewinn in Kontowährung',
      tpHit: 'TP erreicht',
      tpHitHint: 'Teil-TP oder TP beim Broker erreicht',
    },
    ruleActionSlOnly: 'Stop-Loss auf {target} verschieben',
    ruleActionSlAndPartial:
      'Stop-Loss auf {target} verschieben und {pct} % der Position schließen',
    ruleTriggerPips: 'nachdem sich der Preis {value} Pips zu Ihren Gunsten bewegt',
    ruleTriggerRr:
      'bei {value}:1 Risiko/Gewinn (setzt einen Stop-Loss im Trade voraus)',
    ruleTriggerMoney: 'nach unrealisiertem Gewinn von ${value}',
    ruleBreakevenOffset: 'Einstieg + {offset} Pip(s)',
    ruleBreakevenTrue: 'Einstieg (echtes Break-even)',
    ruleTriggerTpHit: 'wenn TP{index} erreicht wird',
    orderCommentsTitle: 'Order-Kommentare',
    orderCommentsSubtitle:
      'Wenn deaktiviert, lässt UniCopier das Feld für den Order-Kommentar beim Broker für Trades, die es eröffnet oder aktualisiert, leer.',
  },
  filters: {
    timeTitle: 'Zeitfilter',
    timeSubtitle:
      'Wenn aktiviert, werden Signale nur innerhalb des erlaubten Zeitfensters kopiert (lokale Zeit des Broker-Servers).',
    timeFilter: 'Zeitfilter',
    timeNo: 'Nein — jederzeit handeln',
    timeYes: 'Ja — auf Zeitfenster beschränken',
    startTime: 'Startzeit',
    endTime: 'Endzeit',
    daysTitle: 'Handelstage',
    daysSubtitle:
      'Wenn aktiviert, wird nur an den ausgewählten Wochentagen kopiert.',
    daysFilter: 'Handelstage',
    daysNo: 'Nein — alle Tage',
    daysYes: 'Ja — nur ausgewählte Tage',
    tradingDays: 'Handelstage',
    daysWarning:
      'Wählen Sie mindestens einen Tag aus oder deaktivieren Sie die Handelstage.',
    newsTitle: 'News-Trading',
    newsSubtitle:
      'Verwendet den Wirtschaftskalender (FMP). „Ja“ kopiert auch während der News. „Nein“ pausiert das Kopieren um ausgewählte Veröffentlichungen herum, schließt offene Trades vorab und setzt nach einer Abkühlphase fort.',
    newsTrading: 'News-Trading',
    newsYes: 'Ja — während der News kopieren',
    newsNo: 'Nein — News-Fenster vermeiden',
    avoidImpact: 'News-Wirkung vermeiden',
    impactHigh: 'Hohe Wirkung',
    impactMedium: 'Mittlere Wirkung',
    impactLow: 'Niedrige Wirkung',
    impactWarning:
      'Wählen Sie mindestens ein Wirkungsniveau aus oder aktivieren Sie das News-Trading.',
    closeBeforeNews: 'Alle Trades vor den News schließen (Minuten)',
    resumeAfterNews: 'Kopieren nach den News fortsetzen (Minuten)',
    weekdays: {
      '0': 'Sonntag',
      '1': 'Montag',
      '2': 'Dienstag',
      '3': 'Mittwoch',
      '4': 'Donnerstag',
      '5': 'Freitag',
      '6': 'Samstag',
    },
  },
  strategy: {
    signalBehavior: 'Signalverhalten',
    reverseSignal: 'Signal umkehren',
    addToExisting: 'Neuen Trade zum Bestehenden hinzufügen',
    closeOpposite: 'Bei gegenteiligem Signal schließen',
    closeOnSignalDeleted:
      'Trade schließen / Pending löschen, wenn das Signal gelöscht wird',
    reverseHint:
      'Umkehren: Ein Kanal-Kauf wird als Verkauf kopiert und ein Verkauf als Kauf. Überschriebene Signal-SL/TP (Pips vom Einstieg) werden auf der umgekehrten Seite angewendet. Sind diese deaktiviert, werden die Signal-SL/TP-Preise um den Einstieg gespiegelt.',
    closeOppositeHint:
      'Bei gegenteiligem Signal schließen: Im manuellen Modus schließt ein neuer Kanal-Kauf/-Verkauf alle offenen Trades auf demselben Symbol in die gegengesetzte Richtung (Kanalrichtung, vor dem Umkehren), storniert deren virtuellen Range-Pendings und führt dann den neuen Plan aus.',
    closeOnSignalDeletedHint:
      'Wenn aktiviert, schließt das Löschen der ursprünglichen Signalnachricht auf Telegram, Discord oder WhatsApp die offenen Trades dieses Signals und storniert dessen Pending-Orders (einschließlich virtueller Range-Legs). Standardmäßig deaktiviert.',
    addExistingHint:
      'Zum Bestehenden hinzufügen: Eine Nachfolge auf derselben Seite aktualisiert jedes offene Leg, das zum selben ursprünglichen Signal gehört (gleicher Korb), in Ausführungsreihenfolge (ältestes Leg zuerst), anhand der Multi-Trade-TP-Verteilung des Planners (jedes Leg erhält den SL/TP der passenden direkten Order aus Ihren TP-Lot-Prozentzeilen). Die virtuellen Range-Pendings dieses Korbs werden storniert und unter dem übergeordneten Signal neu eingefügt. Antwort-Thread oder 4-Stunden-Zeitfenster gilt weiterhin. Teil-TP-Zeilen im Single Trade werden nur neu erstellt, wenn der Korb ein einzelnes Leg ist.',
    rrFallbacksTitle: 'R:R-Rückfallwerte',
    rrFallbacksIntro:
      'Wird nur verwendet, wenn vordefinierte und Kanal-SL/TP fehlen. Vordefinierte Überschreibungen im Tab „Ziele“ haben immer Vorrang, wenn sie aktiviert sind.',
    enableRrSl: 'R:R für SL aktivieren',
    slRr: 'SL R:R',
    slRrHint:
      'Wenn der SL fehlt, aber ein TP vorhanden ist: SL-Distanz = (Distanz vom Einstieg bis TP1) ÷ dieses Verhältnis. Vordefinierter Pip-SL (falls aktiv) und Kanal-SL überschreiben dies.',
    enableRrTps: 'R:R für TPs aktivieren',
    tpRrValues: 'TP-R:R-Werte (kommagetrennt)',
    tpRrHint:
      'Wenn die TPs fehlen, aber ein SL vorhanden ist: jeder TP = Einstieg ± (Distanz Einstieg→SL) × jeweiliges Verhältnis. Vordefinierte Pip-TPs (falls aktiv) und Kanal-TPs überschreiben dies.',
    pendingTitle: 'Pending-Orders',
    pendingIntro:
      'Wird auf Limit-/Stop-Sends beim Broker und auf virtuelle Range-Legs des Workers angewendet.',
    pendingExpiry: 'Pending-Ablauf (Stunden 1-24)',
    pendingExpiryHint:
      'Verwenden Sie 1–24 Stunden. Die Werte werden im Planner begrenzt; 0 in gespeicherten Einstellungen bedeutet kein Ablauf (aus diesem Panel nicht empfohlen).',
  },
  channels: {
    noneConnected: 'Keine verbundenen Kanäle gefunden.',
    connectLink: 'Kanäle hier verbinden',
    signalChannels: 'Signalkanäle',
    selected: '{count} ausgewählt',
    pickHint:
      'Verknüpfen Sie Kanäle mit dem Kontrollkästchen und wählen Sie dann einen aus, um dessen eigene Lotgröße, Ziele und Filter zu konfigurieren.',
    keywordFilters: 'Zu befolgende Kanal-Anweisungen filtern',
    allAllowed: 'Alle Kategorien erlaubt',
    ignoredAcross: '{total} für diesen Kanal ignoriert',
    filtersIntro:
      'Markieren Sie eine Kategorie als „Ignorieren“, um passende Anweisungen aus diesem Kanal bei diesem Broker zu überspringen (die Trades laufen weiter). Das Ignorieren von „Position vollständig schließen“ blockiert auch allgemeine Nachrichten wie „schließen“ oder „alle schließen“.',
    selectChannelFirst:
      'Wählen Sie einen verknüpften Kanal aus, um seine Filter zu konfigurieren.',
  },
  channelFilters: {
    unnamedChannel: 'Unbenannter Kanal',
    ignoredBadge: '{count} ignoriert',
    footer:
      'Ignorierte Kategorien entfernen passende Nachrichten aus diesem Kanal, bevor der Worker sie ausführt.',
    resetDefaults: 'Auf Standard zurücksetzen',
    allow: 'Erlauben',
    ignore: 'Ignorieren',
    categories: {
      close_full: {
        label: 'Position vollständig schließen',
        example: 'z. B. „schließen“, „Trade verlassen“, „flach machen“',
      },
      close_half: {
        label: 'Halb / teilweise schließen',
        example: 'z. B. „halb schließen“, „50 % nehmen“',
      },
      break_even: {
        label: 'Break-even',
        example: 'z. B. „SL auf Einstieg setzen“, „BE jetzt“',
      },
      modify_sl: {
        label: 'SL anpassen',
        example: 'z. B. „SL auf 4500 setzen“',
      },
      modify_tp: {
        label: 'TP anpassen',
        example: 'z. B. „TP auf 4600 ändern“',
      },
      close_tp_levels: {
        label: 'Bei benanntem TP schließen',
        example: 'z. B. „TP1 schließen“, „TP2 erreicht“',
      },
      close_all: {
        label: 'Alle offenen Trades schließen',
        example: 'z. B. „alle schließen“, „alles flach machen“',
      },
      close_worse_entries: {
        label: 'Schlechtere Einstiege schließen',
        example: 'z. B. „schlechtere Einstiege schließen“',
      },
      delete_pendings: {
        label: 'Pending-Orders stornieren',
        example: 'z. B. „Limit stornieren“, „Pending löschen“',
      },
      reverse: {
        label: 'Richtung umkehren',
        example: 'tauscht Buy ↔ Sell beim Einstieg',
      },
    },
  },
  pipHint: {
    distance: '{count} Pip(s) ≈ {price} Preis bei {symbol}',
    onePip: '1 Pip = {price} Preis bei {symbol}',
    atLot: ' · Bei {lot} Lot ≈ {amount}',
    perPip: ' · Bei {lot} Lot ≈ {amount}/Pip',
  },
  common: {
    yes: 'Ja',
    no: 'Nein',
  },
  riskDisclaimer: {
    warning:
      'Warnung! Ihr Kapital ist gefährdet. Kopieren Sie nur Signalanbieter, denen Sie vertrauen.',
    fullLink: 'Vollständigen Risikohinweis ansehen',
  },
  configureWithAi: {
    button: 'Mit AI konfigurieren',
    title: 'Mit AI konfigurieren',
    subtitle:
      'Beschreiben Sie, wie Sie handeln möchten — oder laden Sie das Signalformat dieses Kanals für passende Einstellungen.',
    close: 'Schließen',
    placeholder: 'z. B. Break-even auf TP2 setzen oder 1 % Risiko verwenden…',
    send: 'Senden',
    thinking: 'Denkt nach…',
    welcome:
      'Fragen Sie nach einer beliebigen Einstellung (z. B. Break-even bei TP2) oder laden Sie das Signalformat dieses Kanals für die vollständige Einrichtung.',
    needChannel: 'Wählen Sie zuerst einen Kanal aus, um mit AI zu konfigurieren.',
    loadFromChannel: 'Aus Kanal laden',
    loadJsonFormat: 'JSON-Format laden',
    loadingExamples: 'Signale aus diesem Kanal werden geladen…',
    loadingJsonFormat: 'TradingView-JSON-Format wird geladen…',
    examplesLoaded: '{count} Signalbeispiel(e) geladen.',
    examplesEmpty:
      'Auf diesem Kanal wurden noch keine aktuellen Signale gefunden — fügen Sie unten einige Beispielsignale ein oder warten Sie auf neue Nachrichten.',
    examplesEmptyTradingView:
      'Noch kein TradingView-Alert-JSON gefunden — fügen Sie unten ein Beispiel-Alert-JSON ein oder konfigurieren Sie die Alert-Vorlage auf dem Kanal.',
    pasteLabel: 'Signalformat einfügen',
    pastePlaceholder: 'Fügen Sie ein oder mehrere Beispiel-Kanalsignale ein…',
    pastePlaceholderTradingView:
      'Fügen Sie ein oder mehrere TradingView-Alert-JSON-Payloads ein…',
    usePaste: 'Eingefügte Signale verwenden',
    clearPaste: 'Einfügung löschen',
    examplesCount: '{count} Beispiel(e) im Kontext',
    examplesHeading: 'Signalbeispiele',
    examplesHeadingTradingView: 'TradingView-JSON-Format',
    exampleLabelEntry: 'Einstieg',
    exampleLabelUpdate: 'Aktualisierung',
    exampleLabelIgnore: 'Ignorieren',
    analyzingExamples: 'Ihr Signalformat wird analysiert…',
    analyzingJsonFormat: 'Ihr TradingView-JSON-Format wird analysiert…',
    analyzeRequest:
      'Analysieren Sie die soeben geladenen Signalbeispiele (auch unten und im Kontext aufgelistet). Klassifizieren Sie den Einstiegsstil (Einzel Preis vs. Range/Zone / Teaser→Parameter), wie der Kanal Modify/Close sendet, berücksichtigen Sie meine Kontogröße, fassen Sie Lotgröße, Trade-Style, Ziele und Management zusammen und rufen Sie dann propose_settings mit einem vollständigen Entwurf auf. Fragen Sie nur, wenn etwas Kritisches fehlt.',
    analyzeRequestTradingView:
      'Analysieren Sie das soeben geladene TradingView-Alert-JSON-Format (auch unten und im Kontext aufgelistet). Klassifizieren Sie die Payload-Form (Einstieg, SL, TPs), berücksichtigen Sie meine Kontogröße, schlagen Sie Lotgröße, Trade-Style, Ziele und Management vor und rufen Sie dann propose_settings auf. Fragen Sie nur, wenn etwas Kritisches fehlt.',
    applyToForm: 'Einstellungen übernehmen',
    applySettings: 'Einstellungen übernehmen',
    applySettingsHint:
      'Dadurch werden die Einstellungen auf die Konfiguration übernommen.',
    somethingElsePill: 'Etwas anderes',
    dismissProposal: 'Verwerfen',
    proposalTitle: 'Vorgeschlagene Einstellungen',
    proposalApplied:
      'Auf das Formular übernommen — klicken Sie auf Speichern in „Trading konfigurieren“, wenn Sie bereit sind.',
    proposalRationale: 'Warum',
    proposalWarnings: 'Hinweise',
    errorFallback: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    trainHint:
      'Sie können auch „Signalbeispiele“ im Konfigurieren-Bereich trainieren, um die Kanalmuster zu aktualisieren.',
  },
  advancedOnlyNotice: {
    title: 'Diese Einstellungen erfordern den Advanced-Tarif',
    body:
      'Ihr aktueller Tarif führt Einstiege nur mit einfachen Einstellungen aus. Da diese Konfiguration die folgenden Punkte verwendet, werden Signale aus diesem Kanal übersprungen statt kopiert. Schalten Sie sie aus oder upgraden Sie den Tarif.',
    items: {
      multiTrade: 'Mehrere Positionen pro Signal (Trade-Style: multiple)',
      rangeTrading: 'Range-Trading',
      moveSlToEntry:
        'Verschieben des Stop-Loss auf den Einstieg nach einem Auslöser',
      reverseSignal: 'Umgekehrte Richtung',
      closeWorseEntries:
        'Schließen direkter Einstiege, wenn der Preis über das Signal hinausläuft',
      riskReward: 'Stop-Loss oder Ziele aus Risiko/Rendite berechnet',
    },
  },
}
