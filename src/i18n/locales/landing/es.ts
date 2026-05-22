import type { LandingTranslations } from './types'

export const landingEs: LandingTranslations = {
  nav: {
    product: 'Producto',
    features: 'Funciones',
    pricing: 'Precios',
    signIn: 'Iniciar sesión',
    getStarted: 'Empezar',
    menuOpen: 'Abrir menú',
    menuClose: 'Cerrar menú',
  },
  hero: {
    trustedBy: 'Con la confianza de más de 30.000 traders de 156 países',
    avatarAlts: ['Avatar de trader', 'Avatar de trader', 'Avatar de trader'],
    headline: 'Copiador de señales de Telegram ultrarrápido',
    headlineAccent: 'Impulsado por IA.',
    subheadline:
      'Conecta tu cuenta MT4/MT5, elige canales de señales y deja que TSCopier ejecute entradas, capas y gestión — con control total del riesgo y filtros.',
    primaryCta: 'Empezar gratis',
    secondaryCta: 'Iniciar sesión',
    imageAlt:
      'Panel de TSCopier con saldo, beneficio diario, resultados de operaciones y gráficos de crecimiento',
    previewUrl: 'app.tscopier.ai/dashboard',
  },
  whyChoose: {
    title: '¿Por qué elegir TSCopier?',
    subtitle:
      'Tres razones por las que los traders dejan la copia manual y los EA locales por un copiador en la nube pensado para la velocidad.',
    items: [
      {
        title: 'Ejecución rápida',
        description:
          'Las señales se analizan y envían a tu broker en segundos, no en minutos. Nuestro worker en la nube usa un pipeline de baja latencia para que entradas, modificaciones y cierres de Telegram lleguen a MT4/MT5 con precio aún relevante—y los logs del copiador muestran cuándo se ejecutó cada acción.',
      },
      {
        title: 'Sin descargas',
        description:
          'TSCopier es 100 % en la nube. Sin EA que instalar, sin VPS que alquilar ni scripts del terminal que actualizar tras cada build. Inicia sesión desde el navegador, conecta tu cuenta y gestiona canales desde un solo panel—tu configuración se sincroniza sola.',
      },
      {
        title: 'Configuración en 2 minutos',
        description:
          'Crea tu cuenta, enlaza Telegram y conecta MT4 o MT5 con pasos guiados. La mayoría de traders copia su primer canal en unos dos minutos—sin expertos en cableado, errores de compilación ni montar un VPS el fin de semana.',
      },
    ],
  },
  features: {
    title: 'Hecho para copiar señales en serio',
    subtitle: 'Todo lo que necesitas para automatizar Telegram sin perder el control.',
    items: [
      {
        title: 'MT4 y MT5',
        description: 'Vincula cuentas demo o reales y copia al broker que ya usas.',
      },
      {
        title: 'Multi-trade y capas',
        description: 'Divide lotes en TPs, apila pendings en rango y cierra peores entradas primero.',
      },
      {
        title: 'Backtest de señales',
        description: 'Reproduce el historial del canal con tu configuración manual antes de ir en vivo.',
      },
      {
        title: 'Filtros por canal',
        description: 'Permite o ignora cierre, break-even, ajuste SL/TP y otras instrucciones por canal.',
      },
      {
        title: 'Noticias y calendario',
        description: 'Noticias de mercado y calendario económico con bloqueo opcional por noticias.',
      },
      {
        title: 'Logs del copiador',
        description: 'Registros transparentes para ver qué hizo el worker y cuándo.',
      },
    ],
  },
  steps: {
    title: 'Cómo funciona',
    subtitle: 'Del canal de Telegram al broker en tres pasos.',
    items: [
      {
        title: 'Conectar Telegram',
        description: 'Enlaza los canales que confías. Solo los marcados alimentan tu broker.',
      },
      {
        title: 'Configurar el broker',
        description: 'Lote, TPs, capas, filtros y auto-gestión por cuenta.',
      },
      {
        title: 'Copiar señales',
        description: 'TSCopier analiza, planifica y envía órdenes — tú supervisas desde el panel.',
      },
    ],
  },
  reviews: {
    title: 'Confianza de traders',
    trustpilotLabel: 'Trustpilot',
    items: [
      {
        quote:
          'TSCopier redujo mi copia manual casi a cero. Las señales llegan a MT5 en segundos.',
        author: 'Rob Flemming',
      },
      {
        quote:
          'Panel claro, análisis fiable y logs fáciles de depurar.',
        author: 'Sarah Mitchell',
      },
      {
        quote:
          'Capas en rango y cierre de peores entradas — copio con tranquilidad.',
        author: 'Eloise Laurent',
      },
    ],
  },
  pricing: {
    title: 'Precios simples',
    subtitle: 'Empieza con Basic o desbloquea estrategias avanzadas con Advanced.',
    perMonth: '/mes',
    popular: 'Más popular',
    viewPlans: 'Ver todos los planes',
    basic: {
      name: 'Basic',
      description: 'Una cuenta, modo single-trade, backtests y filtros básicos.',
      priceLabel: '$9.99',
      cta: 'Empezar con Basic',
    },
    advanced: {
      name: 'Advanced',
      description: 'Varias cuentas, capas en rango, auto-gestión, canales ilimitados.',
      priceLabel: '$39.99',
      cta: 'Prueba 10 días',
    },
  },
  footer: {
    copyright: '© {year} Tartarix Inc.',
    docs: 'Documentación',
    status: 'Estado',
    openApp: 'Abrir app',
  },
}
