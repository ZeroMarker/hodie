#!/usr/bin/env bash
# 下载词库原始数据到 data/raw,并校验 sha256。来源与许可见 docs/vocab-sources.md。
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p data/raw
cd data/raw

CEFRJ=https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master
fetch() { [ -s "$1" ] || curl -fsSL -A Mozilla -o "$1" "$2"; }

fetch ecdict.csv https://github.com/skywind3000/ECDICT/raw/master/ecdict.csv
fetch cefrj-vocabulary-profile-1.5.csv "$CEFRJ/cefrj-vocabulary-profile-1.5.csv"
fetch octanove-vocabulary-profile-c1c2-1.0.csv "$CEFRJ/octanove-vocabulary-profile-c1c2-1.0.csv"
fetch ngsl_stats.csv https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv
fetch english-wordnet-2025.xml.gz https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz

# Tatoeba 每周重新导出,不固定校验和;删掉旧文件即可更新
TATOEBA=https://downloads.tatoeba.org/exports/per_language
fetch eng_sentences_detailed.tsv.bz2 "$TATOEBA/eng/eng_sentences_detailed.tsv.bz2"
fetch cmn_sentences_detailed.tsv.bz2 "$TATOEBA/cmn/cmn_sentences_detailed.tsv.bz2"
fetch eng-cmn_links.tsv.bz2 "$TATOEBA/eng/eng-cmn_links.tsv.bz2"

sha256sum -c <<'SUMS'
1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf  ecdict.csv
b0dd3c635f1c9a4fdf1490c7e5b7c48e8bbe55b652ad0c9860a95f98e10ae498  cefrj-vocabulary-profile-1.5.csv
18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380  octanove-vocabulary-profile-c1c2-1.0.csv
2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44  ngsl_stats.csv
9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe  english-wordnet-2025.xml.gz
SUMS
