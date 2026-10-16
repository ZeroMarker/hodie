// 导入词库后检查 app 中引用的 word_id、sense_id 是否仍存在于 vocab。
// 用法:DATABASE_URL=... pnpm check-refs;有失效引用时退出码为 1。
import pg from "pg";
import { connectionConfig } from "../db/connection.ts";

const client = new pg.Client(connectionConfig());
await client.connect();

const { rows } = await client.query<{ words: number; senses: number }>(`
  SELECT
    (SELECT count(*)::int FROM app.cards c
      WHERE NOT EXISTS (SELECT 1 FROM vocab.words w WHERE w.id = c.word_id)) AS words,
    (SELECT count(*)::int FROM app.cards c
      WHERE c.sense_id <> ''
        AND NOT EXISTS (SELECT 1 FROM vocab.senses s
                        WHERE s.id = c.sense_id AND s.word_id = c.word_id)) AS senses`);
await client.end();

const { words, senses } = rows[0];
console.log(`失效 word_id: ${words},失效 sense_id: ${senses}`);
process.exit(words + senses > 0 ? 1 : 0);
