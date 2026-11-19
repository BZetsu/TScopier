import { describe, expect, it } from 'vitest'
import { collectList, isNumbered, normalizeChatMarkdown } from './assistantMarkdown'

const steps = 'To add channels:\n\n1. Go to Signals.\n2. Press Connect.\n3. Follow the prompts.'

describe('normalizeChatMarkdown', () => {
  it('keeps numbered steps in one list instead of blank-line separating them', () => {
    const out = normalizeChatMarkdown(steps)
    expect(out.split('\n').filter((l) => isNumbered(l))).toHaveLength(3)
    expect(out).toContain('1. Go to Signals.\n2. Press Connect.\n3. Follow the prompts.')
  })

  it('splits steps the model squeezed onto one line', () => {
    const out = normalizeChatMarkdown('1. Open Signals. 2. Press Connect. 3. Follow the prompts.')
    expect(out.split('\n').filter((l) => isNumbered(l))).toHaveLength(3)
  })
})

describe('collectList', () => {
  it('does not restart numbering when a blank line sits between items', () => {
    const lines = ['1. one', '', '2. two', '', '3. three', '', 'Closing line.']
    const { items, next } = collectList(lines, 0, isNumbered)
    expect(items).toHaveLength(3)
    // stops on the blank line before the closing paragraph
    expect(next).toBe(5)
  })

  it('stops at a non-list line', () => {
    const lines = ['1. one', '2. two', 'Plain text.']
    const { items, next } = collectList(lines, 0, isNumbered)
    expect(items).toHaveLength(2)
    expect(next).toBe(2)
  })
})
