import { describe, expect, it } from 'vitest'
import {
  classifyConfigureSignalLabel,
  scrubSignalFormatBody,
  signalFormatFingerprint,
} from './configureWithAiSignalFormat'

describe('configureWithAiSignalFormat', () => {
  it('scrubs prices so the same layout shares a body shape', () => {
    const a = scrubSignalFormatBody('Gold buy now 4059.6 - 4055\nSL: 4051\nTP: 4062\nTP: 4064')
    const b = scrubSignalFormatBody('Gold buy now 4102.1 - 4098\nSL: 4090\nTP: 4110\nTP: 4115')
    expect(a).toBe(b)
  })

  it('fingerprints duplicate priced entries as one format', () => {
    const a = signalFormatFingerprint({
      raw_message: 'BUY XAUUSD @ 2650 SL 2640 TP 2660 TP 2670',
      label: 'entry',
      intent: { kind: 'entry', side: 'BUY', entry: [2650], sl: 2640, tp: [2660, 2670] },
    })
    const b = signalFormatFingerprint({
      raw_message: 'BUY XAUUSD @ 2701 SL 2690 TP 2710 TP 2720',
      label: 'entry',
      intent: { kind: 'entry', side: 'BUY', entry: [2701], sl: 2690, tp: [2710, 2720] },
    })
    expect(a).toBe(b)
  })

  it('keeps bare teaser distinct from priced multi-TP params', () => {
    const teaser = signalFormatFingerprint({
      raw_message: 'Gold buy now',
      label: 'entry',
      intent: { kind: 'entry', side: 'BUY', entry: [], sl: null, tp: [] },
    })
    const params = signalFormatFingerprint({
      raw_message: 'Gold buy now 4059.6 - 4055\nSL: 4051\nTP: 4062\nTP: 4064\nTP: open',
      label: 'entry',
      intent: {
        kind: 'entry',
        side: 'BUY',
        entry: [4059.6, 4055],
        sl: 4051,
        tp: [4062, 4064],
        open_tp: true,
      },
    })
    expect(teaser).not.toBe(params)
  })

  it('labels modify and close as update, not entry', () => {
    expect(classifyConfigureSignalLabel('GOLD MOVE SL TO 3875')).toBe('update')
    expect(classifyConfigureSignalLabel('GOLD MOVE TP1 TO 3886')).toBe('update')
    expect(classifyConfigureSignalLabel('GOLD CLOSE HALF SELL @ 3881.5')).toBe('update')
    expect(classifyConfigureSignalLabel('Gold buy now')).toBe('entry')
  })
})
