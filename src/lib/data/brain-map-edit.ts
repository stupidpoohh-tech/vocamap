import { and, count, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  brainMapCollocations,
  brainMapMeanings,
  brainMapRevisions,
  brainMapSentences,
  brainMapSimilarWords,
  brainMapWordFamily,
  brainMaps,
  vocabularies,
  wordPairQuestions,
  wordPairs,
} from '@/lib/db/schema'
import { ITEM_LABEL, ITEM_MAX, validateItem, type ItemKind, type ItemValues } from '@/lib/ai'
import { getMasterBrainMap } from './brain-map'
import { NotFoundError } from './errors'
import { normaliseLemma } from './vocabulary'

/**
 * Editing one piece of a Brain Map at a time.
 *
 * Regenerating is the blunt instrument: it throws away everything, costs a
 * model call, and gives no guarantee the one bad sentence comes back fixed.
 * A curator who spots a wrong translation wants to fix that translation, so
 * every function here touches exactly one row and leaves the rest alone.
 *
 * `writeDraft` stays the only writer for a whole generated draft; these are the
 * only writers for a single item. Nothing else should write these tables.
 */

export class EditError extends Error {
  readonly errors?: Record<string, string>
  constructor(message: string, errors?: Record<string, string>) {
    super(message)
    this.name = 'EditError'
    this.errors = errors
  }
}

const ROW_TABLES = {
  meaning: brainMapMeanings,
  sentence: brainMapSentences,
  collocation: brainMapCollocations,
  wordFamily: brainMapWordFamily,
} as const

type RowKind = keyof typeof ROW_TABLES

export type EditInput = {
  brainMapId: string
  kind: ItemKind
  /** The row being changed. Absent when creating. */
  itemId?: string
  /** The pair a question belongs to. Only for `pairQuestion`. */
  parentId?: string
  values: Record<string, string>
  actorId: string
}

export async function saveDraftItem(input: EditInput, db: Db = defaultDb): Promise<string> {
  const lemma = await mapLemma(input.brainMapId, db)
  const checked = validateItem(input.kind, input.values, { lemma })
  if (!checked.ok) throw new EditError('입력을 확인해 주세요.', checked.errors)

  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db
    const id = input.itemId
      ? await updateOne(input, checked.values, scoped)
      : await createOne(input, checked.values, lemma, scoped)

    await recordRevision(input.brainMapId, input.itemId ? 'manual_edit' : 'manual_add', input.actorId, scoped)
    return id
  })
}

export async function removeDraftItem(
  input: { brainMapId: string; kind: ItemKind; itemId: string; actorId: string },
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as Db
    await deleteOne(input, scoped)
    await recordRevision(input.brainMapId, 'manual_delete', input.actorId, scoped)
  })
}

export async function saveMeaningCore(
  input: { brainMapId: string; ko: string; en: string; actorId: string },
  db: Db = defaultDb,
): Promise<void> {
  const ko = input.ko.trim()
  const en = input.en.trim()
  if (ko.length < 5) throw new EditError('입력을 확인해 주세요.', { ko: '5자 이상 입력해 주세요.' })
  if (ko.length > 200) throw new EditError('입력을 확인해 주세요.', { ko: '200자 이하로 입력해 주세요.' })
  if (en.length > 200) throw new EditError('입력을 확인해 주세요.', { en: '200자 이하로 입력해 주세요.' })

  await db.transaction(async (tx) => {
    const scoped = tx as unknown as Db
    const updated = await tx
      .update(brainMaps)
      .set({ meaningCoreKo: ko, meaningCoreEn: en || null, updatedAt: new Date() })
      .where(eq(brainMaps.id, input.brainMapId))
      .returning({ id: brainMaps.id })
    if (!updated.length) throw new NotFoundError('Brain map not found')

    await recordRevision(input.brainMapId, 'manual_edit', input.actorId, scoped)
  })
}

/* ──────────────────────────────── writes ──────────────────────────────── */

async function updateOne(input: EditInput, values: ItemValues, db: Db): Promise<string> {
  if (input.kind === 'pair') return updatePair(input, values, db)
  if (input.kind === 'pairQuestion') return updatePairQuestion(input, values, db)

  const table = ROW_TABLES[input.kind as RowKind]
  const updated = await db
    .update(table)
    .set(values as never)
    // Scoped to the map as well as the row: an id alone must never be enough to
    // edit a piece of some other word's map.
    .where(and(eq(table.id, input.itemId!), eq(table.brainMapId, input.brainMapId)))
    .returning({ id: table.id })

  if (!updated[0]) throw new NotFoundError('항목을 찾을 수 없어요.')
  return updated[0].id
}

