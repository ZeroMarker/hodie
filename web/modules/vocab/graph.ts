// 把词的关系整理成图谱的节点和边(纯函数,前端用 Cytoscape.js 画)。
import type { WordRelations } from "./relations";

export type EdgeKind = "family" | "synonym" | "antonym" | "hypernym" | "morpheme";

export interface GraphNode {
  id: string;
  label: string;
  /** 词节点的 words.id;词素节点为 null */
  wordId: number | null;
  kind: "center" | "word" | "morpheme";
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const EDGE_LABELS: Record<EdgeKind, string> = {
  family: "同族",
  synonym: "近义",
  antonym: "反义",
  hypernym: "上位",
  morpheme: "词根词缀",
};

/** 中心词连到各类关系词;词素单独成节点,同根词挂在词素下。一个词只出现一次,先到先得。 */
export function buildGraph(center: { id: number; word: string }, r: WordRelations): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const centerId = `w${center.id}`;
  nodes.set(centerId, { id: centerId, label: center.word, wordId: center.id, kind: "center" });

  const link = (from: string, w: { id: number; word: string }, kind: EdgeKind) => {
    const id = `w${w.id}`;
    if (nodes.has(id)) return;
    nodes.set(id, { id, label: w.word, wordId: w.id, kind: "word" });
    edges.push({ source: from, target: id, kind });
  };

  for (const w of r.family) link(centerId, w, "family");
  for (const w of r.synonyms) link(centerId, w, "synonym");
  for (const w of r.antonyms) link(centerId, w, "antonym");
  for (const w of r.hypernyms) link(centerId, w, "hypernym");
  for (const m of r.morphemes) {
    if (m.siblings.length === 0) continue;
    const id = `m${m.form}`;
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: m.form, wordId: null, kind: "morpheme" });
      edges.push({ source: centerId, target: id, kind: "morpheme" });
    }
    for (const w of m.siblings) link(id, w, "morpheme");
  }
  return { nodes: [...nodes.values()], edges };
}
