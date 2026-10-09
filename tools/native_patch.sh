#!/usr/bin/env bash
# main.hsp を本家ランタイム向けに自動調整する（元の main.hsp は hsp/main.hsp.orig に残る）
set -euo pipefail
cd "$1"
cp main.hsp main.hsp.orig
# 1) 製品モード (Androidの保存先を外部ストレージ→アプリ内へ)
sed -i -E 's/^([[:space:]]*debugonoff[[:space:]]*=[[:space:]]*)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp
# 2) mmload -> mmloadsafe (読み込めない音源でエラー終了しない)
sed -i -E 's/^([[:space:]]*)mmload([[:space:]])/\1mmloadsafe\2/' main.hsp
# 3) 画面外バッファ(gsel 1以上)への描画は本家Android(HSP3Dish)では未実装で、gcopy等がエラー21になる。
#    高速化用のキャッシュ(pdc=3D描画結果 / pmq=ミニマップ枠)は無効化して通常描画にする
sed -i -E 's/^([[:space:]]*pdcEligible=)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp
sed -i -E 's/:pmqOk=1([[:space:]]*(;.*)?)$/:pmqOk=0\1/' main.hsp
# 4) 互換モジュールを hsp3dish.as の直後に挿入
grep -q 'native_compat.hsp' main.hsp || sed -i '0,/#include "hsp3dish.as"/s//#include "hsp3dish.as"\n#include "native_compat.hsp"/' main.hsp
echo "patched: pdcEligible0=$(grep -cE '^[[:space:]]*pdcEligible=0' main.hsp) pmqOk0=$(grep -c ':pmqOk=0' main.hsp) debugonoff=$(grep -cE '^[[:space:]]*debugonoff[[:space:]]*=[[:space:]]*0' main.hsp) mmloadsafe=$(grep -c 'mmloadsafe' main.hsp)"
