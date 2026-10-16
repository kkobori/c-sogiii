#!/usr/bin/env bash
# main.hsp を本家ランタイム向けに自動調整する（元の main.hsp は hsp/main.hsp.orig に残る）
set -euo pipefail
cd "$1"
cp main.hsp main.hsp.orig
# 1) 製品モード (Androidの保存先を外部ストレージ→アプリ内へ)
# (共有ストレージ版 KEEP_DEBUGONOFF=1 のときは書き換えない: /storage/emulated/0/ へ直接読み書きする版)
if [ "${KEEP_DEBUGONOFF:-0}" != "1" ]; then
  sed -i -E 's/^([[:space:]]*debugonoff[[:space:]]*=[[:space:]]*)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp
fi
# 2) mmload -> mmloadsafe (読み込めない音源でエラー終了しない)
# (::mmlt:: のMMLは実行時に hsp-synth.js で合成するため、そのまま mmload のまま残す)
sed -i -E '/::mmlt::/!s/^([[:space:]]*)mmload([[:space:]])/\1mmloadsafe\2/' main.hsp
# 3) 画面外バッファ(gsel 1以上)への描画は本家Android(HSP3Dish)では未実装で、gcopy等がエラー21になる。
#    高速化用のキャッシュ(pdc=3D描画結果 / pmq=ミニマップ枠)は無効化して通常描画にする
sed -i -E 's/^([[:space:]]*pdcEligible=)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp
sed -i -E 's/:pmqOk=1([[:space:]]*(;.*)?)$/:pmqOk=0\1/' main.hsp
# 4) d3setcam は内部で d3wincy(=wincy) を ginfo_winy/2 に上書きする。本家の仕様どおり
#    「d3setcam の後に d3wincy を設定」する順に入れ替える (自作インタプリタでは逆順で動いていた)
sed -i -E '/^[[:space:]]*d3wincy=[0-9]+[[:space:]]*$/{N;s/^([[:space:]]*d3wincy=[0-9]+[[:space:]]*)\n([[:space:]]*d3setcam[^\n]*)$/\2\n\1/}' main.hsp
# 4b) 広告表示(16)は結果が出るまで待つ必要がある。待機つきの admobshow16 に置き換える
sed -i -E 's/devcontrol[[:space:]]+"AdMob"[[:space:]]*,[[:space:]]*16([^0-9]|$)/admobshow16\1/' main.hsp
# 5) 互換モジュールを hsp3dish.as の直後に挿入
grep -q 'native_compat.hsp' main.hsp || sed -i '0,/#include "hsp3dish.as"/s//#include "hsp3dish.as"\n#include "native_compat.hsp"/' main.hsp
# ---- 書き換え結果の見える化 (main.hsp は変更しない。実行ログと、ビルドの注釈に出す) ----
O=main.hsp.orig
cnt(){ grep -cE "$1" "$2" || true; }
R1=$(cnt '^[[:space:]]*debugonoff[[:space:]]*=[[:space:]]*1([[:space:]]*(;.*)?)$' $O)
R2=$(grep -E '^[[:space:]]*mmload[[:space:]]' $O | grep -vc '::mmlt::' || true)
R3=$(cnt '^[[:space:]]*pdcEligible=1([[:space:]]*(;.*)?)$' $O)
R4=$(cnt ':pmqOk=1([[:space:]]*(;.*)?)$' $O)
R5=$(cnt 'devcontrol[[:space:]]+"AdMob"[[:space:]]*,[[:space:]]*16([^0-9]|$)' $O)
DIFFN=$(diff $O main.hsp | grep -c '^>' || true)
D3=$(grep -B1 -E '^[[:space:]]*d3wincy=' main.hsp | grep -c d3setcam || true)
MSG="debugonoff 1→0: ${R1}行 (共有ストレージ版は対象外)%0Ammload→mmloadsafe: ${R2}行%0ApdcEligible→0: ${R3}行 / pmqOk→0: ${R4}行%0Ad3setcam/d3wincy の順序: 入れ替え後 ${D3} 組%0AAdMob 16→admobshow16: ${R5}行%0Anative_compat.hsp の読み込み: $(cnt 'native_compat.hsp' main.hsp)行%0A変わった行の合計: ${DIFFN}"
echo "::notice title=書き換え結果 (Android版 native_patch)::${MSG}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then { echo "### 書き換え結果 (Android版)"; echo "${MSG//%0A/$'\n'- }" | sed '1s/^/- /'; } >> "$GITHUB_STEP_SUMMARY"; fi
echo "patched: mmlt_kept=$(grep -c '::mmlt::' main.hsp) d3wincy_after_setcam=$(grep -B1 -E '^[[:space:]]*d3wincy=' main.hsp | grep -c d3setcam) pdcEligible0=$(grep -cE '^[[:space:]]*pdcEligible=0' main.hsp) pmqOk0=$(grep -c ':pmqOk=0' main.hsp) debugonoff=$(grep -cE '^[[:space:]]*debugonoff[[:space:]]*=[[:space:]]*0' main.hsp) admobshow16=$(grep -c admobshow16 main.hsp) backbutton_use=$(grep -ci SYSREQ_BACKBUTTON main.hsp) mmloadsafe=$(grep -c 'mmloadsafe' main.hsp)"
