import { sql } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { db } from "@/db";

/** 词源链的一步,如「拉丁语 inspectum」。 */
export interface EtymologyStep {
  type: string;
  lang: string;
  term: string;
  gloss: string | null;
}

/** 常见来源语言的中文名;其他语言用 Wiktionary 的英文名。 */
const LANG_ZH: Record<string, string> = {
  en: "英语",
  enm: "中古英语",
  ang: "古英语",
  fr: "法语",
  frm: "中古法语",
  fro: "古法语",
  "xno": "盎格鲁-诺曼语",
  la: "拉丁语",
  "la-lat": "晚期拉丁语",
  "la-med": "中世纪拉丁语",
  "la-new": "新拉丁语",
  "la-vul": "通俗拉丁语",
  grc: "古希腊语",
  el: "希腊语",
  de: "德语",
  gem: "日耳曼语",
  "gem-pro": "原始日耳曼语",
  "ine-pro": "原始印欧语",
  non: "古诺尔斯语",
  nl: "荷兰语",
  dum: "中古荷兰语",
  it: "意大利语",
  es: "西班牙语",
  ar: "阿拉伯语",
  fa: "波斯语",
  sa: "梵语",
  "itc-pro": "原始意大利语",
};

/** 第一组词源的各步,由近到远(如 中古英语 → 古法语 → 拉丁语)。缓存一天。 */
export async function getEtymologySteps(id: number): Promise<EtymologyStep[]> {
  "use cache";
  cacheLife("days");
  const { rows } = await db.execute<{ type: string; lang: string; name: string | null; term: string; gloss: string | null }>(sql`
    SELECT s.type, s.lang, l.name, s.term, s.gloss
    FROM vocab.etymology_steps s LEFT JOIN vocab.languages l ON l.code = s.lang
    WHERE s.word_id = ${id}
      AND s.etym_no = (SELECT min(etym_no) FROM vocab.etymology_steps WHERE word_id = ${id})
    ORDER BY s.step`);
  return rows.map((r) => ({ type: r.type, lang: LANG_ZH[r.lang] ?? r.name ?? r.lang, term: r.term, gloss: r.gloss }));
}
