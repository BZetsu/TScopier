import { testimonialsEs } from '../testimonials/es'
import type { AuthTranslations } from './types'

export const authEs: AuthTranslations = {
  nav: {
    signIn: 'Iniciar sesión',
    createAccount: 'Crear cuenta',
    mobileTagline: 'Un copiador fluido para cada señal de Telegram',
  },
  oauth: {
    continueWithGoogle: 'Continuar con Google',
    orDivider: 'o',
  },
  login: {
    heading: 'Inicia sesión en TSCopier',
    noAccount: '¿No tienes cuenta?',
    signUpLink: 'Regístrate',
    footerPrompt: '¿Nuevo en TSCopier?',
    footerLink: 'Crea una cuenta gratis',
    email: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    password: 'Contraseña',
    passwordPlaceholder: 'Introduce tu contraseña',
    submit: 'Iniciar sesión',
  },
  signup: {
    heading: 'Crea tu cuenta',
    hasAccount: '¿Ya tienes cuenta?',
    signInLink: 'Iniciar sesión',
    footerPrompt: '¿Ya tienes cuenta?',
    footerLink: 'Iniciar sesión',
    firstName: 'Nombre',
    firstNamePlaceholder: 'Nombre',
    lastName: 'Apellido',
    lastNamePlaceholder: 'Apellido',
    email: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    password: 'Contraseña',
    passwordPlaceholder: 'Elige una contraseña',
    confirmPassword: 'Confirmar contraseña',
    confirmPasswordPlaceholder: 'Vuelve a escribir tu contraseña',
    passwordHint: 'Al menos 6 caracteres',
    passwordTooShort: 'La contraseña debe tener al menos 6 caracteres',
    passwordMismatch: 'Las contraseñas no coinciden',
    submit: 'Crear cuenta',
    terms:
      'Al crear una cuenta, aceptas usar TSCopier de forma responsable y cumplir los términos de tu broker.',
  },
  verify: {
    heading: 'Revisa tu correo',
    subtitle: 'Acabamos de enviar un enlace de verificación a {email}.',
    resend: 'Reenviar correo',
    resent: 'Correo enviado!',
    backToLogin: 'Volver al inicio de sesión',
  },
  marketing: {
    headline: 'Un copiador fluido para cada señal de Telegram',
    trustpilotLabel: 'Trustpilot',
    reviews: testimonialsEs,
    copyright: '© {year} Tartarix Inc.',
  },
  language: {
    label: 'Idioma',
    choose: 'Elegir idioma',
  },
  theme: {
    light: 'Modo claro',
    dark: 'Modo oscuro',
    switchToLight: 'Cambiar a modo claro',
    switchToDark: 'Cambiar a modo oscuro',
  },
}
