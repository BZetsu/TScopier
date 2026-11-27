import type { SettingsBundleTranslations } from './types'

export const settingsDe: SettingsBundleTranslations = {
  settings: {
    title: 'Einstellungen',
    subtitle: 'Verwalten Sie Ihr Profil, Ihre Einstellungen und die Sicherheit Ihres Kontos.',
    loadError: 'Die Einstellungen konnten nicht geladen werden.',
    saveError: 'Die Änderungen konnten nicht gespeichert werden.',
    saved: 'Änderungen gespeichert.',
    emailHint:
      'Die E-Mail-Adresse wird von Ihrem Anmeldeanbieter verwaltet und kann hier nicht geändert werden.',
    countryHint: 'Wird anhand Ihres Standorts festgelegt. Kann nicht geändert werden.',
    countryDetecting: 'Ihr Standort wird ermittelt…',
    passwordHint: 'Mindestens 8 Zeichen.',
    passwordTooShort: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
    passwordMismatch: 'Die Passwörter stimmen nicht überein.',
    passwordUpdated: 'Passwort erfolgreich aktualisiert.',
    passwordError: 'Das Passwort konnte nicht aktualisiert werden.',
    sections: {
      personal: 'Persönliche Daten',
      general: 'Allgemeine Einstellungen',
      security: 'Sicherheit',
    },
    personal: {
      title: 'Persönliche Daten',
      description: 'Ihre Kontaktdaten und wie Sie in UniCopier erscheinen.',
    },
    photo: {
      change: 'Foto ändern',
      hint: 'JPG, PNG oder WebP. Bis zu 12 MB.',
      tooLarge: 'Das Foto darf höchstens 12 MB groß sein.',
      invalidType: 'Verwenden Sie ein Bild im Format JPG, PNG oder WebP.',
      uploadError: 'Ihr Profilfoto konnte nicht aktualisiert werden.',
      cropTitle: 'Foto zuschneiden',
      zoom: 'Zoom',
    },
    general: {
      title: 'Allgemeine Einstellungen',
      description: 'Standardwerte für Kontostände, Berichte und Zeitstempel.',
    },
    security: {
      title: 'Sicherheit',
      description: 'Aktualisieren Sie Ihr Passwort, um Ihr Konto zu schützen.',
      updatePassword: 'Passwort aktualisieren',
    },
    fields: {
      firstName: 'Vorname',
      lastName: 'Nachname',
      username: 'Benutzername',
      email: 'E-Mail',
      country: 'Land',
      city: 'Stadt',
      mobile: 'Mobilnummer',
      address: 'Adresse',
      baseCurrency: 'Basiswährung',
      timezone: 'Zeitzone',
      newPassword: 'Neues Passwort',
      confirmPassword: 'Passwort bestätigen',
      notificationSound: 'Benachrichtigungston für Trades',
      notificationSoundDescription:
        'Ton abspielen, wenn ein Trade ausgeführt, geändert oder geschlossen wird.',
      notificationEmail: 'E-Mail-Benachrichtigungen',
      notificationEmailDescription:
        'Eine E-Mail senden, wenn ein Signal Ihre Prüfung benötigt.',
    },
    placeholders: {
      address: 'Straße, Hausnummer, PLZ…',
      selectCountry: 'Land auswählen',
      selectTimezone: 'Zeitzone auswählen',
      selectCurrency: 'Währung auswählen',
      searchCountry: 'Länder suchen…',
      searchTimezone: 'Zeitzonen suchen…',
      searchCurrency: 'Währungen suchen…',
      noMatches: 'Keine Treffer',
    },
  },
}
