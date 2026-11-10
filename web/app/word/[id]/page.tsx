import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WordGraph } from "@/components/word-graph";
import { currentUserId } from "@/modules/auth";
import { wordStatus } from "@/modules/study/stats";
import { formOwners, senseSafe } from "@/modules/study/words";
import { getWordCard, listName } from "@/modules/vocab/card";
import { getEtymologySteps } from "@/modules/vocab/etymology";
import { type Graph, buildGraph } from "@/modules/vocab/graph";
import { type RelatedWord, getWordRelations } from "@/modules/vocab/relations";

const isAi = (source: string) => source.startsWith("ai:");

export default function WordPage({ params }: PageProps<"/word/[id]">) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl p-6 text-zinc-500">加载中…</main>}>
      <WordCardView params={params} />
    </Suspense>
  );
}

async function WordCardView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const card = await getWordCard(Number(id));
  if (!card) notFound();
  const [relations, steps, owners] = await Promise.all([
    getWordRelations(card.id, card.coreSenseId),
    getEtymologySteps(card.id),
    formOwners(),
  ]);
  const examples = senseSafe(card, card.examples, (e) => e.textEn, owners);
  const collocations = senseSafe(card, card.collocations, (c) => c.phrase, owners);
  const graph = buildGraph(card, relations);
  const morphemes = relations.morphemes;

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">{card.word}</h1>
        <p className="text-zinc-500">
          {card.phonetic && <span>/{card.phonetic}/</span>}
          {card.cefr && <span className="ml-3">{card.cefr}</span>}
          {card.lists.length > 0 && (
            <span className="ml-3">{card.lists.map(listName).join(" · ")}</span>
          )}
        </p>
      </header>

      <section>
        <ul className="space-y-1">
          {card.translations.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {card.coreSense && (
          <p className="mt-2 text-sm text-zinc-500">
            核心义:{card.coreSense.pos}. {card.coreSense.definition}
          </p>
        )}
      </section>

      {examples.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">例句</h2>
          <ul className="space-y-3">
            {examples.map((e) => (
              <li key={e.id}>
                <p>{e.textEn}</p>
                <p className="text-zinc-500">
                  {e.textZh}
                  {isAi(e.source) && <span className="ml-2 text-xs">AI 生成</span>}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {collocations.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">搭配</h2>
          <p>{collocations.map((c) => c.phrase).join(" · ")}</p>
        </section>
      )}

      {morphemes.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">词根词缀</h2>
          <ul className="space-y-2">
            {morphemes.map((m) => (
              <li key={m.form}>
                <span className="font-mono font-semibold">{m.form}</span>
                {m.meaning && <span className="ml-2 text-sm text-zinc-500">{m.meaning}</span>}
                {m.siblings.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <span className="text-sm text-zinc-400">同根:</span>
                    {m.siblings.map((w) => (
                      <WordChip key={w.id} w={w} />
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(card.etymology || steps.length > 0) && (
        <section>
          <h2 className="mb-2 font-semibold">词源</h2>
          {steps.length > 0 && (
            <p className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{card.word}</span>
              {steps.map((s, i) => (
                <span key={i}>
                  <span className="text-zinc-400">← </span>
                  <span className="text-zinc-500">{s.lang} </span>
                  <span className="italic">{s.term}</span>
                  {s.gloss && <span className="text-zinc-500">(“{s.gloss}”)</span>}
                </span>
              ))}
            </p>
          )}
          {card.etymology && (
            <p>
              {card.etymology.text}
              {isAi(card.etymology.source) && <span className="ml-2 text-xs text-zinc-500">AI 生成</span>}
            </p>
          )}
        </section>
      )}

      <RelatedList title="同族词" words={relations.family} />
      <RelatedList title="近义词" words={relations.synonyms} />
      <RelatedList title="反义词" words={relations.antonyms} />
      <RelatedList title="上位词" words={relations.hypernyms} />

      {graph.nodes.length > 1 && (
        <section>
          <h2 className="mb-2 font-semibold">关系图谱</h2>
          <Suspense fallback={<WordGraph graph={graph} status={{}} />}>
            <GraphWithStatus graph={graph} />
          </Suspense>
        </section>
      )}
    </main>
  );
}

/** 登录用户的图谱带掌握状态(点亮已掌握的词);未登录只显示关系。 */
async function GraphWithStatus({ graph }: { graph: Graph }) {
  const userId = await currentUserId();
  const ids = graph.nodes.flatMap((n) => (n.wordId === null ? [] : [n.wordId]));
  const status = userId ? await wordStatus(userId, ids) : {};
  return <WordGraph graph={graph} status={status} />;
}

function RelatedList({ title, words }: { title: string; words: RelatedWord[] }) {
  if (words.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <div className="flex flex-wrap gap-1.5">
        {words.map((w) => (
          <WordChip key={w.id} w={w} />
        ))}
      </div>
    </section>
  );
}

function WordChip({ w }: { w: RelatedWord }) {
  return (
    <Link
      href={`/word/${w.id}`}
      title={w.gloss}
      className={`rounded-full border px-2.5 py-0.5 text-sm hover:border-zinc-900 ${w.inList ? "border-zinc-300" : "border-zinc-200 text-zinc-500"}`}
    >
      {w.word}
    </Link>
  );
}