async function createOne(
  input: EditInput,
  values: ItemValues,
  lemma: string,
  db: Db,
): Promise<string> {
  if (input.kind === 'pair') return createPair(input, values, lemma, db)
  if (input.kind === 'pairQuestion') return createPairQuestion(input, values, db)

  const table = ROW_TABLES[input.kind as RowKind]
  await assertRoom(input.kind, await countRows(table, input.brainMapId, db))

  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${table.sortOrder}), -1) + 1` })
    .from(table)
    .where(eq(table.brainMapId, input.brainMapId))

  const inserted = await db
    .insert(table)
    .values({ ...values, brainMapId: input.brainMapId, sortOrder: next } as never)
    .returning({ id: table.id })

  if (!inserted[0]) throw new Error('항목을 추가하지 못했어요.')
  return inserted[0].id
}

async function deleteOne(
  input: { brainMapId: string; kind: ItemKind; itemId: string },
  db: Db,
): Promise<void> {
  if (input.kind === 'pair') return detachPair(input.brainMapId, input.itemId, db)
  if (input.kind === 'pairQuestion') {
    await assertPairLinked(input.brainMapId, await questionPairId(input.itemId, db), db)
    await db.delete(wordPairQuestions).where(eq(wordPairQuestions.id, input.itemId))
    return
  }

  const table = ROW_TABLES[input.kind as RowKind]
  const removed = await db
    .delete(table)
    .where(and(eq(table.id, input.itemId), eq(table.brainMapId, input.brainMapId)))
    .returning({ id: table.id })
  if (!removed.length) throw new NotFoundError('항목을 찾을 수 없어요.')
}

/* ───────────────────────────────── pairs ──────────────────────────────── */

async function updatePair(input: EditInput, values: ItemValues, db: Db): Promise<string> {
  await assertPairLinked(input.brainMapId, input.itemId!, db)
  // The two lemmas are the pair's identity and it is shared by both words'
  // maps, so only the explanation is editable here — see ITEM_FIELDS.pair.
  const updated = await db
    .update(wordPairs)
    .set({
      coreDifference: String(values.coreDifference),
      usageRule: values.usageRule === null ? null : String(values.usageRule),
      version: sql`${wordPairs.version} + 1`,
    })
    .where(eq(wordPairs.id, input.itemId!))
    .returning({ id: wordPairs.id })
  if (!updated[0]) throw new NotFoundError('항목을 찾을 수 없어요.')
  return updated[0].id
}

async function createPair(
  input: EditInput,
  values: ItemValues,
  lemma: string,
  db: Db,
): Promise<string> {
  const [linked] = await db
    .select({ value: count() })
    .from(brainMapSimilarWords)
    .where(eq(brainMapSimilarWords.brainMapId, input.brainMapId))
  await assertRoom('pair', linked?.value ?? 0)

  const [a, b] = [normaliseLemma(lemma), normaliseLemma(String(values.lemma))].sort() as [
    string,
    string,
  ]

  // Students only see approved pairs. A curator adding one by hand to a map
  // that is already published has, by writing it, approved it — leaving it as a
  // draft would make it vanish from the very screen they are fixing.
  const [head] = await db
    .select({ status: brainMaps.status })
    .from(brainMaps)
    .where(eq(brainMaps.id, input.brainMapId))
    .limit(1)
  const published = head?.status === 'approved'

  // Deliberately not `upsertWordPair`: that one replaces the pair's questions,
  // which would wipe the other word's material if this pair already exists.
  const [pair] = await db
    .insert(wordPairs)
    .values({
      lemmaA: a,
      lemmaB: b,
      coreDifference: String(values.coreDifference),
      usageRule: values.usageRule === null ? null : String(values.usageRule),
      status: published ? 'approved' : 'draft_ai',
    })
    .onConflictDoUpdate({
      target: [wordPairs.lemmaA, wordPairs.lemmaB],
      set: {
        coreDifference: String(values.coreDifference),
        usageRule: values.usageRule === null ? null : String(values.usageRule),
        // Never downgrade: the pair may already be published for the other word.
        ...(published ? { status: 'approved' as const } : {}),
        version: sql`${wordPairs.version} + 1`,
      },
    })
    .returning({ id: wordPairs.id })
  if (!pair) throw new Error('항목을 추가하지 못했어요.')

  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${brainMapSimilarWords.sortOrder}), -1) + 1` })
    .from(brainMapSimilarWords)
    .where(eq(brainMapSimilarWords.brainMapId, input.brainMapId))

  await db
    .insert(brainMapSimilarWords)
    .values({ brainMapId: input.brainMapId, pairId: pair.id, sortOrder: next })
    .onConflictDoNothing()

  return pair.id
}

