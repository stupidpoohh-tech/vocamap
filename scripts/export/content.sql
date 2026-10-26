-- 보카맵 콘텐츠 내보내기
--
-- Neon Console → vocamap → SQL Editor 에 이 파일 내용을 그대로 붙여넣고 Run.
-- 결과는 한 줄 한 칸이다. 그 값을 통째로 복사해서 저장소의
-- content/export.json 파일에 붙여넣으면 된다.
--
-- 읽기만 한다. 아무것도 고치거나 지우지 않는다.
select json_build_object(
  'exportedAt', now(),
  'sets', (
    select coalesce(json_agg(s order by s.title), '[]'::json) from (
      select vs.title,
             (select coalesce(json_agg(w order by w.sort_order), '[]'::json) from (
                select v.lemma,
                       v.part_of_speech          as pos,
                       v.pronunciation,
                       vsi.sort_order,
                       (select t.text from vocabulary_translations t
                         where t.vocabulary_id = v.id
                         order by t.is_primary desc nulls last, t.sort_order
                         limit 1)                as ko
                  from vocabulary_set_items vsi
                  join vocabularies v on v.id = vsi.vocabulary_id
                 where vsi.set_id = vs.id
              ) w)                               as words
        from vocabulary_sets vs
    ) s
  ),
  'maps', (
    select coalesce(json_agg(m order by m.lemma), '[]'::json) from (
      select v.lemma,
             bm.version,
             bm.meaning_core_ko                  as core_ko,
             bm.meaning_core_en                  as core_en,
             -- `en_ko` 는 영영 풀이 그 문장의 한국어 해석이다. 단어 뜻(`ko`)과
             -- 다른 것이라 따로 가져온다 — 이것이 빠지면 맵에서 영영 풀이를
             -- 눌렀을 때 보여 줄 것이 없어진다.
             (select coalesce(json_agg(json_build_object(
                'ko', x.ko, 'en', x.en_definition, 'en_ko', x.en_definition_ko,
                'note', x.connection_note,
                'chunk', x.example_chunk) order by x.sort_order), '[]'::json)
                from brain_map_meanings x where x.brain_map_id = bm.id)      as meanings,
             (select coalesce(json_agg(json_build_object(
                'text', x.text, 'ko', x.ko, 'highlight', x.highlight,
                'target', x.target_meaning) order by x.sort_order), '[]'::json)
                from brain_map_sentences x where x.brain_map_id = bm.id)     as sentences,
             (select coalesce(json_agg(json_build_object(
                'expression', x.expression, 'ko', x.ko,
                'example', x.example_sentence) order by x.sort_order), '[]'::json)
                from brain_map_collocations x where x.brain_map_id = bm.id)  as collocations,
             (select coalesce(json_agg(json_build_object(
                'lemma', x.lemma, 'pos', x.part_of_speech, 'ko', x.ko,
                'example', x.example_sentence) order by x.sort_order), '[]'::json)
                from brain_map_word_family x where x.brain_map_id = bm.id)   as family
        from brain_maps bm
        join vocabularies v on v.id = bm.vocabulary_id
       where bm.status = 'approved'
    ) m
  )
) as export;
