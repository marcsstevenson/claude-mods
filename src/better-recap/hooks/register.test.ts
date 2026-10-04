import { describe, expect, test } from 'claude-code/testing'

import { formatHeader, parseHeader, prettyModel, shortTokens, titleFromTranscript } from './register'

const USAGE = {
  startedAt: 0,
  context: { tokens: 124_000, window: 200_000, percent: 62 },
  rateLimits: [],
}

describe('helpers', () => {
  test('model ids read as names', () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)')
    expect(prettyModel('Opus 5.5')).toBe('Opus 5.5')
  })

  test('token counts shorten', () => {
    expect(shortTokens(950)).toBe('950')
    expect(shortTokens(124_400)).toBe('124k')
    expect(shortTokens(1_000_000)).toBe('1M')
  })

  test('a header parses back, a title holding the separator included', () => {
    const line = formatHeader({ title: 'Fix · auth', model: 'Opus 5.5', percent: 62, tokens: 124_000, window: 200_000 })
    expect(line).toBe('◆ Fix · auth · Opus 5.5 · 62% context (124k/200k)')
    expect(parseHeader(line)).toEqual({
      title: 'Fix · auth',
      model: 'Opus 5.5',
      context: '62% context (124k/200k)',
      percent: 62,
    })
    expect(parseHeader('just a recap')).toBe(null)
  })

  test('the branch closes the header and parses back; a header without one still parses', () => {
    const line = formatHeader({ title: 'T', model: 'Opus 5.5', percent: 5, tokens: 50_000, window: 1_000_000, branch: 'main' })
    expect(line).toBe('◆ T · Opus 5.5 · 5% context (50k/1M) · branch main')
    expect(parseHeader(line)?.branch).toBe('main')
    expect(parseHeader(line)?.context).toBe('5% context (50k/1M)')
    expect(parseHeader('◆ T · Opus 5.5 · 5% context (50k/1M)')?.branch).toBe(undefined)
  })

  test('a /rename beats the generated title', () => {
    const jsonl = [
      '{"type":"ai-title","aiTitle":"Generated","sessionId":"s"}',
      '{"type":"user","message":{}}',
      '{"type":"custom-title","customTitle":"My \\"named\\" session","sessionId":"s"}',
    ].join('\n')
    expect(titleFromTranscript(jsonl)).toBe('My "named" session')
    expect(titleFromTranscript('{"type":"ai-title","aiTitle":"Only AI"}')).toBe('Only AI')
    expect(titleFromTranscript('')).toBe(null)
  })
})

test('the /recap row draws as a card with a context bar', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'better-recap',
      surface,
      component: 'CommandOutput',
      props: {
        command: 'recap',
        args: '',
        isErrored: false,
        text: '◆ Recap mod · Opus 5.5 · 62% context (124k/200k) · branch feature/x\n\n**Goal:** ship it',
      },
    })
    expect((await ui.find({ type: 'Text', text: 'Recap mod' }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: '██████░░░░' }))?.props.color).toBe('yellow')
    expect(await ui.find({ type: 'Markdown', text: /Goal/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: 'feature/x' }))?.props.color).toBe('cyan')
    await ui.unmount()
  }
})

test('the away recap line gains the session facts', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('classic.SessionStart', () => ({}))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // The kit has no store beneath session.append: capture the row the plugin hands down.
  let handedDown: unknown
  on('session.append', ($, e, next) => {
    handedDown = e.message.content[0]
    return next(e)
  })
  await $.classic.SessionStart({ source: 'startup', session_title: 'Recap mod' })

  await $.session.append({
    message: { type: 'system', name: 'away_summary', content: [{ type: 'text', text: 'Built the mod.' }] },
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'row-1',
  }).catch(() => undefined)
  expect(handedDown).toEqual({
    type: 'text',
    text: '[Recap mod · Opus 5.5 · 62% context (124k/200k) · branch main] Built the mod.',
  })
})

test('/recap raised by something other than the person goes to the built-in', async ($, on) => {
  on('command.run', () => ({ text: 'built-in' }))
  const ran = await $.command.run({
    command: 'recap',
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran.text).toBe('built-in')
})
