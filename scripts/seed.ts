import 'dotenv/config'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  brainMaps,
  users,
  vocabularies,
  vocabularySetItems,
  vocabularySets,
  wordPairs,
} from '@/lib/db/schema'
import { SEED_WORDS } from '@/lib/seed/words'
import { brainMapDraftSchema, validateDraftConsistency } from '@/lib/ai/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { writeDraft } from '@/lib/data/brain-map'
import { addToSet, assignSet, createSet, linkStudent } from '@/lib/data/teacher'
import { hashPassword } from '@/lib/auth/password'

const RESET = process.argv.includes('--reset')

const DEMO = [
  { email: 'teacher@vocamap.local', name: '과외 선생님', role: 'teacher' as const },
  { email: 'student@vocamap.local', name: '김학생', role: 'student' as const },
  { email: 'admin@vocamap.local', name: '관리자', role: 'admin' as const },
]
const DEMO_PASSWORD = 'vocamap1234'

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
  console.log(`✓ removed ${seeded.length} seed words and their demo users`)
}

async function main() {
  if (RESET) await resetSeed()

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

  const teacherId = accounts.get('teacher')!
  const studentId = accounts.get('student')!
  await linkStudent(teacherId, studentId)

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
  await db.update(wordPairs).set({ status: 'approved', approvedBy: teacherId, approvedAt: new Date() })

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

  const [{ count: setSize } = { count: 0 }] = await db
    .select({ count: vocabularySetItems.vocabularyId })
    .from(vocabularySetItems)
    .where(eq(vocabularySetItems.setId, setId))
    .then((rows) => [{ count: rows.length }])

  console.log(`✓ ${vocabularyIds.length} words, ${mapsWritten} approved brain maps, set of ${setSize}`)
  console.log(`✓ demo logins (password: ${DEMO_PASSWORD})`)
  for (const person of DEMO) console.log(`    ${person.role.padEnd(7)} ${person.email}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
