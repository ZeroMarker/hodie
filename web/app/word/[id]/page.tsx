import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getWordCard, listName } from "@/modules/vocab/card";

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

      {card.examples.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">例句</h2>
          <ul className="space-y-3">
            {card.examples.map((e) => (
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

      {card.collocations.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">搭配</h2>
          <p>{card.collocations.map((c) => c.phrase).join(" · ")}</p>
        </section>
      )}

      {card.etymology && (
        <section>
          <h2 className="mb-2 font-semibold">词源</h2>
          <p>
            {card.etymology.text}
            {isAi(card.etymology.source) && <span className="ml-2 text-xs text-zinc-500">AI 生成</span>}
          </p>
        </section>
      )}
    </main>
  );
}
