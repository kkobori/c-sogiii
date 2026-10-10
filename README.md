# HSP native CI（本家方式）
hsp/main.hsp (UTF-8) → hspcmp → .ax → hsp3cnv → hspsource.cpp → ndkBuild → apk/aab
- hsp/ に UTF-8 で main.hsp と #include 先を置く（SJISの場合は iconv -f CP932 -t UTF-8）
- 画像などは android/app/src/main/assets/ （ルートからの相対パスで読める）
- 署名: Secrets に KEYSTORE_BASE64 / RELEASE_PASSWORD（alias は hspapp）。未設定ならテスト用鍵
- リリース時は main.hsp の debugonoff=0 にすること（Androidの保存先が /storage/emulated/0/ から本家既定のアプリ内保存へ変わる）

## 落ちた原因の確認（課題1）
アプリを一度落として、もう一度起動すると「前回の終了ログ」ダイアログが出ます。「コピー」で内容をクリップボードへ。
- Java例外 / 終了理由(Android 11+: CRASH_NATIVE, ANR, LOW_MEMORY 等) / logcat末尾(HSPERR, Fatal signal 等)
- HSPのエラー(`#Error N in line L`)は従来のダイアログに加え logcat タグ HSPERR にも出力

## MML(::mmlt::) と hsp-synth
`mmload "::mmlt::gdata/bgm/xxx.txt"` は、実行時に assets/hsp-synth.js(無改変)をWebViewで動かして合成し、WAVにして再生します。
合成結果は cache に保存され、2回目以降は即再生。`$` の位置は OpenSL のループ開始位置に設定されます(非対応端末では先頭ループ)。
tools/mml_render.js は同じ合成をPC/CIで書き出すための補助ツールです(通常は不要)。

## mmstop / mmplay / mmload の挙動(自作インタプリタ準拠)
- `mmstop` = 一時停止(再生位置を保持)。番号省略は全バンク
- `mmplay` = 一時停止中なら続きから再生。それ以外は先頭から
- `mmload` = 読み込み直し(再生位置は先頭に戻る)
- アプリを裏に回して復帰したときは、一時停止していたバンクは停止のまま、再生中だったものだけ再開

## 広告(AdMob リワード) と 戻るボタン

- `devcontrol "AdMob",18/17/16` はミニインタプリタと同じ状態機械 (Java `AdBridge`)。16 は `native_patch.sh` が `admobshow16` に置換し、結果(1/-1/-2)が出るまで待つ。
- `getreq v, SYSREQ_AD_STATUS(1000) / SYSREQ_AD_LASTTIME(1001) / SYSREQ_AD_LASTERROR(1002, 文字列) / SYSREQ_AD_CANREQUEST(1003)`。
- 設定は `config/admob.json` (無ければGoogleのテストID。CIが取り込む):
  `{"appId":"ca-app-pub-…~…","reward":"ca-app-pub-…/…","testing":true,"testDevices":[],"cooldownMinutes":3}`
- `getreq v, SYSREQ_BACKBUTTON(1004)`: 1=戻るボタンが押された(読むと消費)。スクリプトが一度でもこれを読むと、戻るボタンでアプリが終了しなくなる(読まないスクリプトは従来どおり終了)。
- いずれも実機未確認。
