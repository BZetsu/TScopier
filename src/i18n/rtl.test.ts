import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  isRtlLocale,
  localeDirection,
  type Locale,
} from './types'

test('isRtlLocale: Arabic is RTL', () => {
  assert.equal(isRtlLocale('ar'), true)
})

test('isRtlLocale: LTR locales return false', () => {
  const ltr: Locale[] = ['en', 'es', 'fr', 'pl', 'ru', 'sv', 'nl', 'ja']
  for (const code of ltr) {
    assert.equal(isRtlLocale(code), false)
  }
})

test('localeDirection: maps Arabic to rtl and others to ltr', () => {
  assert.equal(localeDirection('ar'), 'rtl')
  assert.equal(localeDirection('en'), 'ltr')
  assert.equal(localeDirection('ja'), 'ltr')
})