/**
 * Removing a confusable from *this* map.
 *
 * The pair itself belongs to both words, so this detaches rather than deletes —
 * unless nothing else points at it, in which case it is orphaned and goes.
 */
async function detachPair(brainMapId: string, pairId: string, db: Db): Promise<void> {
  const removed = await db
    .delete(brainMapSimilarWords)
    .where(
      and(
        eq(brainMapSimilarWords.brainMapId, brainMapId),
        eq(brainMapSimilarWords.pairId, pairId),
      ),
    )
    .returning({ pairId: brainMapSimilarWords.pairId })
  if (!removed.length) throw new NotFoundError('항목을 찾을 수 없어요.')

  const [others] = await db
    .select({ value: count() })
    .from(brainMapSimilarWords)
    .where(eq(brainMapSimilarWords.pairId, pairId))
  if ((others?.value ?? 0) === 0) {
    await db.delete(wordPairs).where(eq(wordPairs.id, pairId))
  }
}

async function updatePairQuestion(input: EditInput, values: ItemValues, db: Db): Promise<string> {
  await assertPairLinked(input.brainMapId, await questionPairId(input.itemId!, db), db)
  const updated = await db
    .update(wordPairQuestions)
    .set({
      prompt: String(values.prompt),
      answer: String(values.answer),
      explanation: String(values.explanation),
    })
    .where(eq(wordPairQuestions.id, input.itemId!))
    .returning({ id: wordPairQuestions.id })
  if (!updated[0]) throw new NotFoundError('항목을 찾을 수 없어요.')
  return updated[0].id
}

