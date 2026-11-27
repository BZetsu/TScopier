import { configureModalDe } from '../configureModal/de'
import { statusModalDe } from './statusModalDe'
import type { AccountConfigBundleTranslations } from './types'

export const accountConfigDe: AccountConfigBundleTranslations = {
  accountConfig: {
    brokersEmptyTitle: 'Noch keine Konten verbunden',
    brokersEmptySubtitle: 'Fügen Sie Ihr Handelskonto hinzu, um loszulegen',
    addAccount: {
      title: 'Handelskonto hinzufügen',
      subtitle: 'Wählen Sie Ihre bevorzugte Handelsplattform, um loszulegen',
      comingSoonBadge: 'Demnächst',
      assetForex: 'Forex',
      assetCrypto: 'Krypto',
      assetFutures: 'Futures',
      comingSoonPlatform:
        'Die {platform}-Integration kommt bald. Wählen Sie vorerst MT4 oder MT5.',
    },
    connectForm: {
      addAccountButton: 'Konto hinzufügen',
      title: 'Neues {platform}-Konto verbinden',
      accountLabel: 'Kontobezeichnung (optional)',
      accountLabelPlaceholder: 'z. B. Live {platform}',
      platformLabel: 'Plattform',
      platformMt5: 'MetaTrader 5 (MT5)',
      platformMt4: 'MetaTrader 4 (MT4)',
      platformCtrader: 'cTrader',
      ctraderConnectButton: 'Mit cTrader fortfahren',
      ctraderConnectHint:
        'Sie melden sich bei cTrader an und wählen das Handelskonto, auf das kopiert werden soll.',
      ctraderNotConfigured:
        'cTrader ist noch nicht konfiguriert. Fügen Sie die Open-API-App-Zugangsdaten hinzu und versuchen Sie es erneut.',
      ctraderPickAccount: 'cTrader-Konto wählen',
      ctraderLinkButton: 'Konto verknüpfen',
      ctraderDemo: 'Demo',
      ctraderLive: 'Live',
      platformBinance: 'Binance Futures (USD-M)',
      platformBybit: 'Bybit Futures (Linear)',
      platformKucoin: 'KuCoin Futures',
      selectAnotherPlatform: 'Andere Plattform wählen',
      binanceConnectHint:
        'Fügen Sie einen Futures-API-Schlüssel und das Geheimnis ein. Aktivieren Sie Futures für den Schlüssel und lassen Sie Auszahlungen deaktiviert. Signale eröffnen Positionen, deren Größe sich aus Ihrer Margin und Ihrem Hebel ergibt.',
      binanceApiKeyLabel: 'API-Schlüssel',
      binanceApiSecretLabel: 'API-Geheimnis',
      binanceApiSecretHint:
        'Wird verschlüsselt gespeichert und nie wieder angezeigt. Falls der Schlüssel eine IP-Einschränkung hat, erlauben Sie die IP des Workers.',
      binanceApiHelpTitle: 'So erhalten Sie Ihren API-Schlüssel',
      binanceApiHelpSteps: [
        'Melden Sie sich bei Binance an und öffnen Sie die API-Verwaltung.',
        'Klicken Sie auf „API erstellen“ und wählen Sie „Systemgeneriert“.',
        'Benennen Sie den Schlüssel und schließen Sie die Sicherheitsüberprüfung ab.',
        'Aktivieren Sie unter API-Einschränkungen „Futures“ und lassen Sie Auszahlungen deaktiviert.',
        'Kopieren Sie den API-Schlüssel und das Geheimnis (das Geheimnis wird nur einmal angezeigt) und fügen Sie sie hier ein.',
      ],
      binanceApiHelpLink: 'Binance-API-Verwaltung öffnen',
      bybitApiHelpSteps: [
        'Melden Sie sich bei Bybit an und öffnen Sie die API-Verwaltung (Profil → API).',
        'Klicken Sie auf „Neuen Schlüssel erstellen“ und wählen Sie „Systemgenerierte API-Schlüssel“.',
        'Benennen Sie den Schlüssel, setzen Sie die Berechtigungen auf „Lesen und Schreiben“ und schließen Sie die Sicherheitsüberprüfung ab.',
        'Aktivieren Sie unter den Schlüsselberechtigungen „Contract“ → „Orders“ und „Positions“ und lassen Sie Auszahlungen deaktiviert.',
        'Wechseln Sie für Demo zunächst zum Demo-Trading und erstellen Sie den Schlüssel dort.',
        'Kopieren Sie den API-Schlüssel und das Geheimnis (das Geheimnis wird nur einmal angezeigt) und fügen Sie sie hier ein.',
      ],
      bybitApiHelpLink: 'Bybit-API-Verwaltung öffnen',
      kucoinApiHelpSteps: [
        'Melden Sie sich bei KuCoin an und öffnen Sie die API-Verwaltung.',
        'Klicken Sie auf „API erstellen“ und wählen Sie „API-basiertes Trading“.',
        'Benennen Sie den Schlüssel, setzen Sie eine API-Passphrase (merken Sie sie sich) und schließen Sie die Sicherheitsüberprüfung ab.',
        'Aktivieren Sie die Berechtigungen „General“ und „Futures“ und lassen Sie Auszahlungen deaktiviert.',
        'Kopieren Sie den API-Schlüssel, das Geheimnis und die Passphrase (das Geheimnis wird nur einmal angezeigt) und fügen Sie sie hier ein.',
      ],
      kucoinApiHelpLink: 'KuCoin-API-Verwaltung öffnen',
      binanceEnvironmentLabel: 'Umgebung',
      binanceLive: 'Live',
      binanceDemo: 'Demo',
      binanceMarginLabel: 'Margin pro Trade (USDT)',
      binanceMarginHint:
        'Jedes Signal eröffnet eine Position über Margin × Hebel, unabhängig von der Lot-Größe im Signal.',
      binanceLeverageLabel: 'Hebel',
      binanceLeverageHint:
        'Ganze Zahl von 1 bis 125. Wird vor jeder Order auf das Symbol angewendet.',
      binanceMarginModeLabel: 'Margin-Modus',
      binanceIsolated: 'Isoliert',
      binanceCross: 'Cross',
      binanceMarginModeHint:
        'Isoliert begrenzt jede Position auf ihre eigene Margin. Cross nutzt Ihren gesamten Futures-Wallet gemeinsam.',
      binanceConnectButton: 'Binance verbinden',
      binanceKeysRequired: 'Geben Sie den API-Schlüssel und das Geheimnis ein.',
      binanceInvalidMargin: 'Die Margin muss eine Zahl größer als 0 sein.',
      binanceInvalidLeverage: 'Der Hebel muss eine ganze Zahl von 1 bis 125 sein.',
      binanceSettingsTitle: 'Futures-Trading-Einstellungen',
      binanceSettingsSave: 'Einstellungen speichern',
      binanceSettingsSaved: 'Einstellungen gespeichert.',
      bybitConnectHint:
        'Fügen Sie einen Bybit-API-Schlüssel und das Geheimnis aus einem Unified Trading Account ein. Aktivieren Sie Contract Trade (Orders und Positions) und lassen Sie Auszahlungen deaktiviert. Signale eröffnen lineare USDT/USDC-Positionen, deren Größe sich aus Ihrer Margin und Ihrem Hebel ergibt.',
      bybitConnectButton: 'Bybit verbinden',
      bybitMarginModeNote:
        'Der Margin-Modus wird in Ihrem Bybit-Konto festgelegt. UniCopier liest ihn aus und ändert ihn nie.',
      bybitPortfolioMargin: 'Portfolio-Margin',
      kucoinConnectHint:
        'Fügen Sie einen KuCoin-API-Schlüssel, das Geheimnis und die Passphrase ein. Aktivieren Sie die Berechtigungen General und Futures und lassen Sie Auszahlungen deaktiviert. Signale eröffnen lineare USDT-Positionen, deren Größe sich aus Ihrer Margin und Ihrem Hebel ergibt.',
      kucoinConnectButton: 'KuCoin verbinden',
      kucoinApiPassphraseLabel: 'API-Passphrase',
      kucoinApiPassphraseHint:
        'Die Passphrase, die Sie beim Erstellen des Schlüssels festgelegt haben. Sie wird verschlüsselt gespeichert und nie wieder angezeigt.',
      kucoinKeysRequired:
        'Geben Sie Ihren KuCoin-API-Schlüssel, das Geheimnis und die Passphrase ein.',
      dxtradeConnectHint:
        'Verbinden Sie Ihr eigenes DXtrade-Konto mit den Zugangsdaten, die Sie von Ihrem Broker erhalten haben. Nur positionsbasierte (Hedging-)Konten funktionieren. Geben Sie nie ein Passwort weiter, mit dem auch Mittel überwiesen werden können; bitten Sie Ihren Broker um einen reinen Handels-Login, falls er diesen anbietet.',
      dxtradeConnectButton: 'DXtrade verbinden',
      dxtradeServerUrlLabel: 'Broker-Server-URL',
      dxtradeServerUrlHint:
        'Die Adresse der DXtrade-Plattform Ihres Brokers, zum Beispiel https://trade.your-broker.com. Sie können den Link zur Web-Plattform einfügen.',
      dxtradeUsernameLabel: 'Benutzername',
      dxtradeDomainLabel: 'Domain',
      dxtradeDomainHint:
        'Normalerweise „default“. Ändern Sie dies nur, wenn Ihr Broker eine andere angegeben hat.',
      dxtradePasswordLabel: 'Passwort',
      dxtradePasswordHint:
        'Wird vor dem Speichern verschlüsselt und nie wieder angezeigt.',
      dxtradeAccountCodeLabel: 'Kontocode (optional)',
      dxtradeAccountCodeHint:
        'Nur nötig, wenn Ihr Login mehrere Konten hat. Format: clearing:account.',
      dxtradeInvalidServer:
        'Geben Sie die DXtrade-URL Ihres Brokers ein, zum Beispiel https://trade.your-broker.com.',
      dxtradeInvalidUsername: 'Geben Sie den Benutzernamen ohne @domain ein.',
      dxtradeLoginRequired: 'Geben Sie Ihren DXtrade-Benutzernamen und Ihr Passwort ein.',
      tradelockerConnectHint:
        'Verbinden Sie Ihr eigenes TradeLocker-Konto mit dem Login, den Sie auf der TradeLocker-Plattform verwenden. Wählen Sie Demo oder Live entsprechend dem Ort des Kontos. Geben Sie nie ein Passwort weiter, mit dem auch Mittel überwiesen werden können; bitten Sie Ihren Broker um einen reinen Handels-Login, falls er diesen anbietet.',
      tradelockerConnectButton: 'TradeLocker verbinden',
      tradelockerServerLabel: 'Broker-Servername',
      tradelockerServerHint:
        'Der Servername, der auf der TradeLocker-Anmeldeseite angezeigt wird, exakt so wie geschrieben.',
      tradelockerEmailLabel: 'E-Mail',
      tradelockerPasswordLabel: 'Passwort',
      tradelockerPasswordHint:
        'Wird vor dem Speichern verschlüsselt und nie wieder angezeigt.',
      tradelockerAccountIdLabel: 'Kontonummer (optional)',
      tradelockerAccountIdHint:
        'Nur nötig, wenn Ihr Login mehrere Konten hat. Verwenden Sie die Nummer, die neben dem Konto in TradeLocker angezeigt wird.',
      tradelockerInvalidServer:
        'Geben Sie den Broker-Servernamen ein, der auf der TradeLocker-Anmeldeseite angezeigt wird.',
      tradelockerInvalidEmail:
        'Geben Sie die E-Mail-Adresse ein, mit der Sie sich bei TradeLocker anmelden.',
      tradelockerInvalidAccountId: 'Kontonummern enthalten nur Ziffern.',
      tradelockerLoginRequired: 'Geben Sie Ihre TradeLocker-E-Mail und Ihr Passwort ein.',
      matchtraderConnectHint:
        'Verbinden Sie Ihr eigenes Match-Trader-Konto mit dem Login, den Sie auf der Match-Trader-Plattform Ihres Brokers verwenden. Demo oder Live wird anhand des Kontos erkannt. Geben Sie nie ein Passwort weiter, mit dem auch Mittel überwiesen werden können; bitten Sie Ihren Broker nach Möglichkeit um einen reinen Handels-Login.',
      matchtraderConnectButton: 'Match-Trader verbinden',
      matchtraderUrlLabel: 'Plattform-URL',
      matchtraderUrlHint:
        'Die Webadresse, die Sie zum Handeln öffnen, zum Beispiel https://trade.yourbroker.com.',
      matchtraderEmailLabel: 'E-Mail',
      matchtraderPasswordLabel: 'Passwort',
      matchtraderPasswordHint:
        'Wird vor dem Speichern verschlüsselt und nie wieder angezeigt.',
      matchtraderAccountIdLabel: 'Kontonummer (optional)',
      matchtraderAccountIdHint:
        'Nur nötig, wenn Ihr Login mehrere Konten hat. Verwenden Sie die Nummer, die neben dem Konto in Match-Trader angezeigt wird.',
      matchtraderBrokerIdLabel: 'Broker-ID (optional)',
      matchtraderBrokerIdHint:
        'Wird automatisch aus der Plattform-URL ermittelt. Füllen Sie dieses Feld nur aus, wenn Ihr Broker es verlangt.',
      matchtraderInvalidUrl:
        'Geben Sie die https-Adresse der Match-Trader-Plattform Ihres Brokers ein.',
      matchtraderInvalidEmail:
        'Geben Sie die E-Mail-Adresse ein, mit der Sie sich bei Match-Trader anmelden.',
      matchtraderInvalidAccountId:
        'Geben Sie die Kontonummer genau so ein, wie sie in Match-Trader angezeigt wird.',
      matchtraderInvalidBrokerId:
        'Broker-IDs enthalten nur Buchstaben, Ziffern, Bindestriche und Unterstriche.',
      matchtraderLoginRequired: 'Geben Sie Ihre Match-Trader-E-Mail und Ihr Passwort ein.',
      brokerServerLabel: 'Broker-Server',
      brokerServerHint:
        'Fügen Sie den genauen Servernamen aus Ihrem MetaTrader-Terminal ein (Datei → Anmeldung am Handelskonto).',
      brokerServerPlaceholder: 'z. B. ICMarketsSC-MT5',
      brokerCompanySearchPlaceholder: 'Nach Broker-Firmenname oder Servername suchen',
      brokerCompanySearchServersHeading: 'Server',
      brokerCompanySearchCompaniesHeading: 'Broker',
      brokerCompanySearchEmpty: 'Suchen Sie nach Ihrem Broker oder Servernamen',
      brokerCompanySearchMinChars:
        'Geben Sie mindestens 4 Zeichen ein, um zu suchen',
      brokerCompanySearchNoResults: 'Keine Treffer in unserem Broker-Verzeichnis.',
      brokerCompanySearchUseQuery: '„{query}“ als Servername verwenden',
      brokerCompanySearchLoading: 'Broker werden gesucht…',
      brokerCompanySearchError:
        'Brokersuche fehlgeschlagen. Versuchen Sie es erneut oder geben Sie Ihren Server manuell ein.',
      brokerServerPickerTitle: 'Server',
      brokerServerSelectPrompt: 'Suchen Sie nach Ihrem Broker',
      brokerServerManualToggle: 'Broker nicht gefunden? Server manuell eingeben',
      brokerServerManualLabel: 'Servername',
      brokerServerManualHint: 'Verwenden Sie den genauen Servernamen aus Ihrem MT-Terminal.',
      mtLoginLabel: 'MT-Login',
      mtLoginPlaceholder: 'Handelskontonummer',
      passwordLabel: 'Passwort',
      passwordPlaceholder: 'Passwort des Handelskontos',
      passwordHint: '',
      rememberPasswordLabel: 'Passwort für automatische Wiederverbindung merken',
      rememberPasswordHint:
        'Verschlüsselt Ihr MT-Passwort auf unseren Servern, damit UniCopier die Sitzung wiederherstellen kann, ohne Sie zu fragen. Sie können es jederzeit entfernen.',
      connectButton: 'Konto verbinden',
      connectingTitle: 'Ihr Broker wird verbunden',
      connectingStepLinking: 'Ihr {platform}-Konto wird verknüpft…',
      connectingStepTerminal:
        'Ihr {platform}-Terminal wird gestartet – das dauert normalerweise 10–30 Sekunden.',
      connectingStepSlow:
        'Läuft noch… die Ersteinrichtung kann einige Minuten dauern.',
      validationRequired: 'Kontonummer, Passwort und Server sind erforderlich',
      connectFailed: 'Konto konnte nicht verbunden werden',
      addMoreButton: 'Weitere hinzufügen',
      removeRowAria: 'Kontozeile entfernen',
      connectMultipleButton: '{count} Konten verbinden',
      uploadAccountsButton: 'Konten hochladen',
      accountRowTitle: 'Konto {index}',
    },
    bulkConnect: {
      title: 'MT4/MT5-Konten hochladen',
      securityNote:
        'Ihre CSV enthält Handelspasswörter. Sie wird ausschließlich in Ihrem Browser verarbeitet und nie als Datei hochgeladen.',
      downloadTemplate: 'CSV-Vorlage herunterladen',
      uploadCsv: 'CSV hochladen',
      uploadHint:
        'Ziehen Sie eine CSV-Datei hierher oder klicken Sie zum Durchsuchen. Verwenden Sie pro Zeile die Plattform-Spalte (MT4 oder MT5) – standardmäßig MT5, falls nicht angegeben.',
      previewTitle: 'Vorschau',
      colLabel: 'Bezeichnung',
      colPlatform: 'Plattform',
      colServer: 'Server',
      colLogin: 'Login',
      colPassword: 'Passwort',
      colStatus: 'Status',
      parseErrorLine: 'Zeile {line}: {message}',
      noValidRows: 'In der CSV wurden keine gültigen Konten gefunden.',
      connectCount: '{count} Konten verbinden',
      connectingTitle: 'Konten werden verknüpft…',
      statusQueued: 'In Warteschlange',
      statusLinking: 'Verknüpfung läuft…',
      statusLinked: 'Verknüpft',
      statusFailed: 'Fehlgeschlagen',
      statusSkippedDuplicate: 'Duplikat',
      statusSkippedLimit: 'Limit erreicht',
      statusSkippedInvalid: 'Ungültig',
      summaryTitle: 'Verknüpfte Konten',
      summaryBody: '{linked} verknüpft, {failed} fehlgeschlagen, {skipped} übersprungen.',
      summaryFailedTitle: 'Fehlgeschlagene Konten',
      dismiss: 'Schließen',
      viewBrokers: 'Broker anzeigen',
    },
    brokerList: {
      statusPaused: 'Pausiert',
      statusConnected: 'Verbunden',
      statusConnecting: 'Verbindung wird hergestellt',
      statusRecovering: 'Neuverbindung',
      statusError: 'Fehler',
      statusDisconnected: 'Getrennt',
      statusHealthy: 'Funktionsfähig',
      statusUnhealthy: 'Nicht funktionsfähig',
      statusHealthChecking: 'Wird geprüft…',
      statusHealthView: 'Broker-Zustand anzeigen',
      copyTrades: 'Trades kopieren',
      reconnect: 'Neu verbinden',
      reconnectAll: 'Alle neu verbinden',
      configure: 'Konfigurieren',
      removeAria: '{label} entfernen',
      detailLogin: 'Login',
      detailAccountType: 'Kontotyp',
      accountTypeDemo: 'Demo',
      accountTypeLive: 'Live',
      accountTypePropFirm: 'Prop-Firm',
      detailServer: 'Server',
      detailSignalChannels: 'Signalquelle',
      detailBalance: 'Kontostand',
      detailEquity: 'Equity',
      channelsNoneSelected: 'Nichts ausgewählt',
      channelsLinkedCount: '{count} Quellen',
      channelsEmptySaveWarning:
        'Keine Signalkanäle ausgewählt – dieser Broker wird keine Telegram-Signale kopieren. Trotzdem speichern?',
      channelsSaveChannelListNotReady:
        'Die Kanalliste wird noch geladen. Warten Sie einen Moment und versuchen Sie es erneut.',
      channelsSaveLinkedChannelsInvalid:
        'Die verknüpften Signalkanäle konnten nicht gespeichert werden. Aktualisieren Sie die Seite und versuchen Sie es erneut.',
      channelsSignalChannel: 'Signalkanal',
      channelsAll: 'Alle Signalkanäle',
      relinkOne:
        'Dieses Konto verwendet ein älteres Verknüpfungsformat. Entfernen Sie es und verbinden Sie es erneut mit Ihrem MT-Login und Passwort.',
      relinkMany:
        '{count} Konten verwenden ein älteres Verknüpfungsformat. Entfernen Sie jedes davon und verbinden Sie es erneut mit Ihrem MT-Login und Passwort.',
      reconnectDroppedOne:
        'Die Handelssitzung ist auf dem Handelsserver abgelaufen. Verwenden Sie „Neu verbinden“ und geben Sie Ihr aktuelles MT-Passwort ein.',
      reconnectDroppedMany:
        '{count} Konten haben ihre Broker-Verbindung verloren und werden als „Getrennt“ angezeigt. Verwenden Sie bei jedem Konto „Neu verbinden“.',
      connectErrorWrongPassword:
        'Das MT-Kontopasswort ist falsch. Prüfen Sie das Passwort in Ihrem MetaTrader-Terminal und versuchen Sie es erneut.',
      connectErrorWrongLogin:
        'Die MT-Login-Nummer passt nicht zu diesem Broker-Server. Überprüfen Sie die Kontonummer in MetaTrader.',
      connectErrorWrongServer:
        'Der Broker-Servername ist falsch oder passt nicht zu diesem Login. Prüfen Sie den genauen Servernamen in MetaTrader.',
      connectErrorInvestorPassword:
        'Es wurde ein Anleger-Passwort (nur Lesen) verwendet. Verbinden Sie sich mit dem Haupt-Passwort aus MetaTrader.',
      connectErrorAccountDisabled:
        'Dieses MT-Konto ist bei Ihrem Broker deaktiviert oder gesperrt. Kontaktieren Sie Ihren Broker oder melden Sie sich zuerst über MetaTrader an.',
      connectErrorCredentialsRejected:
        'Die Anmeldung mit diesen MT-Daten ist fehlgeschlagen. Überprüfen Sie Ihre Kontonummer, Ihr Handelspasswort und den genauen Servernamen aus MetaTrader.',
      connectErrorTerminalNotReady:
        'Wir konnten Ihr Konto noch nicht vom Broker laden. Wenn Sie gerade verbunden haben, warten Sie eine Minute und versuchen Sie es erneut. Überprüfen Sie sonst, ob MT-Login, Passwort und Servername exakt mit MetaTrader übereinstimmen.',
      connectErrorSessionExpired:
        'Die Handelssitzung ist auf dem Handelsserver abgelaufen. Verwenden Sie „Neu verbinden“ und geben Sie Ihr aktuelles MT-Passwort ein.',
      connectErrorThrottled:
        'Zu viele Verbindungsanfragen in kurzer Zeit. Warten Sie etwa eine Minute und versuchen Sie es erneut.',
      connectErrorUnknown:
        'Broker-Verbindung fehlgeschlagen. Prüfen Sie Ihre MT-Zugangsdaten oder verwenden Sie „Neu verbinden“, falls dieses Konto früher verknüpft war.',
      reconnectFailed: 'Broker konnte nicht neu verbunden werden',
      reconnectPasswordTitle: 'Broker-Sitzung abgelaufen',
      reconnectPasswordBody:
        'Ihre Broker-Sitzung ist auf dem Handelsserver abgelaufen. Geben Sie Ihr MT-Kontopasswort ein, um die Verbindung wiederherzustellen.',
      reconnectMigrationTitle:
        'Wir haben geändert, wie sich UniCopier mit Ihrem Broker verbindet',
      reconnectMigrationBody:
        'Verbinden Sie dieses Konto neu, um weiterhin Trades zu kopieren. Ihre Einstellungen, die Trade-Historie und die offenen Trades bleiben unverändert.',
      reconnectMigrationPasswordTitle:
        'Geben Sie Ihr Passwort ein, um sich neu zu verbinden',
      reconnectMigrationPasswordBody:
        'Ihre Kontonummer und Ihr Server sind bereits eingetragen. Das Passwort wird verschlüsselt gespeichert und nur für die Verbindung zu Ihrem Broker verwendet.',
      reconnectMigrationBack: 'Zurück',
      reconnectManyAccountsHint:
        '{count} Konten müssen neu verbunden werden. Das Passwort wird für jedes Konto einmal abgefragt.',
      remindLater: 'Später daran erinnern',
      deleteAccountLink: 'Ich kann nicht neu verbinden – dieses Konto löschen',
      deleteConfirmTitle: 'Dieses Konto löschen?',
      deleteConfirmBody:
        'Dadurch werden das Konto, seine Trade-Historie und seine Einstellungen aus UniCopier entfernt. Die Positionen selbst verbleiben bei Ihrem Broker. Sie können das Konto später mit einem neuen Passwort wieder verbinden.',
      deleteConfirmNote: 'Dies kann nicht rückgängig gemacht werden.',
      deleteConfirmCta: 'Konto löschen',
      reconnectConnectingTitle: 'Ihr Konto wird verbunden',
      reconnectConnectingBody:
        'Anmeldung akzeptiert. Es wird auf die Broker-Brücke gewartet – das kann einen Moment dauern.',
      reconnectSuccessTitle: 'Konto verbunden',
      reconnectSuccessBody: 'Verbunden. Das Kopieren wird automatisch fortgesetzt.',
      reconnectSuccessNext: 'Nächstes Konto',
      reconnectSuccessDone: 'Fertig',
      reconnectPasswordLabel: 'MT-Kontopasswort',
      reconnectPasswordHint:
        'Wird nur an MT-Server gesendet und verschlüsselt gespeichert, damit das Konto automatisch neu verbunden werden kann.',
      reconnectPasswordPlaceholder: 'Passwort des Handelskontos',
      rememberPasswordLabel: 'Passwort für automatische Wiederverbindung merken',
      rememberPasswordHint:
        'Speichert eine verschlüsselte Kopie, damit UniCopier sich neu verbinden kann, ohne erneut zu fragen. Sie können dies in der Kontokonfiguration löschen.',
      clearStoredCredentials: 'Gespeichertes Passwort vergessen',
      storedCredentialsActive: 'Automatische Neuverbindung aktiviert',
      deleteFailed: 'Broker konnte nicht gelöscht werden',
      deleteSessionExpired:
        'Ihre Anmeldesitzung ist abgelaufen. Aktualisieren Sie die Seite und versuchen Sie es erneut, oder melden Sie sich ab und wieder an.',
      duplicateMtLogin:
        'Dieser MT-Login ist hier bereits mit einem anderen Konto verknüpft. Entfernen Sie ihn zuerst oder verwenden Sie „Neu verbinden“ – derselbe Login kann nicht zweimal verbunden werden.',
      platformServerMismatchMt4:
        'Dieser Servername sieht nach MT4 aus, Sie haben aber MT5 gewählt. Kopieren und Trade-Management funktionieren möglicherweise nicht. Stattdessen als MT4 verbinden?',
      platformServerMismatchMt5:
        'Dieser Servername sieht nach MT5 aus, Sie haben aber MT4 gewählt. Kopieren und Trade-Management funktionieren möglicherweise nicht. Stattdessen als MT5 verbinden?',
      deleteTitle: 'Handelskonto entfernen?',
      deleteBody:
        'Dadurch wird {label} von Ihrem Broker und dem Copier getrennt. Dies kann nicht rückgängig gemacht werden.',
      deleteConfirm: 'Trennen',
      connectedAccountsHeading: 'Verbundene Konten',
      connectedAccountsUnlimited: 'Unbegrenzt',
      brokerFilterLabel: 'Broker',
      brokerFilterAll: 'Alle Broker',
      brokerFilterNoMatch: 'Keine Konten passen zu diesem Broker.',
      accountSearchLabel: 'Konten suchen',
      accountSearchPlaceholder: 'Bezeichnung, Login, Server, Broker…',
      accountSearchNoMatch: 'Keine Konten entsprechen Ihrer Suche.',
      overviewTotal: 'Konten gesamt',
      overviewActive: 'Aktive Konten',
      overviewInactive: 'Inaktive Konten',
      overviewBest: 'Bestes Konto',
      overviewNotAvailable: 'k. A.',
      overviewRoi: '{percent} ROI',
      accountsHeading: 'Konten',
      noData: 'Keine Daten',
      colName: 'Name',
      colAccount: 'Konto',
      colPlatform: 'Plattform',
      colBalance: 'Kontostand',
      colConnection: 'Verbindung',
      colStatus: 'Status',
      colActions: 'Aktionen',
      statusActive: 'Aktiv',
      statusInactive: 'Inaktiv',
      platformFilterAll: 'Alle Plattformen',
    },
    brokerConnectedSuccess: {
      title: 'Broker verbunden',
      titlePending: 'Broker verknüpft',
      body: '{account} ist verbunden und bereit, Signale zu kopieren.',
      bodyPending:
        '{account} ist verknüpft. Ihr MT5-Terminal wird gestartet – Sie können die Kanäle konfigurieren, während die Verbindung hergestellt wird.',
      addChannel: 'Kanal hinzufügen',
      configure: 'Konfigurieren',
    },
    configureModal: configureModalDe,
    statusModal: statusModalDe,
  },
}
