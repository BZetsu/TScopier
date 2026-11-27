import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { de } from './de'
import { en } from './en'
import { tr } from './tr'

/**
 * Completeness guard for the fully translated locales.
 *
 * `mergeLocaleBundle(en, …)` silently substitutes English for any key a
 * locale does not supply, and `Pick` types only enforce structure at compile
 * time — never placeholder names. These tests walk the English bundle and
 * fail if `de` or `tr` is missing a leaf key, has an extra one, changes a
 * value's shape, alters a `{placeholder}`, or — via the section reference
 * check — drops a whole top-level section from the assembly (which would
 * leave the English object in place with every key "present"). Kept-English
 * values (brands, shared trading words) are deliberately allowed.
 */

type AnyObj = Record<string, unknown>

function walk(obj: unknown, prefix: string, out: Map<string, unknown>) {
  if (Array.isArray(obj)) {
    // Arrays are recursed so element strings get placeholder checks too; the
    // length check below still guards against dropped elements.
    obj.forEach((item, index) => walk(item, `${prefix}[${index}]`, out))
    return
  }
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as AnyObj)) walk(v, prefix ? `${prefix}.${k}` : k, out)
    return
  }
  out.set(prefix, obj)
}

function placeholders(value: string): Set<string> {
  const found = new Set<string>()
  for (const match of value.matchAll(/\{(\w+)\}/g)) found.add(match[1]!)
  return found
}

function problems(bundle: unknown): string[] {
  const enMap = new Map<string, unknown>()
  const bMap = new Map<string, unknown>()
  walk(en, '', enMap)
  walk(bundle, '', bMap)
  const issues: string[] = []

  for (const [path, ev] of enMap) {
    const tv = bMap.get(path)
    if (tv === undefined) {
      issues.push(`missing key: ${path}`)
      continue
    }
    if (ev !== null && typeof ev === 'object' && !Array.isArray(ev)) {
      // walk() recurses objects, so object values only appear here if shapes
      // diverged (an object on one side, a scalar/array on the other).
      issues.push(`shape mismatch: ${path}`)
      continue
    }
    if (Array.isArray(ev) && !Array.isArray(tv)) {
      issues.push(`expected array: ${path}`)
      continue
    }
    if (typeof ev === 'string' && typeof tv === 'string') {
      const expected = placeholders(ev)
      const actual = placeholders(tv)
      const missing = [...expected].filter(name => !actual.has(name))
      const extra = [...actual].filter(name => !expected.has(name))
      if (missing.length || extra.length) {
        issues.push(`placeholders ${path}: en={${[...expected].join(',')}} locale={${[...actual].join(',')}}`)
      }
    } else if (typeof ev !== typeof tv) {
      issues.push(`type mismatch ${path}: en=${Array.isArray(ev) ? 'array' : typeof ev} locale=${Array.isArray(tv) ? 'array' : typeof tv}`)
    }
  }

  for (const path of bMap.keys()) {
    if (!enMap.has(path)) issues.push(`extra key: ${path}`)
  }
  return issues
}

/**
 * `mergeLocaleBundle` keeps `en.<section>` by reference when the assembly
 * does not override it, and the leaf walk above cannot see that (the English
 * leaves are all "present"). Reference equality exposes it: an overridden
 * section is always a freshly built object.
 */
function droppedSections(bundle: unknown): string[] {
  const enAny = en as AnyObj
  const bAny = bundle as AnyObj
  return Object.keys(enAny).filter(key => bAny[key] === enAny[key])
}

test('de supplies every English leaf key with matching placeholders', () => {
  const issues = problems(de)
  assert.deepEqual(issues, [], `German bundle incomplete:\n${issues.join('\n')}`)
  assert.deepEqual(
    droppedSections(de),
    [],
    'German assembly must override every top-level English section',
  )
})

test('tr supplies every English leaf key with matching placeholders', () => {
  const issues = problems(tr)
  assert.deepEqual(issues, [], `Turkish bundle incomplete:\n${issues.join('\n')}`)
  assert.deepEqual(
    droppedSections(tr),
    [],
    'Turkish assembly must override every top-level English section',
  )
})
