import { z } from 'zod'

/**
 * Provider abstraction. Nothing above this file knows which vendor or model is
 * in use; both are read from the environment.
 *
 * Keys are read from `process.env` at call time and never returned, so nothing
 * here can end up in a client bundle even by accident — and because they are
 * not `NEXT_PUBLIC_`-prefixed, Next.js would substitute `undefined` if a client
 * component ever did import this. `assertServer()` turns that into a loud
 * failure instead of a confusing one. (This module is not marked `server-only`
 * so that CLI scripts and tests can exercise the generation pipeline.)
 */

export type ProviderName = 'anthropic' | 'openai' | 'mock'

export type StructuredRequest<T> = {
  system: string
  prompt: string
  schema: z.ZodType<T>
  schemaName: string
  maxTokens?: number
}

export type StructuredResult<T> = {
  data: T
  raw: string
  provider: ProviderName
  model: string
}

export interface LLMProvider {
  readonly name: ProviderName
  readonly model: string
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>
}

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new LLMError('LLM providers must never be called from the browser.')
  }
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
  }
}

/* ─────────────────────────────── Anthropic ─────────────────────────────── */

class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const
  constructor(readonly model: string) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    assertServer()
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new LLMError('ANTHROPIC_API_KEY is not set')

    // Tool use is how we force valid JSON out of the model: the tool's input
    // schema is the contract, so the response arrives already shaped.
    const tool = {
      name: req.schemaName,
      description: `Return the ${req.schemaName} payload.`,
      input_schema: z.toJSONSchema(req.schema, { io: 'output' }),
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        tools: [tool],
        tool_choice: { type: 'tool', name: req.schemaName },
        messages: [{ role: 'user', content: req.prompt }],
      }),
    })

    if (!res.ok) {
      throw new LLMError(`Anthropic API error ${res.status}`, await res.text())
    }

    const body = (await res.json()) as {
      content: Array<{ type: string; name?: string; input?: unknown }>
    }
    const block = body.content.find((c) => c.type === 'tool_use' && c.name === req.schemaName)
    if (!block?.input) throw new LLMError('Model returned no tool_use block', body)

    const raw = JSON.stringify(block.input)
    return { data: parseOrThrow(req.schema, block.input, raw), raw, provider: this.name, model: this.model }
  }
}

/* ──────────────────────────────── OpenAI ──────────────────────────────── */

class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const
  constructor(readonly model: string) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    assertServer()
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new LLMError('OPENAI_API_KEY is not set')
    const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: req.maxTokens ?? 4096,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: req.schemaName,
            strict: true,
            schema: z.toJSONSchema(req.schema, { io: 'output' }),
          },
        },
      }),
    })

    if (!res.ok) throw new LLMError(`OpenAI API error ${res.status}`, await res.text())

    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    const raw = body.choices[0]?.message.content
    if (!raw) throw new LLMError('Model returned no content', body)

    return { data: parseOrThrow(req.schema, JSON.parse(raw), raw), raw, provider: this.name, model: this.model }
  }
}

/* ───────────────────────────────── Mock ───────────────────────────────── */

/**
 * Used by tests and by local development without an API key. Registered draft
 * responses are returned verbatim, which keeps the generation pipeline's tests
 * deterministic and free.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock' as const
  readonly model = 'mock'
  private responses = new Map<string, unknown>()

  register(key: string, value: unknown): void {
    this.responses.set(key.toLowerCase(), value)
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const key = [...this.responses.keys()].find((k) => req.prompt.toLowerCase().includes(k))
    if (!key) throw new LLMError(`MockProvider has no registered response for this prompt`)
    const value = this.responses.get(key)
    const raw = JSON.stringify(value)
    return { data: parseOrThrow(req.schema, value, raw), raw, provider: this.name, model: this.model }
  }
}

/* ──────────────────────────── Template (dev) ──────────────────────────── */

/**
 * Returned when `LLM_PROVIDER=mock`. Synthesises a schema-valid draft with no
 * network call, so the whole draft → review → approve workflow can be walked
 * locally without an API key or spend.
 *
 * The content is deliberately, visibly placeholder text. A reviewer who sees it
 * in the queue must not be able to mistake it for real material and approve it.
 */
export class TemplateProvider implements LLMProvider {
  readonly name = 'mock' as const
  readonly model = 'template-dev'

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const lemma = /Target word:\s*(\S+)/.exec(req.prompt)?.[1] ?? 'word'
    const value = {
      meaningCoreKo: `[예시 데이터] ${lemma}의 중심 의미가 여기에 들어갑니다.`,
      meaningCoreEn: null,
      primaryTranslations: [`[예시] ${lemma}의 뜻`],
      meanings: [
        {
          ko: `[예시] ${lemma}의 첫 번째 용법`,
          enDefinition: null,
          connectionNote: '[예시] 이 뜻이 중심 의미에서 어떻게 나오는지 설명이 들어갑니다.',
          exampleChunk: null,
        },
      ],
      sentences: [
        {
          text: `This is a placeholder sentence using ${lemma}.`,
          ko: '[예시] 자리표시용 문장입니다.',
          targetMeaning: '[예시] 기본 용법',
          highlight: lemma,
          difficulty: 2,
        },
      ],
      collocations: [],
      wordFamily: [],
      similarWords: [],
    }
    const raw = JSON.stringify(value)
    return { data: parseOrThrow(req.schema, value, raw), raw, provider: this.name, model: this.model }
  }
}

/* ─────────────────────────────── factory ─────────────────────────────── */

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, raw: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new LLMError('Model output failed schema validation', {
      issues: parsed.error.issues,
      raw: raw.slice(0, 2000),
    })
  }
  return parsed.data
}

let override: LLMProvider | null = null

/** Test seam: swap in a MockProvider without touching the environment. */
export function setLLMProvider(provider: LLMProvider | null): void {
  override = provider
}

export function getLLMProvider(): LLMProvider {
  if (override) return override
  const name = (process.env.LLM_PROVIDER ?? 'anthropic') as ProviderName
  const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-5'
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(model)
    case 'openai':
      return new OpenAIProvider(model)
    case 'mock':
      return new TemplateProvider()
    default:
      throw new LLMError(`Unknown LLM_PROVIDER "${name}"`)
  }
}
