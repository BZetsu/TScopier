import type { LandingTranslations } from './types'

export const landingFr: LandingTranslations = {
  nav: {
    product: 'Produit',
    features: 'Fonctionnalités',
    pricing: 'Tarifs',
    signIn: 'Se connecter',
    getStarted: 'Commencer',
    menuOpen: 'Ouvrir le menu',
    menuClose: 'Fermer le menu',
  },
  hero: {
    trustedBy: 'Plébiscité par plus de 30 000 traders dans 156 pays',
    avatarAlts: ['Avatar de trader', 'Avatar de trader', 'Avatar de trader'],
    headline: 'Copieur de signaux Telegram ultra-rapide',
    headlineAccent: 'Propulsé par l’IA.',
    subheadline:
      'Connectez votre compte MT4/MT5, choisissez vos canaux de signaux et laissez TSCopier exécuter entrées, couches et gestion — avec un contrôle total du risque et des filtres.',
    primaryCta: 'Commencer gratuitement',
    secondaryCta: 'Se connecter',
    imageAlt:
      'Tableau de bord TSCopier avec solde, profit du jour, résultats des trades et graphiques de croissance',
    previewUrl: 'app.tscopier.ai/dashboard',
  },
  whyChoose: {
    title: 'Pourquoi choisir TSCopier ?',
    subtitle:
      'Trois raisons pour lesquelles les traders quittent la copie manuelle et les EA locaux pour un copieur cloud conçu pour la vitesse.',
    items: [
      {
        title: 'Exécution rapide',
        description:
          'Les signaux sont analysés et envoyés à votre broker en quelques secondes, pas en minutes. Notre worker cloud utilise un pipeline à faible latence pour que entrées, modifications et clôtures Telegram atteignent MT4/MT5 tant que le prix reste pertinent—avec des journaux copieur pour chaque action.',
      },
      {
        title: 'Aucun téléchargement',
        description:
          'TSCopier est 100 % cloud. Pas d’EA à installer, pas de VPS à louer ni de scripts terminal à mettre à jour après chaque build. Connectez-vous depuis le navigateur, liez votre compte et gérez vos canaux depuis un seul tableau de bord—vos réglages se synchronisent automatiquement.',
      },
      {
        title: 'Configuration en 2 minutes',
        description:
          'Créez votre compte, reliez Telegram et connectez MT4 ou MT5 en quelques étapes guidées. La plupart des traders copient leur premier canal en environ deux minutes—sans branchements complexes, erreurs de compilation ni VPS à configurer le week-end.',
      },
    ],
  },
  features: {
    title: 'Conçu pour le copy trading sérieux',
    subtitle: 'Tout ce qu’il faut pour automatiser Telegram sans perdre le contrôle.',
    items: [
      {
        title: 'MT4 et MT5',
        description: 'Liez des comptes démo ou réels et copiez sur votre broker actuel.',
      },
      {
        title: 'Multi-trades et couches',
        description: 'Répartissez les lots sur les TPs, empilez les pendings en range et fermez les pires entrées en premier.',
      },
      {
        title: 'Backtest de signaux',
        description: 'Rejouez l’historique du canal avec vos réglages manuels avant le live.',
      },
      {
        title: 'Filtres par canal',
        description: 'Autorisez ou ignorez clôture, break-even, ajustement SL/TP et autres instructions par canal.',
      },
      {
        title: 'Actualités et calendrier',
        description: 'Fil d’actualités et calendrier économique avec blackout news optionnel.',
      },
      {
        title: 'Journaux du copieur',
        description: 'Logs transparents pour voir exactement ce que le worker a fait et quand.',
      },
    ],
  },
  steps: {
    title: 'Comment ça marche',
    subtitle: 'Du canal Telegram au broker en trois étapes.',
    items: [
      {
        title: 'Connecter Telegram',
        description: 'Liez les canaux de confiance. Seuls ceux cochés alimentent votre broker.',
      },
      {
        title: 'Configurer le broker',
        description: 'Lot, TPs, couches, filtres et auto-gestion par compte.',
      },
      {
        title: 'Copier les signaux',
        description: 'TSCopier parse, planifie et envoie les ordres — vous supervisez depuis le tableau de bord.',
      },
    ],
  },
  reviews: {
    title: 'Approuvé par des traders',
    trustpilotLabel: 'Trustpilot',
    items: [
      {
        quote:
          'TSCopier a réduit mon copiage manuel presque à zéro. Les signaux arrivent sur MT5 en quelques secondes.',
        author: 'Rob Flemming',
      },
      {
        quote:
          'Tableau de bord clair, analyse fiable et logs faciles à déboguer.',
        author: 'Sarah Mitchell',
      },
      {
        quote:
          'Couches en range et fermeture des pires entrées — je copie les signaux l’esprit tranquille.',
        author: 'Eloise Laurent',
      },
    ],
  },
  pricing: {
    title: 'Tarifs simples',
    subtitle: 'Commencez avec Basic ou débloquez les stratégies avancées avec Advanced.',
    perMonth: '/mois',
    popular: 'Le plus populaire',
    viewPlans: 'Voir tous les forfaits',
    basic: {
      name: 'Basic',
      description: 'Un compte, mode single-trade, backtests et filtres essentiels.',
      priceLabel: '9,99 $',
      cta: 'Commencer avec Basic',
    },
    advanced: {
      name: 'Advanced',
      description: 'Multi-comptes, couches en range, auto-gestion, canaux illimités.',
      priceLabel: '39,99 $',
      cta: 'Essai 10 jours',
    },
  },
  footer: {
    copyright: '© {year} Tartarix Inc.',
    docs: 'Documentation',
    status: 'Statut',
    openApp: 'Ouvrir l’app',
  },
}
