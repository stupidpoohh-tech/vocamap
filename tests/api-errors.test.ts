import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { LLMError, describeApiError, getLLMProvider } from '@/lib/ai/provider'

/**
 * What the curator reads when a generation fails.
 *
 * A bare status code sends whoever is looking into the code to guess which
 * part of the request the API objected to. The vendor already says which part;
 * the only job here is not to throw that sentence away.
 */
describe('a refused API request', () => {
  it('says what the API said, not just that it said no', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'output_config: Extra inputs are not permitted',
      },
    })

    expect(describeApiError('Anthropic', 400, body)).toBe(
      'Anthropic API error 400 — output_config: Extra inputs are not permitted',
    )
  })

  it('names the error type when it is not the generic one', () => {
    const body = JSON.stringify({
      type: 'error',
      error: { type: 'not_found_error', message: 'model: claude-nope' },
    })

    expect(describeApiError('Anthropic', 404, body)).toBe(
      'Anthropic API error 404 — not_found_error: model: claude-nope',
    )
  })

  it('passes a body that is not JSON straight through', () => {
    // A proxy or a gateway answers in HTML. Still more than a number.
    expect(describeApiError('Anthropic', 502, '<html>Bad Gateway</html>')).toBe(
      'Anthropic API error 502 — <html>Bad Gateway</html>',
    )
  })

  it('falls back to the status alone when the body is empty', () => {
    expect(describeApiError('OpenAI', 500, '   ')).toBe('OpenAI API error 500')
  })

  it('trims a body long enough to bury the useful part', () => {
    const long = 'x'.repeat(900)
    const result = describeApiError('OpenAI', 400, JSON.stringify({ error: { message: long } }))

    expect(result.length).toBeLessThan(450)
    expect(result.endsWith('…')).toBe(true)
    expect(result.startsWith('OpenAI API error 400 — xxx')).toBe(true)
  })

  it('does not invent a reason when the envelope has no message', () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } })
    expect(describeApiError('Anthropic', 529, body)).toBe(`Anthropic API error 529 — ${body}`)
  })
})


describe('the provider that made the request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('throws the API sentence, so it reaches the button and the job row', async () => {
    // The wiring is the point: a formatter nobody calls fixes nothing. The
    // curator's screen showed "Anthropic API error 400" and the job row stored
    // the same string, while the reason sat unread in `detail`.
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_MODEL', 'claude-opus-5')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-not-a-real-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'max_tokens: must be >= 1' },
          }),
          { status: 400 },
        ),
      ),
    )

    const failure = await getLLMProvider()
      .generateStructured({
        system: 'system',
        prompt: 'prompt',
        schema: z.object({ ok: z.boolean() }),
        schemaName: 'probe',
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(LLMError)
    expect((failure as LLMError).message).toBe(
      'Anthropic API error 400 — max_tokens: must be >= 1',
    )
  })
})
