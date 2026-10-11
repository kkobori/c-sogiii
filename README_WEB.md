# Web版(公式 hsp3dish.js)ビルド — 第1弾: 保存(bsave/bload)

## 仕組み
hsp/main.hsp →(web_patch.sh で最小の自動調整)→ 公式 hspcmp → main.ax
公式OpenHSP(固定コミット)を、公式の makefile.emscripten で hsp3dish.js / .wasm にビルド(Emscripten 3.1.74 = 公式CIと同じ版)。
公式C++への変更は2か所だけ: makefile の EXPORTED_RUNTIME_METHODS に FS,ENV を足す / sysreq.cpp の getreq に範囲チェックを足す。
保存: 公式の HSP_SYNC_DIR(IDBFS)に乗せる。web/hsp-web-runtime.js が自動保存・.bak退避・復旧・旧localStorageからの移行を行う。

## 使い方(スマホだけ)
1. 新しいプッシャー(hsp_native_pusher_v2.html)を開く。
2. ⓪「ビルド対象」で Web を選ぶ。①のトークン等はそのまま。
3. ④「プロジェクトZIP」に hsp-web-ci.zip を選び「反映してビルド」を押す(初回は web.yml なども反映される)。
4. 成功すると <アプリ名>-web.zip が保存される。失敗したら、画面に出た「失敗ステップ」と「理由」を教えてください。
5. zip を解凍して、サーバーのテスト用フォルダ(例: https://koborisoft.com/sogiii_test/)に中身をそのまま置く。
   - index.html / hsp-web-runtime.js / hsp3dish.js / hsp3dish.wasm / main.ax / assets.* / webconfig.json を同じ場所に。
6. スマホで https://koborisoft.com/sogiii_test/?diag=1 を開く。右上の ⚙ で保存状態とログが見える。

## 確認してほしいこと(未確認の項目)
- 起動して、タイトル〜ゲームが動くか(画面サイズ・タッチ・速度)
- セーブ → ページを閉じて開き直し → ロード で復元できるか(⚙ の「ファイル」に sog3sd〇.dat が出るか)
- 旧ミニインタプリタと同じ koborisoft.com で以前セーブしていた場合、起動時に自動移行されるか(⚙ の「移行 N件」)
- 動作が遅い/止まるとき: URLに ?step=60000 を付ける、?wx=480&wy=800 を付ける、などで試せる(ビルド不要)
- 読み込みに失敗する端末向け: ?nocache=1 を付けるとキャッシュを使わず取得する。失敗時は画面に理由とログが出る

## 注意
- 保存先の名前(IndexedDB)は <saveDir> で決まる。変えると別の保存場所になる(config/web.json の saveDir)。
- 同じ koborisoft.com 内の別アプリと保存場所が重ならないよう、既定はパッケージ名から作る。
- 音(MML)は第1弾では鳴らない。広告は出ない(広告なしで先へ進む)。第2弾=MML、第3弾=広告。
