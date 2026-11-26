import { en } from './en'
import { mergeLocaleBundle } from './merge'
import type { Translations } from './types'

/**
 * Italian product interface.
 *
 * Partial by design: `mergeLocaleBundle` overlays these overrides onto the
 * English bundle, so anything not translated here stays in English rather than
 * disappearing. `en.<section>` is spread first because the merge is shallow for
 * every section except `copierLogs` and `channelWorker` — assigning a bare
 * object would replace the whole section and drop the keys it does not carry.
 *
 * Covered so far: the language picker, navigation, the shared buttons, and the
 * billing page including the recovery-code redemption strings.
 */
export const it: Translations = mergeLocaleBundle(en, {
  common: {
    ...en.common,
    comingSoon: 'A breve',
    underDevelopment: 'Questa funzionalità è in sviluppo',
    loading: 'Caricamento…',
    refresh: 'Aggiorna',
    save: 'Salva',
    cancel: 'Annulla',
    delete: 'Elimina',
    edit: 'Modifica',
    add: 'Aggiungi',
    all: 'Tutti',
    yes: 'Sì',
    no: 'No',
    preview: 'Anteprima',
    synced: 'sincronizzato {time}',
    won: 'Vinto {count}',
    lost: 'Perso {count}',
    breakeven: '{count} break-even',
    vsYesterday: '{amount} rispetto a ieri',
    perPage: 'Per pagina',
    previous: 'Precedente',
    next: 'Successivo',
    showingRange: '{start}–{end} di {total}',
    noResults: 'Nessun risultato',
    show: 'Mostra',
    results: 'risultati',
    brokerFeedDegraded: 'Stiamo avendo problemi a raggiungere l’infrastruttura del tuo broker.',
    brokerFeedDegradedHint:
      'Mostriamo i tuoi registri di trading salvati; posizioni e profitti in tempo reale potrebbero essere ritardati, e i nuovi trade potrebbero non essere copiati fino al ripristino.',
    cookieConsent: {
      ...en.common.cookieConsent,
      message: 'Utilizziamo i cookie per migliorare l’esperienza utente.',
      policyLink: 'Informativa sui cookie',
      accept: 'Accetta i cookie',
      dismiss: 'Chiudi',
    },
  },

  nav: {
    ...en.nav,
    sections: {
      ...en.nav.sections,
      general: 'GENERALE',
      copy: 'COPIA',
      signals: 'SEGNALI',
      discover: 'SCOPRI',
      tradingTools: 'STRUMENTI DI TRADING',
      feedback: 'FEEDBACK',
      growth: 'CRESCITA E MONETIZZAZIONE',
      membership: 'ABBONAMENTO',
      help: 'AIUTO',
    },
    items: {
      ...en.nav.items,
      dashboard: 'Dashboard',
      configuration: 'Configurazioni',
      brokers: 'Configurazione account',
      mirrorTrading: 'Account specchio',
      socialTrading: 'Social Trading',
      trades: 'Trade dell’account',
      management: 'Processo del copiatore',
      channels: 'Segnali',
      popularChannels: 'Canali popolari',
      backtest: 'Backtest',
      copierLogs: 'Log del copiatore',
      signalHistory: 'Gestisci i trade',
      reportedTrades: 'Trade segnalati',
      updates: 'Aggiornamenti',
      marketNews: 'Notizie di mercato',
      economicCalendar: 'Calendario economico',
      performance: 'Prestazioni',
      contactSupport: 'Contatta l’assistenza',
      featureRequest: 'Richiesta di funzionalità',
      partnerWithUs: 'Diventa nostro partner',
      affiliateProgram: 'Programma affiliati',
      billing: 'Fatturazione',
      subscriptions: 'Abbonamenti',
    },
    signOut: 'Esci',
    search: 'Cerca',
    openMenu: 'Apri menu',
    closeMenu: 'Chiudi menu',
    expandSidebar: 'Espandi barra laterale',
    collapseSidebar: 'Comprimi barra laterale',
    openTradesActive: 'Trade aperti attivi',
    openTradesCount: '{count} aperti',
    highImpactNewsToday: 'Notizie ad alto impatto oggi',
    planFree: 'Gratuito',
    planCardLabel: 'Piano',
    planAccountsUsed: '{used} di {limit} account usati',
    planManage: 'Gestisci fatturazione',
    settings: 'Impostazioni',
    help: 'Aiuto',
  },

  pricing: {
    ...en.pricing,
    billing: {
      ...en.pricing.billing,
      title: 'Abbonamento',
      subtitle:
        'Scegli Basic o Advanced — oppure parla con noi del piano Custom. Copia da Telegram, TradingView, WhatsApp e Discord.',
      membershipEyebrow: 'Abbonamento',
      membershipTitle: 'Abbonamento',
      membershipSubtitle:
        'Visualizza lo stato, gestisci rinnovi, metodi di pagamento e fatture.',
      customerId: 'ID cliente',
      credit: 'Credito',
      purchaseSubscription: 'Acquista abbonamento',
      memberSince: 'Membro dal',
      nextRenewal: 'Prossimo rinnovo',
      currentPlan: 'Piano attuale',
      billed: 'Addebitato',
      noActiveSubscription: 'Nessun abbonamento attivo',
      noSubscriptionHeaderBanner: 'Non hai alcun abbonamento attivo.',
      freePlan: 'Gratuito',
      freePlanSummary:
        'Solo visualizzazione — abbonati per collegare i broker e copiare i segnali',
      basicPlanSummary: '1 broker · 5 canali · 3 TP · Modalità di trade singola',
      advancedPlanSummary:
        '5+ account · Canali illimitati · Strumenti avanzati del copiatore',
      adminPlanSummary:
        'Account illimitati · Canali illimitati · Strumenti avanzati del copiatore',
      adminPlanSummaryUntil:
        'Accesso admin fino al {date} · Account illimitati · Canali illimitati · Strumenti avanzati del copiatore',
      statusLine: 'Stato: {status}',
      invoices: 'Fatture',
      invoicesHint: 'Scarica le copie PDF delle tue fatture passate.',
      invoiceNumber: 'Fattura n.',
      period: 'Periodo',
      date: 'Data',
      amount: 'Importo',
      status: 'Stato',
      downloadInvoice: 'Scarica fattura',
      invoiceStatusPaid: 'Pagata',
      invoiceStatusDraft: 'Bozza',
      invoiceStatusOpen: 'Aperta',
      invoiceStatusVoid: 'Annullata',
      invoiceStatusUncollectible: 'Irrecuperabile',
      noInvoices: 'Nessuna fattura ancora.',
      loadInvoicesFailed: 'Impossibile caricare lo storico della fatturazione.',
      subscriptionPlans: 'Piani di abbonamento',
      subscriptionPlansIntro:
        'Confronta i piani e i cicli di fatturazione — la fatturazione annuale risparmia il 20%.',
      pricingTablePlans: 'Piani',
      pricingTableIncludes: 'Include',
      pricingTableMonthly: 'Mensile',
      pricingTableAnnual: 'Annuale',
      pricingTableAction: 'Azione',
      pricingTableCategory: 'Copiatore',
      pricingTableBestValue: 'Miglior rapporto qualità-prezzo',
      pricingTablePurchase: 'Acquista',
      pricingTableSave: 'Risparmia {amount}',
      pricingTableAdvancedIncludes:
        '{count} account demo/reali (espandibili fino a 100)',
      pricingTableHint:
        'Clicca su un prezzo mensile o annuale per scegliere il ciclo di fatturazione, poi Acquista.',
      back: 'Indietro',
      next: 'Avanti',
      nextBilling: 'Prossima data di addebito',
      extraAccounts: 'Account extra',
      extraAccountsSummary:
        '{included} inclusi + {extra} extra = {total} account in totale',
      manageBilling: 'Gestisci fatturazione',
      cancelSubscription: 'Annulla abbonamento',
      cancelSubscriptionHint:
        'Apre il portale di fatturazione dove puoi annullare. Il piano resta attivo fino alla fine del ciclo di fatturazione corrente.',
      cancelSubscriptionFailed:
        'Impossibile aprire il portale di fatturazione. Riprova.',
      noPlan: 'Nessun abbonamento attivo',
      statusActive: 'Attivo',
      statusTrialing: 'Prova',
      statusCanceled: 'Annullato',
      statusPastDue: 'Scaduto',
      trialEnds: 'La prova termina il',
      choosePlan: 'Inizia la tua prova gratuita di 5 giorni',

      redeemTitle: 'Riscatta codice di recupero',
      redeemSubtitle: 'Inserisci il tuo codice di recupero qui sotto.',
      redeemButton: 'Riscatta codice',
      redeemCodeLabel: 'Codice di recupero',
      redeemCodePlaceholder: 'es. XK9M2P7Q',
      redeemSuccess: 'Codice riscattato — ora hai {days} giorni di accesso alla copia.',
      redeemAlreadyUsed: 'Questo codice di recupero è già stato usato.',
      redeemExpired: 'Questo codice di recupero è scaduto.',
      redeemError: 'Impossibile riscattare il codice di recupero.',

      copySubscriptionsTitle: 'Abbonamenti di copia dei provider',
      copySubscriptionsHint:
        'Gestisci gli abbonamenti a pagamento ai provider. Puoi ricominciare a copiare in qualsiasi momento mentre il periodo è attivo, anche dopo aver smesso di copiare.',
      copySubscriptionsEmpty: 'Nessun abbonamento di copia dei provider ancora.',
      copySubscriptionsRefresh: 'Aggiorna',
      copySubscriptionsLoadFailed:
        'Impossibile caricare gli abbonamenti di copia dei provider.',
      copySubscriptionsSignIn:
        'Accedi di nuovo per gestire la fatturazione delle copie.',
      copySubscriptionsPortalFailed:
        'Impossibile aprire il portale di fatturazione delle copie.',
      copyManage: 'Gestisci',
      copyStatusActive: 'Attivo',
      copyStatusPastDue: 'Scaduto',
      copyStatusCanceled: 'Annullato',
      copyStatusIncomplete: 'Incompleto',
      copyCancelsAtPeriodEnd: 'si annulla a fine periodo',
      copyPeriodEnds: 'Il periodo termina il {date}',
      copyEntitlementNote:
        'Smettere di copiare non annulla questo abbonamento. Puoi riprendere a copiare fino alla scadenza.',
      tabSubscription: 'Abbonamento',
      tabPaymentMethods: 'Metodi di pagamento',
      tabReceipts: 'Ricevute',
      planPaymentsEyebrow: 'Abbonamento',
      checkoutBadge: 'Checkout',
      subscribeTo: 'Abbonati a',
      howToPay: 'Come vorresti pagare?',
      payCardTitle: 'Carta',
      payCardDescription:
        'Si rinnova a ogni ciclo di fatturazione. Annulla quando vuoi.',
      payCardFooter: 'Visa, Mastercard e Amex tramite Stripe',
      payCryptoTitle: 'Cripto',
      payCryptoDescription:
        'USDC e altre cripto popolari. Annulla quando vuoi.',
      payCryptoFooter:
        'Basic include +$1 affinché le reti popolari raggiungano i minimi di NOWPayments. Rinnovato manualmente.',
      addPromoCode: 'Aggiungi codice promozionale',
      promoPlaceholder: 'Inserisci il codice sconto',
      applyPromo: 'Applica',
      continueCheckout: 'Vai al checkout',
      backToPlans: 'Torna ai piani',
      paymentMethodsTitle: 'Metodi di pagamento',
      paymentMethodsSubtitle:
        'Carte salvate per rinnovi e acquisti futuri.',
      paymentMethodsEmptyTitle: 'Nessuna carta salvata',
      paymentMethodsEmptyHint:
        'Una carta viene salvata quando paghi con essa, oppure aggiungine una qui.',
      paymentMethodsAddCard: 'Aggiungi carta',
      paymentMethodsAddCardHint: 'Salvata in modo sicuro da Stripe',
      paymentMethodsSaveCard: 'Salva carta',
      paymentMethodsRemove: 'Rimuovi',
      paymentMethodsFooter:
        'Le carte vengono salvate quando paghi con esse e possono essere gestite qui.',
    },
  },
})
