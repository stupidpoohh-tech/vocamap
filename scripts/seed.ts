import 'dotenv/config'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  brainMaps,
  users,
  vocabularySets,
  vocabularies,
  wordPairs,
} from '@/lib/db/schema'
import { SEED_WORDS } from '@/lib/seed/words'
import { brainMapDraftSchema, validateDraftConsistency } from '@/lib/ai/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { writeDraft } from '@/lib/data/brain-map'
import { addToSet, assignSet, createSet, linkStudent } from '@/lib/data/teacher'
import { hashPassword } from '@/lib/auth/password'

/**
 * Seeding comes in two halves, kept apart on purpose.
 *
 *   default    shared vocabulary + approved Brain Maps. Safe to run anywhere,
 *              including production — it is exactly the content you want there.
 *   --demo     additionally creates three accounts with a password that is
 *              written in this file, plus a set assigned to the demo student.
 *              Local only. Running this against a public deployment hands
 *              anyone who can read this repository an admin login.
 */
const RESET = process.argv.includes('--reset')
const WITH_DEMO = process.argv.includes('--demo')

const DEMO = [
  { email: 'teacher@vocamap.local', name: '과외 선생님', role: 'teacher' as const },
  { email: 'student@vocamap.local', name: '김학생', role: 'student' as const },
  { email: 'admin@vocamap.local', name: '관리자', role: 'admin' as const },
]
const DEMO_PASSWORD = 'vocamap1234'

/**
 * A deployment reachable from the internet must never carry the demo accounts.
 * The check is deliberately crude and errs towards refusing: a local database
 * is one on localhost, everything else is treated as real.
 */
function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
  if (isLocal) return
  throw new Error(
    [
      'Refusing to create demo accounts against a non-local database.',
      '',
      `  DATABASE_URL points at: ${url.replace(/:[^:@/]*@/, ':***@') || '(unset)'}`,
      '',
      'The demo accounts share a password that is committed to this repository,',
      'and one of them is an admin. Run `pnpm db:seed` (without --demo) to seed',
      'vocabulary and Brain Maps only, then create your own account by signing up.',
    ].join('\n'),
  )
}

async function resetSeed() {
  const seeded = await db
    .select({ id: vocabularies.id })
    .from(vocabularies)
    .where(eq(vocabularies.isSeed, true))
  if (seeded.length) {
    // Cascades clear brain maps, set items and per-student state for these words.
    await db.delete(vocabularies).where(inArray(vocabularies.id, seeded.map((s) => s.id)))
  }
  await db.delete(vocabularySets).where(eq(vocabularySets.isSeed, true))
  await db.delete(users).where(inArray(users.email, DEMO.map((d) => d.email)))
  console.log(`✓ removed ${seeded.length} seed words${WITH_DEMO ? ' and the demo users' : ''}`)
}

async function createDemoUsers(): Promise<Map<string, string>> {
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const accounts = new Map<string, string>()

  for (const person of DEMO) {
    const [row] = await db
      .insert(users)
      .values({
        email: person.email,
        displayName: person.name,
        role: person.role,
        passwordHash,
      })
      .onConflictDoNothing()
      .returning({ id: users.id })

    const id =
      row?.id ??
      (await db.select({ id: users.id }).from(users).where(eq(users.email, person.email)).limit(1))[0]
        ?.id
    if (!id) throw new Error(`Could not create ${person.email}`)
    accounts.set(person.role, id)
  }

  return accounts
}

async function main() {
  if (WITH_DEMO) assertLocalDatabase()
  if (RESET) await resetSeed()

  const accounts = WITH_DEMO ? await createDemoUsers() : new Map<string, string>()
  const teacherId = accounts.get('teacher') ?? null
  const studentId = accounts.get('student') ?? null

  if (teacherId && studentId) await linkStudent(teacherId, studentId)

  const vocabularyIds: string[] = []
  let mapsWritten = 0

  for (const word of SEED_WORDS) {
    const { id } = await findOrCreateVocabulary({
      lemma: word.lemma,
      partOfSpeech: word.partOfSpeech,
      level: word.level,
      translations: word.translations,
      isSeed: true,
      createdBy: teacherId,
    })
    vocabularyIds.push(id)

    if (!word.brainMap) continue

    // Seed content goes through exactly the same validation the LLM output does.
    const parsed = brainMapDraftSchema.parse(word.brainMap)
    const problems = validateDraftConsistency(parsed)
    if (problems.length) {
      throw new Error(`Seed brain map for "${word.lemma}" is invalid: ${problems.join('; ')}`)
    }

    await writeDraft(id, parsed, { createdBy: teacherId, status: 'approved', model: null })
    await db
      .update(brainMaps)
      .set({ approvedBy: teacherId, approvedAt: new Date(), generatedByModel: null })
      .where(eq(brainMaps.vocabularyId, id))
    mapsWritten += 1
  }

  // Seed pairs are curated, so they ship approved alongside their maps.
  await db
    .update(wordPairs)
    .set({ status: 'approved', approvedBy: teacherId, approvedAt: new Date() })

  console.log(`✓ ${vocabularyIds.length} words, ${mapsWritten} approved brain maps`)

  if (!teacherId || !studentId) {
    console.log('✓ no demo accounts created — sign up in the app to make yours')
    console.log('  (local testing: pnpm db:seed:demo)')
    process.exit(0)
  }

  const [existingSet] = await db
    .select({ id: vocabularySets.id })
    .from(vocabularySets)
    .where(eq(vocabularySets.isSeed, true))
    .limit(1)

  const setId =
    existingSet?.id ??
    (await createSet({
      ownerId: teacherId,
      title: '예시 단어 세트',
      description: 'UI와 기능 확인용 seed 단어입니다. pnpm db:reset-seed 로 지울 수 있습니다.',
      isSeed: true,
    }))

  await addToSet(setId, vocabularyIds)
  await assignSet({ setId, studentId, assignedBy: teacherId })

  console.log(`✓ demo logins (password: ${DEMO_PASSWORD})`)
  for (const person of DEMO) console.log(`    ${person.role.padEnd(7)} ${person.email}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
