# HSP native CI（本家方式）
hsp/main.hsp (UTF-8) → hspcmp → .ax → hsp3cnv → hspsource.cpp → ndkBuild → apk/aab
- hsp/ に UTF-8 で main.hsp と #include 先を置く（SJISの場合は iconv -f CP932 -t UTF-8）
- 画像などは android/app/src/main/assets/ （ルートからの相対パスで読める）
- 署名: Secrets に KEYSTORE_BASE64 / RELEASE_PASSWORD（alias は hspapp）。未設定ならテスト用鍵
- リリース時は main.hsp の debugonoff=0 にすること（Androidの保存先が /storage/emulated/0/ から本家既定のアプリ内保存へ変わる）
