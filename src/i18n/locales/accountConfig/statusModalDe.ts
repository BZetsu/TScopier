import type { BrokerStatusModalCopy } from '../types'

export const statusModalDe: BrokerStatusModalCopy = {
  title: 'Broker-Zustand',
  subtitle: 'Live-Momentaufnahme aus Ihrem Handelsterminal',
  healthyTitle: 'Funktionsfähig',
  unhealthyTitle: 'Nicht funktionsfähig',
  healthyBody: 'Alle Prüfungen bestanden – der Copier kann auf diesem Konto handeln.',
  unhealthyBody:
    'Ein oder mehrere Prüfungen sind fehlgeschlagen – das Kopieren funktioniert möglicherweise erst, wenn dies behoben ist.',
  refresh: 'Aktualisieren',
  close: 'Schließen',
  loading: 'Terminalstatus wird geladen…',
  unsupported:
    'Zustandsprüfungen sind noch nicht verfügbar. Stellen Sie die neueste Edge-Funktion fxsocket-broker bereit.',
  loadFailed: 'Der Terminalstatus konnte nicht geladen werden. Versuchen Sie es gleich noch einmal.',
  sectionOverall: 'Copier-Bereitschaft',
  sectionTerminal: 'Cloud-Terminal',
  sectionBroker: 'Broker-Verbindung',
  sectionAccount: 'Handelskonto',
  sectionBridge: 'Handelsbrücke',
  serverTime: 'Broker-Serverzeit',
  checkStatusReady: 'Terminalstatus ist bereit',
  checkTerminalAlive: 'Terminal ist aktiv',
  checkBrokerConnected: 'Mit Broker verbunden',
  checkAccountLoggedIn: 'Konto angemeldet',
  checkAccountTradeAllowed: 'Handel erlaubt',
  checkBridgeTradeEaReady: 'Trade EA bereit',
  checkBridgeSymbolsSynced: 'Symbole synchronisiert',
  checkBridgeTradeEaReadyHint:
    'Aktivieren Sie Algo Trading in MT5, lassen Sie das Terminal dort laufen, wo FxSocket verknüpft ist, und aktualisieren Sie, bis diese Prüfung grün ist.',
  tradeEaNotReadyTitle: 'Trade EA nicht bereit',
  tradeEaNotReadyBody:
    'Ihr Terminal ist verbunden, aber es können noch keine Orders gesendet werden. Aktivieren Sie Algo Trading auf MT5 und warten Sie, bis die Handelsbrücke vollständig gestartet ist.',
  labelBuild: 'Build',
  labelPing: 'Ping',
  labelServer: 'Server',
  labelLogin: 'Login',
  labelCurrency: 'Währung',
  labelAccountType: 'Kontotyp',
  labelBridgeVersion: 'Brücken-Version',
  valueYes: 'Ja',
  valueNo: 'Nein',
}
