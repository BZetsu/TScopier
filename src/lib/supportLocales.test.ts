import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  normalizeSupportChatLocale,
  resolveSupportChatLocale,
  SUPPORT_CHAT_LOCALES,
} from './supportLocales'

test('support chat accepts German and regional German locale tags', () => {
  assert.equal(SUPPORT_CHAT_LOCALES.includes('de'), true)
  assert.equal(normalizeSupportChatLocale('de'), 'de')
  assert.equal(normalizeSupportChatLocale('de-DE'), 'de')
  assert.equal(normalizeSupportChatLocale('DE_de'), 'de')
})

test('support chat accepts Turkish and regional Turkish locale tags', () => {
  assert.equal(SUPPORT_CHAT_LOCALES.includes('tr'), true)
  assert.equal(normalizeSupportChatLocale('tr'), 'tr')
  assert.equal(normalizeSupportChatLocale('tr-TR'), 'tr')
  assert.equal(normalizeSupportChatLocale('TR_tr'), 'tr')
})

test('an unsupported locale safely falls back to English', () => {
  assert.equal(normalizeSupportChatLocale('it-IT'), 'en')
  assert.equal(
    resolveSupportChatLocale({ uiLocale: 'en', browserLocale: 'it-IT' }),
    'en',
  )
})

test('German browser language supports German chat while the product UI remains English', () => {
  assert.equal(
    resolveSupportChatLocale({ uiLocale: 'en', browserLocale: 'de-DE' }),
    'de',
  )
})

test('Turkish browser language supports Turkish chat while the product UI remains English', () => {
  assert.equal(
    resolveSupportChatLocale({ uiLocale: 'en', browserLocale: 'tr-TR' }),
    'tr',
  )
})

test('an explicit stored product language wins over the browser language', () => {
  assert.equal(
    resolveSupportChatLocale({
      uiLocale: 'en',
      browserLocale: 'de-DE',
      storedLocale: 'en',
    }),
    'en',
  )
})

test('an unsupported browser language keeps the active supported product language', () => {
  assert.equal(
    resolveSupportChatLocale({ uiLocale: 'es', browserLocale: 'it-IT' }),
    'es',
  )
})
