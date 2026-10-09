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
