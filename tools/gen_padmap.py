#!/usr/bin/env python3
"""config/gamepad.json -> android/app/jni/padmap_gen.h (ゲームパッドの割り当て表)
使い方: gen_padmap.py <config/gamepad.json> <出力 padmap_gen.h>
ファイルが無ければ何もしない(全部未割り当てのまま)。
形式: {"version":1,"keyMap":{"A":13,"DPAD_LEFT":37,...},"indexMap":{...}}
  keyMap  : ボタン名 → HSP の getkey キーコード (1-255)
  indexMap: Web の Gamepad API 用(物理ボタン番号)。Android では使わず、標準の並びで扱う
"""
import json, os, sys
NAMES = ['A','B','X','Y','LB','RB','LT','RT','BACK','START','L3','R3','DPAD_UP','DPAD_DOWN','DPAD_LEFT','DPAD_RIGHT','HOME']
src, dst = sys.argv[1], sys.argv[2]
if not os.path.exists(src):
    print("ゲームパッド設定: config/gamepad.json なし(割り当てなし)")
    sys.exit(0)
try:
    cfg = json.load(open(src, encoding='utf-8'))
    km = cfg.get('keyMap') or {}
    if not isinstance(km, dict): raise ValueError('keyMap がオブジェクトではありません')
except Exception as e:
    print("::error title=gamepad.json が読めません::%s" % str(e).replace('\n', ' '))
    sys.exit(1)
vals, lines, bad = [], [], []
for n in NAMES:
    v = km.get(n)
    if v is None or v == '':
        vals.append(-1); continue
    try:
        k = int(v)
    except (TypeError, ValueError):
        bad.append(n); vals.append(-1); continue
    if not (1 <= k <= 255):
        bad.append(n); vals.append(-1); continue
    vals.append(k); lines.append("%s→%d" % (n, k))
unknown = [k for k in km if k not in NAMES]
with open(dst, 'w', encoding='utf-8') as f:
    f.write("// config/gamepad.json から自動生成 (tools/gen_padmap.py)。手で編集しないでください\n")
    f.write("// 並び: " + " ".join(NAMES) + "\n")
    f.write("static const int PAD_HSPKEY[17] = { " + ",".join(str(v) for v in vals) + " };\n")
msg = "割り当て %d 個: %s" % (len(lines), ", ".join(lines) if lines else "なし")
if bad: msg += " / 値が不正で無視: " + ",".join(bad)
if unknown: msg += " / 不明なボタン名を無視: " + ",".join(unknown)
print("ゲームパッド設定: " + msg)
print("::notice title=ゲームパッド設定 (Android)::" + msg.replace('%','%25').replace('\n','%0A'))
