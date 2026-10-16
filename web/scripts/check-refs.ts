// 导入词库后检查 app 中引用的 word_id、sense_id 是否仍存在于 vocab。
// 用法:DATABASE_URL=... pnpm check-refs;有失效引用时退出码为 1。
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const [{ words }] = await sql`
  SELECT count(*)::int AS words FROM app.cards c
  WHERE NOT EXISTS (SELECT 1 FROM vocab.words w WHERE w.id = c.word_id)`;
const [{ senses }] = await sql`
  SELECT count(*)::int AS senses FROM app.cards c
  WHERE c.sense_id <> ''
    AND NOT EXISTS (SELECT 1 FROM vocab.senses s WHERE s.id = c.sense_id AND s.word_id = c.word_id)`;
await sql.end();

console.log(`失效 word_id: ${words},失效 sense_id: ${senses}`);
process.exit(words + senses > 0 ? 1 : 0);
