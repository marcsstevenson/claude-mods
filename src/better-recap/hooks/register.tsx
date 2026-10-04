import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RecapSession } from '../types'

const session = atom({ plugin: 'better-recap', key: 'session' } as const, {
  title: null,
  transcriptPath: null,
} as RecapSession)

const MARK = '◆ '
const SEP = ' · '
const BRANCH = 'branch '
const BAR_CELLS = 10

const RECAP_PROMPT = `Write a recap of this session for someone coming back to it after a break.
Reply in markdown with exactly these four parts and nothing else (no preamble, no closing line):

**Goal:** one line on what this session is trying to achieve.
**Done:** up to 4 terse bullets of what has actually been completed.
**Open:** up to 3 terse bullets of what is in progress, blocked or undecided (or "nothing").
**Next:** one line, the single most useful next step.

Stay under 120 words. Only state what the conversation shows; do not invent progress.`

type Header = {
  title: string
  model: string
  percent: number | undefined
  tokens: number | undefined
  window: number
  branch?: string | null
}

// 'claude-opus-5-5[1m]' -> 'Opus 5.5 (1M)'; anything already readable is kept.
export function prettyModel(id: string): string {
  const isLong = /\[1m\]$/i.test(id)
  const bare = id.replace(/\[1m\]$/i, '')
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(bare)
  if (match === null) return id
  const [, family = '', major, minor] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const version = minor === undefined ? major : `${major}.${minor}`
  return `${name} ${version}${isLong ? ' (1M)' : ''}`
}

export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function formatHeader(h: Header): string {
  const context =
    h.percent === undefined
      ? 'context n/a'
      : `${h.percent}% context (${shortTokens(h.tokens ?? 0)}/${shortTokens(h.window)})`
  const parts = [h.title, h.model, context]
  if (h.branch) parts.push(BRANCH + h.branch)
  return MARK + parts.join(SEP)
}

// The inverse of formatHeader, splitting from the right so a title holding ' · ' survives.
// The branch is optional: headers written outside a repo, or before it was added, have none.
export function parseHeader(
  line: string,
): { title: string; model: string; context: string; percent?: number; branch?: string } | null {
  if (!line.startsWith(MARK)) return null
  const parts = line.slice(MARK.length).split(SEP)
  const last = parts[parts.length - 1] ?? ''
  const branch = last.startsWith(BRANCH) ? parts.pop()!.slice(BRANCH.length) : undefined
  if (parts.length < 3) return null
  const context = parts.pop()!
  const model = parts.pop()!
  const pct = /^(\d+)% context/.exec(context)
  return { title: parts.join(SEP), model, context, percent: pct ? Number(pct[1]) : undefined, branch }
}

// The newest /rename (custom-title) wins over the generated ai-title.
export function titleFromTranscript(jsonl: string): string | null {
  let custom: string | null = null
  let generated: string | null = null
  for (const line of jsonl.split('\n')) {
    if (line.includes('"type":"custom-title"')) {
      const m = /"customTitle":"((?:[^"\\]|\\.)*)"/.exec(line)
      if (m) custom = JSON.parse(`"${m[1]}"`)
    } else if (line.includes('"type":"ai-title"')) {
      const m = /"aiTitle":"((?:[^"\\]|\\.)*)"/.exec(line)
      if (m) generated = JSON.parse(`"${m[1]}"`)
    }
  }
  return custom ?? generated
}

async function sessionTitle($: EngineInterface): Promise<string> {
  const known = await read($, session)
  if (known.transcriptPath !== null) {
    try {
      const fromFile = titleFromTranscript(await $.fs.read(known.transcriptPath))
      if (fromFile) return fromFile
    } catch {
      // Over the 4 MiB read cap, or not written yet: fall back to what the hooks reported.
    }
  }
  return known.title ?? 'Untitled session'
}

// The checked-out branch, the short commit when HEAD is detached, null outside a repo.
async function currentBranch($: EngineInterface): Promise<string | null> {
  try {
    const branch = await $.process.run(['git', 'branch', '--show-current'])
    if (branch.exitCode !== 0) return null
    if (branch.stdout.trim() !== '') return branch.stdout.trim()
    const head = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'])
    return head.exitCode === 0 ? `detached@${head.stdout.trim()}` : null
  } catch {
    return null
  }
}

async function header($: EngineInterface): Promise<string> {
  const [title, model, usage, branch] = await Promise.all([
    sessionTitle($),
    $.session.model(),
    $.session.usage(),
    currentBranch($),
  ])
  return formatHeader({
    title,
    model: prettyModel(model),
    percent: usage.context.percent,
    tokens: usage.context.tokens,
    window: usage.context.window,
    branch,
  })
}

function contextColor(percent: number): string {
  if (percent >= 80) return 'red'
  if (percent >= 50) return 'yellow'
  return 'green'
}

async function remember($: EngineInterface, e: { session_title?: string; transcript_path: string }) {
  await update($, session, prev => ({
    title: e.session_title ?? prev.title,
    transcriptPath: e.transcript_path,
  }))
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    await remember($, e)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await remember($, e)
    return next(e)
  })

  // /recap: a structured recap from a fork of the session, under the header.
  on('command.run', { command: 'recap' }, async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson) return next(e)

    const [top, reply] = await Promise.all([header($), $.model.fork({ prompt: RECAP_PROMPT })])
    if (reply.isAnswered) return { text: `${top}\n\n${reply.text.trim()}` }

    // Nothing to fork yet, or the API failed: keep the built-in one-liner.
    const builtIn = await next(e)
    if (builtIn.text === undefined) return builtIn
    return { ...builtIn, text: `${top}\n\n${builtIn.text}` }
  })

  // The automatic "recap:" line shown after being away: prefix the same facts.
  on('session.append', { message: { type: 'system', name: 'away_summary' } }, async ($, e, next) => {
    const top = (await header($)).slice(MARK.length)
    const content = e.message.content.map((block, i) =>
      i === 0 && block.type === 'text' ? { ...block, text: `[${top}] ${block.text}` } : block,
    )
    return next({ ...e, message: { ...e.message, content } })
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'recap' } }, ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const [first, ...rest] = e.props.text.split('\n')
    const top = parseHeader(first ?? '')
    if (top === null) return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    const body = rest.join('\n').trim()
    const filled = top.percent === undefined ? 0 : Math.round((top.percent / 100) * BAR_CELLS)

    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold>{top.title}</Text>
          <Text dimColor>·</Text>
          <Text>{top.model}</Text>
          <Text dimColor>·</Text>
          {top.percent !== undefined && (
            <Text color={contextColor(top.percent)}>
              {'█'.repeat(filled)}
              {'░'.repeat(BAR_CELLS - filled)}
            </Text>
          )}
          <Text dimColor>{top.context}</Text>
          {top.branch !== undefined && <Text dimColor>·</Text>}
          {top.branch !== undefined && <Text dimColor>branch</Text>}
          {top.branch !== undefined && <Text color="cyan">{top.branch}</Text>}
        </Box>
        {body !== '' && (
          <Box marginTop={1}>
            <Markdown text={body.slice(0, 10000)} />
          </Box>
        )}
      </Box>
    )
  })
}
