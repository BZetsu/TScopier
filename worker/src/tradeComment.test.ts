import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildTscopierCommentPrefix,
  resolveChannelLabelForComment,
  sanitizeChannelCommentSlug,
} from './tradeComment'

test('resolveChannelLabelForComment prefers display_name', () => {
  assert.equal(resolveChannelLabelForComment('VIP Gold', 'vipgold'), 'VIP Gold')
  assert.equal(resolveChannelLabelForComment('', 'vipgold'), 'vipgold')
})

test('sanitizeChannelCommentSlug strips non-alphanumeric', () => {
  assert.equal(sanitizeChannelCommentSlug('VIP Gold Signals'), 'VIPGoldSigna')
  assert.equal(sanitizeChannelCommentSlug('@my_channel'), 'mychannel')
})

test('buildTscopierCommentPrefix embeds channel slug', () => {
  const id = '28785f02-000b-4860-a3dd-58d74f890a5d'
  assert.equal(buildTscopierCommentPrefix(id, 'GoldSignals'), 'TSCopier:GoldSignals:28785f02')
  assert.equal(buildTscopierCommentPrefix(id, null), 'TSCopier:28785f02')
})