async function createPairQuestion(input: EditInput, values: ItemValues, db: Db): Promise<string> {
  const pairId = input.parentId
  if (!pairId) throw new EditError('어떤 단어의 문제인지 알 수 없어요.')
  await assertPairLinked(input.brainMapId, pairId, db)

  const [existing] = await db
    .select({ value: count() })
    .from(wordPairQuestions)
    .where(eq(wordPairQuestions.pairId, pairId))
  await assertRoom('pairQuestion', existing?.value ?? 0)

  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${wordPairQuestions.sortOrder}), -1) + 1` })
    .from(wordPairQuestions)
    .where(eq(wordPairQuestions.pairId, pairId))

  const inserted = await db
    .insert(wordPairQuestions)
    .values({
      pairId,
      prompt: String(values.prompt),
      answer: String(values.answer),
      explanation: String(values.explanation),
      sortOrder: next,
    })
    .returning({ id: wordPairQuestions.id })
  if (!inserted[0]) throw new Error('항목을 추가하지 못했어요.')
  return inserted[0].id
}

async function questionPairId(questionId: string, db: Db): Promise<string> {
  const [row] = await db
    .select({ pairId: wordPairQuestions.pairId })
    .from(wordPairQuestions)
    .where(eq(wordPairQuestions.id, questionId))
    .limit(1)
  if (!row) throw new NotFoundError('항목을 찾을 수 없어요.')
  return row.pairId
}

/** A pair may only be touched through a map that actually teaches it. */
async function assertPairLinked(brainMapId: string, pairId: string, db: Db): Promise<void> {
  const [link] = await db
    .select({ pairId: brainMapSimilarWords.pairId })
    .from(brainMapSimilarWords)
    .where(
      and(
        eq(brainMapSimilarWords.brainMapId, brainMapId),
        eq(brainMapSimilarWords.pairId, pairId),
      ),
    )
    .limit(1)
  if (!link) throw new NotFoundError('항목을 찾을 수 없어요.')
}

/* ──────────────────────────────── helpers ─────────────────────────────── */

async function countRows(
  table: (typeof ROW_TABLES)[RowKind],
  brainMapId: string,
  db: Db,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(eq(table.brainMapId, brainMapId))
  return row?.value ?? 0
}

function assertRoom(kind: ItemKind, current: number): void {
  if (current >= ITEM_MAX[kind]) {
    throw new EditError(`${ITEM_LABEL[kind]}은(는) 최대 ${ITEM_MAX[kind]}개까지 담을 수 있어요.`)
  }
}

async function mapLemma(brainMapId: string, db: Db): Promise<string> {
  const [row] = await db
    .select({ lemma: vocabularies.lemma })
    .from(brainMaps)
    .innerJoin(vocabularies, eq(vocabularies.id, brainMaps.vocabularyId))
    .where(eq(brainMaps.id, brainMapId))
    .limit(1)
  if (!row) throw new NotFoundError('Brain map not found')
  return row.lemma
}

/**
 * Every manual change gets a version and a full snapshot.
 *
 * There is no undo button, so a teacher who deletes the wrong sentence has only
 * this. `brain_map_revisions` is unique on (map, version), so the version bump
 * and the snapshot go together or neither happens.
 */
async function recordRevision(
  brainMapId: string,
  changeKind: 'manual_edit' | 'manual_add' | 'manual_delete',
  actorId: string,
  db: Db,
): Promise<void> {
  const [head] = await db
    .update(brainMaps)
    .set({ version: sql`${brainMaps.version} + 1`, updatedAt: new Date() })
    .where(eq(brainMaps.id, brainMapId))
    .returning({ version: brainMaps.version, vocabularyId: brainMaps.vocabularyId })
  if (!head) throw new NotFoundError('Brain map not found')

  const snapshot = await getMasterBrainMap(head.vocabularyId, { approvedOnly: false }, db)
  await db.insert(brainMapRevisions).values({
    brainMapId,
    version: head.version,
    changeKind,
    changedBy: actorId,
    snapshot: snapshot ?? {},
  })
}

/* ─────────────────────────── removing content ─────────────────────────── */

/**
 * Deletes a word's Brain Map, leaving the word itself.
 *
 * For a draft that came back wrong in a way editing cannot fix: the word stays
 * in the library and can be drilled, it simply has no map until someone makes a
 * better one. The student's recall cards and answer history reference the
 * vocabulary, not the map, so none of it is touched.
 *
 * Confusable pairs are shared, so the same rule as detaching applies — a pair
 * another word still teaches survives.
 */
export async function deleteBrainMap(
  input: { brainMapId: string; actorId: string },
  db: Db = defaultDb,
): Promise<{ vocabularyId: string }> {
  return db.transaction(async (tx) => {
    const links = await tx
      .select({ pairId: brainMapSimilarWords.pairId })
      .from(brainMapSimilarWords)
      .where(eq(brainMapSimilarWords.brainMapId, input.brainMapId))

    const removed = await tx
      .delete(brainMaps)
      .where(eq(brainMaps.id, input.brainMapId))
      .returning({ vocabularyId: brainMaps.vocabularyId })
    if (!removed[0]) throw new NotFoundError('맵을 찾을 수 없어요.')

    for (const link of links) {
      const [others] = await tx
        .select({ value: count() })
        .from(brainMapSimilarWords)
        .where(eq(brainMapSimilarWords.pairId, link.pairId))
      if ((others?.value ?? 0) === 0) {
        await tx.delete(wordPairs).where(eq(wordPairs.id, link.pairId))
      }
    }

    return { vocabularyId: removed[0].vocabularyId }
  })
}

/**
 * Deletes a word from the shared library, and with it everything downstream.
 *
 * This is the destructive one. Every foreign key into `vocabularies` cascades,
 * so the word's map, every student's recall cards for it, and their whole
 * answer history go too — and none of that can be reconstructed. It exists
 * because a mistyped import otherwise sits in the library forever, but the
 * caller is expected to have asked first.
 */
export async function deleteVocabulary(
  input: { vocabularyId: string; actorId: string },
  db: Db = defaultDb,
): Promise<{ lemma: string }> {
  return db.transaction(async (tx) => {
    const [map] = await tx
      .select({ id: brainMaps.id })
      .from(brainMaps)
      .where(eq(brainMaps.vocabularyId, input.vocabularyId))
      .limit(1)
    // Through the map first, so shared pairs it was the last owner of go with
    // it instead of being orphaned by the cascade.
    if (map) await deleteBrainMap({ brainMapId: map.id, actorId: input.actorId }, tx as unknown as Db)

    const removed = await tx
      .delete(vocabularies)
      .where(eq(vocabularies.id, input.vocabularyId))
      .returning({ lemma: vocabularies.lemma })
    if (!removed[0]) throw new NotFoundError('단어를 찾을 수 없어요.')
    return { lemma: removed[0].lemma }
  })
}
