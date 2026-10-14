# 仓库约定

- 文档用中文,放在 `docs/`;入口是 [开发计划](docs/plan.md)。新文档要从相关文档链接过去,结尾写「返回 [开发计划](plan.md)」。
- 直接在 main 分支提交并推送,不另建分支。
- 词库构建脚本在 `scripts/vocab/`,用法见其 README。`data/` 不入库;`scripts/vocab/word_ids.tsv` 入库,不要手动改动或重排,它保证 `words.id` 稳定。
- 运行 Python 时加 `-I`;依赖写在 `scripts/vocab/requirements.txt`,固定版本。
- 数据来源和许可见 [词库来源选择](docs/vocab-sources.md);引入新数据源前先核对许可。
- 线上数据库为 Aiven `mammoth` 服务的 `hodie` 库,连接串用 `avn service get mammoth --format '{service_uri}'` 现取,不要写进仓库。
- 当前交给 opencode 的任务见 [阶段 3 词库任务](docs/stage3-vocab-tasks.md)。
