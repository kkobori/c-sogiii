#!/usr/bin/env bash
# main.hsp を本家ランタイム向けに自動調整する（元の main.hsp は hsp/main.hsp.orig に残る）
set -euo pipefail
cd "$1"
cp main.hsp main.hsp.orig
# 1) 製品モード (Androidの保存先を外部ストレージ→アプリ内へ)
sed -i -E 's/^([[:space:]]*debugonoff[[:space:]]*=[[:space:]]*)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp
# 2) mmload -> mmloadsafe (読み込めない音源でエラー終了しない)
sed -i -E 's/^([[:space:]]*)mmload([[:space:]])/\1mmloadsafe\2/' main.hsp
# 3) 互換モジュールを hsp3dish.as の直後に挿入
grep -q 'native_compat.hsp' main.hsp || sed -i '0,/#include "hsp3dish.as"/s//#include "hsp3dish.as"\n#include "native_compat.hsp"/' main.hsp
echo "patched: debugonoff=$(grep -cE '^[[:space:]]*debugonoff[[:space:]]*=[[:space:]]*0' main.hsp) mmloadsafe=$(grep -c 'mmloadsafe' main.hsp)"
