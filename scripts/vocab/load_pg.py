"""把 data/build/vocab.db 导入 PostgreSQL 的 vocab schema(整体重建)。

用法:load_pg.py <postgres URI>。SQLite 建表语句与 PostgreSQL 兼容,原样执行;
senses.examples 导入后转为 jsonb。词库只读,重建前会删除整个 vocab schema。
"""

import sqlite3
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "build" / "vocab.db"
SCHEMA = "vocab"


def main(uri):
    src = sqlite3.connect(DB)
    tables = src.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY rowid").fetchall()
    indexes = src.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY rowid").fetchall()

    with psycopg.connect(uri) as pg:
        pg.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
        pg.execute(f"CREATE SCHEMA {SCHEMA}")
        pg.execute(f"SET search_path TO {SCHEMA}")
        for name, sql in tables:
            pg.execute(sql)
            cols = [r[1] for r in src.execute(f"PRAGMA table_info({name})")]
            with pg.cursor().copy(f"COPY {name} ({', '.join(cols)}) FROM STDIN") as copy:
                for row in src.execute(f"SELECT {', '.join(cols)} FROM {name}"):
                    copy.write_row(row)
            print(f"{name}: {pg.execute(f'SELECT count(*) FROM {name}').fetchone()[0]}")
        for (sql,) in indexes:
            pg.execute(sql)
        pg.execute("ALTER TABLE senses ALTER COLUMN examples TYPE jsonb USING examples::jsonb")
        pg.execute("CREATE INDEX words_lower ON words (lower(word))")
        pg.execute(f"ANALYZE")
        size = pg.execute(f"SELECT pg_size_pretty(sum(pg_total_relation_size(c.oid))) FROM pg_class c"
                          f" JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '{SCHEMA}'"
                          " AND c.relkind = 'r'").fetchone()[0]
        print("schema size:", size)


if __name__ == "__main__":
    main(sys.argv[1])
