"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { WordStatus } from "@/modules/study/stats";
import { EDGE_LABELS, type EdgeKind, type Graph } from "@/modules/vocab/graph";

const EDGE_COLORS: Record<EdgeKind, string> = {
  family: "#2563eb",
  synonym: "#16a34a",
  antonym: "#dc2626",
  hypernym: "#71717a",
  morpheme: "#d97706",
};

/** 词的关系图谱。已掌握的词点亮(实心绿),在学的浅绿,没学的白底;点词节点跳到该词。 */
export function WordGraph({ graph, status }: { graph: Graph; status: Record<number, WordStatus> }) {
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let destroyed = false;
    let cy: { destroy: () => void } | null = null;
    // Cytoscape 只在浏览器里加载,不进服务端包
    import("cytoscape").then(({ default: cytoscape }) => {
      if (destroyed || !box.current) return;
      const instance = cytoscape({
        container: box.current,
        elements: [
          ...graph.nodes.map((n) => ({
            data: {
              id: n.id,
              label: n.label,
              wordId: n.wordId,
              kind: n.kind,
              status: n.wordId !== null ? (status[n.wordId] ?? "none") : "none",
            },
          })),
          ...graph.edges.map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, color: EDGE_COLORS[e.kind] } })),
        ],
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "font-size": 12,
              "text-valign": "center",
              "text-halign": "center",
              // 按词长估宽度(Cytoscape 已弃用 width: "label")
              width: (ele: { data: (k: string) => string }) => ele.data("label").length * 7 + 12,
              height: 24,
              padding: "6px",
              shape: "round-rectangle",
              "background-color": "#ffffff",
              "border-width": 1,
              "border-color": "#d4d4d8",
              color: "#18181b",
            },
          },
          { selector: 'node[status = "learning"]', style: { "background-color": "#dcfce7", "border-color": "#86efac" } },
          { selector: 'node[status = "mastered"]', style: { "background-color": "#16a34a", "border-color": "#15803d", color: "#ffffff" } },
          { selector: 'node[kind = "morpheme"]', style: { shape: "ellipse", "background-color": "#fef3c7", "border-color": "#f59e0b" } },
          { selector: 'node[kind = "center"]', style: { "font-size": 15, "font-weight": "bold", "border-width": 2, "border-color": "#18181b" } },
          { selector: "edge", style: { width: 1.5, "line-color": "data(color)", "curve-style": "straight", opacity: 0.7 } },
        ],
        layout: { name: "cose", animate: false, nodeRepulsion: () => 8000, idealEdgeLength: () => 70, padding: 16 },
        minZoom: 0.4,
        maxZoom: 2.5,
      });
      instance.on("tap", "node", (evt) => {
        const id = evt.target.data("wordId");
        if (id !== null && evt.target.data("kind") !== "center") router.push(`/word/${id}`);
      });
      cy = instance;
    });
    return () => {
      destroyed = true;
      cy?.destroy();
    };
  }, [graph, status, router]);

  return (
    <div className="space-y-2">
      <div ref={box} className="h-80 w-full rounded-xl border border-zinc-200 bg-zinc-50" />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {(Object.keys(EDGE_LABELS) as EdgeKind[])
          .filter((k) => graph.edges.some((e) => e.kind === k))
          .map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: EDGE_COLORS[k] }} />
              {EDGE_LABELS[k]}
            </span>
          ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-green-600" />
          已掌握
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-green-300 bg-green-100" />
          在学
        </span>
      </p>
    </div>
  );
}
