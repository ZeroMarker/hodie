# 词库来源选择

2026-10-14

本文按现有知识整理,许可证条款没有逐条到原始页面核对;上线前须逐项确认,结论以各项目官方许可证文本为准。

## 结论

主干用 ECDICT,其余来源只补它缺的字段;Oxford 3000 和商业词书不导入。

| 字段 | 选用来源 | 许可证 | 备注 |
| --- | --- | --- | --- |
| 词条、中文释义、音标 | ECDICT | MIT | 约 77 万词条,自带考试标签和多种词频 |
| 考试词表(中高考、CET-4/6、考研、雅思、托福、GRE) | ECDICT 的 `tag` 字段 | MIT | 不另抓词书;标签准确度需抽检 |
| 高频核心词 | NGSL(约 2800 词) | CC BY-SA 4.0 | 替代含糊的「高频 3000 词」 |
| 学术词 | NAWL | CC BY-SA 4.0 | 后期按需导入 |
| 词频排名 | wordfreq | 代码 Apache 2.0,数据 CC BY-SA 4.0 | 多语料混合,商用条款清晰 |
| CEFR 等级 | CEFR-J Wordlist(A1 到 B2)+ Octanove C1/C2 | 需署名;Octanove 为 CC BY-SA 4.0 | 替代 Oxford 3000 |
| 词义关系(同义、反义、上下位) | Open English WordNet | CC BY 4.0 | Princeton WordNet 的持续维护版 |
| 词源、语域标注、词形变化 | Wiktionary(kaikki.org 的 wiktextract 导出) | CC BY-SA 4.0 | 已解析为 JSON,省去自写解析器 |
| 美式发音拼读 | CMUdict | BSD 类 | 用于拼写和听写题的音素对齐 |
| 例句(含中文翻译) | Tatoeba | CC BY 2.0 FR | 需逐句保留作者署名 |

## 不选或暂缓的来源

- **Oxford 3000/5000**:牛津大学出版社版权所有,不是开放数据。ECDICT 里的 `oxford` 标记只用于内部对照,不在界面展示「牛津 3000」字样。
- **SUBTLEX-US**:学术界常用,但网站只写「供研究使用」,商用条款不明确;wordfreq 已经混入字幕语料,先用 wordfreq,需要时再联系作者确认。
- **English Vocabulary Profile(剑桥)**:只允许在线查询,不允许批量导出。
- **商业词书(新东方、扇贝、百词斩等)**:释义、例句和编排都有版权,不抓取。考试大纲词表本身用 ECDICT 标签覆盖。
- **Etymonline**:同 [开发计划](plan.md) 的结论,只作人工参考。
- **ConceptNet**:CC BY-SA 4.0,发布之后再考虑。

## share-alike 的影响

NGSL、wordfreq 数据、Octanove 和 Wiktionary 都是 CC BY-SA。只要分发由它们衍生的数据(如开放词库下载或 API),衍生数据就必须同样以 CC BY-SA 发布。应用本身的代码不受影响。

应对方式:

1. 数据库按来源分列或分表,记录每条数据的 `source` 字段,方便将来替换或单独导出。
2. 「关于」页统一列出署名;Tatoeba 例句在例句下方显示作者。
3. 不对外提供原始词库批量下载,只在应用内展示。

## 导入顺序

1. 阶段 0:ECDICT 全量导入 `words`,按 `tag` 生成词书;wordfreq 填词频排名,CEFR-J 填 CEFR 等级。
2. 阶段 1:Open English WordNet 导入 `senses` 和 `relations`;Tatoeba 导入 `examples`;Wiktionary 导入词源和词根词缀。
3. 阶段 2 以后:NAWL、CMUdict 按题型需要导入。

## 待核对

- [ ] ECDICT 的 MIT 许可是否覆盖其中摘录的柯林斯星级和 BNC/COCA 词频字段。
- [ ] CEFR-J Wordlist 的商用条款和署名格式。
- [ ] wordfreq 数据中各语料的再分发限制。
- [ ] ECDICT 考试标签与最新大纲的差异(抽检 200 词)。

返回 [开发计划](plan.md)。
