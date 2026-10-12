/*
 * hsp-web-runtime.js
 * 公式 hsp3dish.js(Emscripten出力)を起動し、セーブデータの保存(IDBFS=IndexedDB)を補強する。
 *
 * 公式の仕組み:
 *   環境変数 HSP_SYNC_DIR を設定すると、公式C++が起動時に IDBFS をマウントして IndexedDB から読み込む。
 *   bsave/bload はその仮想フォルダ内のファイルを普通に読み書きする。
 *   IndexedDBへの書き込みは FS.syncfs(false, cb) を呼んだ時に行われる。
 * このファイルが足すもの(公式C++は無改造):
 *   1) 保存フォルダへの書き込みを検知して、自動で FS.syncfs を呼ぶ(まとめ書き・直列化・失敗時リトライ)
 *   2) 書き込み前に前回の内容を <name>.bak に退避(保存の取り返しがつくように)
 *   3) 起動時: .bak からの自動復旧(本体が無い場合のみ) / 旧ミニインタプリタの localStorage からの移行
 *   4) バックアップの書き出し・読み込み、診断パネル(?diag=1)
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- 共通 */
  function b64enc(bytes) {
    var s = '', n = 0x8000;
    for (var i = 0; i < bytes.length; i += n) s += String.fromCharCode.apply(null, bytes.subarray(i, i + n));
    return root.btoa(s);
  }
  function b64dec(str) {
    var bin = root.atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function errText(e) { return (e && (e.message || e.name)) ? String(e.message || e.name) : String(e); }

  /* ------------------------------------------------------------ 保存レイヤ */
  /**
   * env: { FS, saveDir('/'なし), log(fn), toast(fn), localStorage, debounceMs, pollMs }
   * FS は Emscripten の FS オブジェクト(テストでは模擬)
   */
  function createSaveLayer(env) {
    var FS = env.FS;
    var DIR = '/' + env.saveDir;
    var PREFIX = DIR + '/';
    var log = env.log || function () {};
    var toast = env.toast || function () {};
    var LS = env.localStorage || null;
    var DEBOUNCE = env.debounceMs != null ? env.debounceMs : 1500;
    var POLL = env.pollMs != null ? env.pollMs : 4000;

    var st = {
      ready: false,      // 起動時の読み込み(populate)が成功した後だけ true。これが false の間は絶対に書き戻さない
      populated: false,
      dirty: false, syncing: false, pending: false,
      lastOk: null, lastErr: null, lastAt: 0, syncCount: 0,
      sig: '', migrated: 0, restored: 0
    };
    var timer = null, pollTimer = null, quiet = 0;   // quiet>0 の間は自分自身の書き込み(.bak等)なのでフック処理しない
    var orig = {};

    function normPath(p) {
      if (typeof p !== 'string') return '';
      if (p.charAt(0) !== '/') {
        try { p = FS.cwd().replace(/\/$/, '') + '/' + p; } catch (e) {}
      }
      return p;
    }
    function inSave(p) { return normPath(p).indexOf(PREFIX) === 0; }
    function exists(p) { try { return !!FS.analyzePath(p).exists; } catch (e) { return false; } }

    function list() {
      var names;
      try { names = FS.readdir(DIR); } catch (e) { return []; }
      var out = [];
      names.forEach(function (n) {
        if (n === '.' || n === '..') return;
        try {
          var s = FS.stat(DIR + '/' + n);
          if (FS.isFile(s.mode)) out.push({ name: n, size: s.size, mtime: s.mtime && s.mtime.getTime ? s.mtime.getTime() : +s.mtime });
        } catch (e) {}
      });
      out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      return out;
    }
    function signature() { return list().map(function (f) { return f.name + ':' + f.size + ':' + f.mtime; }).join('|'); }

    /* ---- 書き込みの検知 ---- */
    function isWriteOpen(flags) {
      if (typeof flags === 'string') return /[wa+]/.test(flags);
      return ((flags | 0) & 3) !== 0;
    }
    function isTruncOpen(flags) {
      if (typeof flags === 'string') return /w/.test(flags);
      return ((flags | 0) & 512) !== 0;   // O_TRUNC
    }
    function backupBefore(path) {
      if (/\.bak$/.test(path)) return;
      if (!exists(path)) return;
      var s = FS.stat(path);
      if (!FS.isFile(s.mode) || s.size === 0) return;
      var data = FS.readFile(path);
      quiet++;
      try { FS.writeFile(path + '.bak', data); }
      finally { quiet--; }
    }

    function markDirty(why) {
      st.dirty = true;
      if (!st.ready) return;           // 準備前は溜めるだけ(準備できたら onPopulated が判断)
      schedule(DEBOUNCE);
    }
    function schedule(ms) {
      if (timer) return;
      timer = setTimeout(function () { timer = null; flush('timer'); }, ms);
    }

    /* ---- IndexedDBへ書き出す(syncfs) ---- */
    function flush(why) {
      if (!st.ready) return false;
      if (st.syncing) { st.pending = true; return false; }
      if (!st.dirty && signature() === st.sig) return false;
      st.syncing = true; st.dirty = false;
      var sigAtStart = signature();
      var t0 = Date.now();
      var called = false;
      function done(err) {
        if (called) return; called = true;
        st.syncing = false;
        st.lastAt = Date.now();
        if (err) {
          st.lastOk = false; st.lastErr = errText(err);
          st.dirty = true;
          log('[保存] 失敗(' + why + '): ' + st.lastErr);
          toast('保存に失敗しました(再試行します)');
          schedule(5000);
        } else {
          st.lastOk = true; st.lastErr = null; st.sig = sigAtStart; st.syncCount++;
          log('[保存] 完了(' + why + ') ' + (Date.now() - t0) + 'ms / ' + list().length + 'ファイル');
          if (st.pending || st.dirty || signature() !== st.sig) { st.pending = false; schedule(300); }
        }
      }
      try { orig.syncfs.call(FS, false, done); }
      catch (e) { done(e); }
      return true;
    }
    function flushNow(why) {
      if (timer) { clearTimeout(timer); timer = null; }
      return flush(why || 'now');
    }

    /* ---- 起動時の整備 ---- */
    function restoreBaks() {
      list().forEach(function (f) {
        var m = /^(.+)\.bak$/.exec(f.name);
        if (!m) return;
        var main = DIR + '/' + m[1];
        if (exists(main)) return;
        try {
          FS.writeFile(main, FS.readFile(DIR + '/' + f.name));
          st.restored++;
          log('[復旧] ' + m[1] + ' が無いので .bak から戻しました');
        } catch (e) { log('[復旧] 失敗 ' + m[1] + ': ' + errText(e)); }
      });
    }
    function migrateLocalStorage() {
      if (!LS) return;
      try {
        for (var i = 0; i < LS.length; i++) {
          var k = LS.key(i);
          if (!k || k.indexOf('koborisoft_') !== 0) continue;
          var name = k.slice('koborisoft_'.length);
          if (!/^[A-Za-z0-9_.\-]+\.dat$/.test(name)) continue;
          var dest = DIR + '/' + name;
          if (exists(dest)) continue;
          var bytes;
          try { bytes = b64dec(LS.getItem(k)); } catch (e) { continue; }
          if (!bytes.length || bytes.length % 4 !== 0) { log('[移行] ' + name + ' は形式が合わないので飛ばしました'); continue; }
          FS.writeFile(dest, bytes);
          st.migrated++;
          log('[移行] localStorage から ' + name + ' (' + bytes.length + 'B)');
        }
      } catch (e) { log('[移行] 失敗: ' + errText(e)); }
    }
    function onPopulated(err) {
      st.populated = true;
      if (err) {
        st.ready = false; st.lastOk = false; st.lastErr = 'IndexedDB読込失敗: ' + errText(err);
        log('[保存] 起動時の読み込みに失敗: ' + errText(err) + ' → この回は保存されません');
        toast('保存機能が使えません(この回の進行は保存されません)');
        return;
      }
      st.sig = signature();              // IndexedDBから読み込んだ直後の状態(=保存済み)
      quiet++; try { restoreBaks(); migrateLocalStorage(); } finally { quiet--; }
      st.ready = true;
      log('[保存] 準備完了: ' + list().length + 'ファイル読み込み済み');
      if (st.migrated || st.restored) { st.dirty = true; schedule(300); }
      if (!pollTimer) pollTimer = setInterval(function () {
        if (!st.ready || st.syncing) return;
        if (signature() !== st.sig) { st.dirty = true; schedule(DEBOUNCE); }
      }, POLL);
    }

    /* ---- FS への差し込み ---- */
    function install() {
      orig.open = FS.open; orig.close = FS.close; orig.unlink = FS.unlink; orig.rename = FS.rename; orig.syncfs = FS.syncfs;

      FS.open = function (path, flags) {
        try {
          if (!quiet && typeof path === 'string' && isWriteOpen(flags) && inSave(path)) backupBefore(normPath(path));
        } catch (e) { log('[bak] 退避失敗: ' + errText(e)); }
        return orig.open.apply(FS, arguments);
      };
      FS.close = function (stream) {
        var p = stream && stream.path, w = stream && isWriteOpen(stream.flags);
        var r = orig.close.apply(FS, arguments);
        if (!quiet && w && p && inSave(p)) markDirty('close');
        return r;
      };
      FS.unlink = function (path) {
        var r = orig.unlink.apply(FS, arguments);
        if (typeof path === 'string' && inSave(path)) markDirty('unlink');
        return r;
      };
      FS.rename = function (a, b) {
        var r = orig.rename.apply(FS, arguments);
        if ((typeof a === 'string' && inSave(a)) || (typeof b === 'string' && inSave(b))) markDirty('rename');
        return r;
      };
      // 公式C++が起動時に呼ぶ FS.syncfs(true, cb) の完了を捉える(HSPが動き出す前に整備を済ませる)
      FS.syncfs = function (populate, cb) {
        if (typeof populate === 'function') { cb = populate; populate = false; }
        if (populate === true) {
          return orig.syncfs.call(FS, true, function (err) {
            try { onPopulated(err); } catch (e) { log('[保存] 起動時整備で例外: ' + errText(e)); }
            if (cb) return cb(err);
          });
        }
        return orig.syncfs.call(FS, populate, cb);
      };
      log('[保存] FS にフックを入れました (保存先 ' + DIR + ')');
    }

    /* ---- バックアップ書き出し/読み込み ---- */
    function exportAll() {
      var files = {};
      list().forEach(function (f) { files[f.name] = b64enc(FS.readFile(DIR + '/' + f.name)); });
      return { format: 'hsp-web-save', version: 1, saveDir: env.saveDir, created: new Date().toISOString(), files: files };
    }
    function importAll(obj) {
      if (!obj || obj.format !== 'hsp-web-save' || !obj.files) throw new Error('バックアップファイルの形式が違います');
      if (!st.ready) throw new Error('保存の準備ができていません');
      var n = 0;
      Object.keys(obj.files).forEach(function (name) {
        if (!/^[A-Za-z0-9_.\-]+$/.test(name) || name.charAt(0) === '.') return;
        FS.writeFile(DIR + '/' + name, b64dec(obj.files[name]));   // FS.open フック経由なので現在の内容は .bak に退避される
        n++;
      });
      markDirty('import'); flushNow('import');
      return n;
    }
    function restoreFromBak(name) {
      var bak = DIR + '/' + name + '.bak';
      if (!exists(bak)) throw new Error(name + '.bak がありません');
      FS.writeFile(DIR + '/' + name, FS.readFile(bak));              // 現在の内容は(フック経由で).bak に入れ替わる
      markDirty('restore'); flushNow('restore');
    }
    function stop() { if (timer) clearTimeout(timer); if (pollTimer) clearInterval(pollTimer); timer = pollTimer = null; }

    return {
      install: install, state: st, list: list, signature: signature, flush: flush, flushNow: flushNow,
      exportAll: exportAll, importAll: importAll, restoreFromBak: restoreFromBak, stop: stop, dir: DIR,
      _onPopulated: onPopulated
    };
  }

  root.HspWeb = { createSaveLayer: createSaveLayer, b64enc: b64enc, b64dec: b64dec };
  if (root.__HSP_WEB_NOBOOT || typeof document === 'undefined') return;

  /* ================================================================ 起動処理(ブラウザ専用) */
  var V = root.__HSP_BUILD || 'dev';
  var Q = new URLSearchParams(location.search);
  var LOGS = [];
  var $ = function (id) { return document.getElementById(id); };
  var el = { boot: $('boot'), msg: $('bootMsg'), bar: $('bootBar'), btn: $('bootBtn'), canvas: $('canvas') };
  var layer = null, cfg = null, Module = null;

  function log(s) {
    var line = '[' + new Date().toLocaleTimeString() + '] ' + s;
    LOGS.push(line); if (LOGS.length > 600) LOGS.shift();
    try { console.log(s); } catch (e) {}
    if (diagOpen) renderDiag();
  }
  function toast(s) {
    var t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = s; t.className = 'show';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, 3500);
  }
  function setBoot(msg, pct) {
    if (el.msg) el.msg.textContent = msg;
    if (el.bar && pct != null) el.bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  function fatal(msg) {
    log('[致命] ' + msg);
    if (el.boot) el.boot.style.display = 'flex';
    if (el.btn) el.btn.style.display = 'none';
    if (el.msg) { el.msg.textContent = msg; el.msg.style.color = '#ff8a8a'; }
    var rb = $('bootReload'); if (rb) rb.style.display = 'inline-block';
    var bl = $('bootLog'); if (bl) { bl.style.display = 'block'; bl.textContent = LOGS.slice(-25).join('\n'); }
  }
  root.addEventListener('error', function (e) { log('[error] ' + (e && e.message) + ' @' + (e && e.filename) + ':' + (e && e.lineno)); });
  root.addEventListener('unhandledrejection', function (e) { log('[reject] ' + errText(e && e.reason)); });

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
      return r.json();
    });
  }
  // ファイル取得。1回目: 通常 / 2回目: キャッシュを無視(壊れたキャッシュ対策) / 3回目: 保存もしない
  var FETCH_MODES = [['default', ''], ['reload', '&r='], ['no-store', '&n=']];
  function fetchBytesOnce(url, mode, onProgress) {
    return fetch(url, { cache: mode }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
      var total = +r.headers.get('content-length') || 0;
      if (!r.body || !r.body.getReader || !total) return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      var reader = r.body.getReader(), chunks = [], got = 0;
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) {
            if (got !== total) throw new Error('サイズ不一致 ' + got + '/' + total);
            var out = new Uint8Array(got), o = 0;
            chunks.forEach(function (c) { out.set(c, o); o += c.length; });
            return out;
          }
          chunks.push(x.value); got += x.value.length; if (onProgress) onProgress(got, total);
          return pump();
        });
      })();
    });
  }
  function fetchBytes(url, onProgress) {
    var base = url + (url.indexOf('?') < 0 ? '?v=' + V : '');
    var errs = [];
    var forced = Q.get('nocache') === '1' ? 1 : 0;
    function attempt(i) {
      if (i >= FETCH_MODES.length) return Promise.reject(new Error(url.split('?')[0] + ' を取得できません: ' + errs.join(' / ')));
      var m = FETCH_MODES[i];
      return fetchBytesOnce(base + (m[1] ? m[1] + Date.now() : ''), m[0], onProgress).catch(function (e) {
        var t = '(' + m[0] + ') ' + errText(e); errs.push(t);
        log('[取得失敗] ' + url.split('?')[0] + ' ' + t);
        return attempt(i + 1);
      });
    }
    return attempt(forced);
  }

  function mkdirp(FS, dir) {
    if (FS.mkdirTree) { try { FS.mkdirTree(dir); return; } catch (e) {} }
    var cur = '';
    dir.split('/').forEach(function (p) { if (!p) return; cur += '/' + p; try { FS.mkdir(cur); } catch (e) {} });
  }

  function loadAssets(FS) {
    setBoot('素材を読み込み中…', 30);
    return fetchJson('assets.json?v=' + V).then(function (idx) {
      return fetchBytes('assets.pack', function (g, t) { setBoot('素材を読み込み中… ' + Math.round(g / 1024) + 'KB', 30 + 35 * g / t); })
        .then(function (pack) {
          if (pack.length !== idx.size) throw new Error('assets.pack のサイズが一致しません(' + pack.length + ' / ' + idx.size + ')。キャッシュ違いの可能性があります');
          setBoot('素材を展開中…', 68);
          idx.files.forEach(function (f) {
            var path = '/' + f.p, dir = path.replace(/\/[^\/]*$/, '');
            if (dir) mkdirp(FS, dir);
            FS.writeFile(path, pack.subarray(f.o, f.o + f.s));
          });
          log('[素材] ' + idx.files.length + 'ファイルを展開');
        });
    }).then(function () {
      setBoot('プログラムを読み込み中…', 80);
      return fetchBytes(cfg.ax);
    }).then(function (ax) {
      FS.writeFile('/' + cfg.ax, ax);
      log('[ax] ' + cfg.ax + ' ' + ax.length + 'B');
    });
  }

  function fit() {
    var c = el.canvas; if (!c || !cfg) return;
    var w = root.innerWidth, h = root.innerHeight;
    var s = Math.min(w / cfg.wx, h / cfg.wy);
    c.style.width = Math.floor(cfg.wx * s) + 'px';
    c.style.height = Math.floor(cfg.wy * s) + 'px';
  }

  var mml = null;
  function prepareMml(FS) {
    if (!root.MmlEngine || !root.HspSynth) { log('[MML] hsp-synth.js / mml-engine.js なし → MMLは無音'); return Promise.resolve(); }
    mml = root.MmlEngine.create({
      log: log, toast: toast,
      readText: function (p) {
        var c = [p, '/' + p.replace(/^\/+/, '')];
        for (var i = 0; i < c.length; i++) { try { return new TextDecoder('utf-8').decode(FS.readFile(c[i])); } catch (e) {} }
        return null;
      }
    });
    Module.hspDevControl = mml.devcontrol;
    root.__hspMml = mml;
    var list = cfg.mml || [];
    if (!list.length) return Promise.resolve();
    return mml.prepare(list, function (i, n, p) { setBoot('音楽を準備中… ' + i + '/' + n, 90 + 9 * i / n); }).then(function (st) {
      log('[MML] 準備完了 ok=' + st.loaded + ' 失敗=' + st.failed + ' 合成時間=' + st.synthMs + 'ms');
      if (st.failed) toast('一部の曲を準備できませんでした(無音になります)');
    });
  }
  document.addEventListener('visibilitychange', function () { if (mml) mml.onVisibility(document.hidden); });
  // iOS等で音が止められたときの保険: 画面を触るたびに再開を試みる
  ['pointerdown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, function () { if (mml && el.boot.style.display === 'none') mml.unlock(); }, { passive: true }); });

  function setupModule() {
    Module = {
      canvas: el.canvas,
      arguments: [cfg.ax],
      locateFile: function (p) { return p + '?v=' + V; },
      print: function (t) { log('[out] ' + Array.prototype.slice.call(arguments).join(' ')); },
      printErr: function (t) { log('[err] ' + Array.prototype.slice.call(arguments).join(' ')); },
      onAbort: function (w) { fatal('実行が中断されました: ' + w); },
      onExit: function (code) {
        log('[終了] code=' + code);
        if (layer) layer.flushNow('exit');
        toast('プログラムが終了しました');
      },
      preRun: [function () {
        var FS = Module.FS || root.FS, ENV = Module.ENV || root.ENV;
        if (!FS) return fatal('FS を取得できません(ビルド設定 EXPORTED_RUNTIME_METHODS に FS が必要です)');
        if (!ENV) return fatal('ENV を取得できません(ビルド設定 EXPORTED_RUNTIME_METHODS に ENV が必要です)');
        ENV.HSP_SYNC_DIR = '/' + cfg.saveDir;
        ENV.HSP_WX = String(cfg.wx); ENV.HSP_WY = String(cfg.wy);
        if (cfg.autoscale) ENV.HSP_AUTOSCALE = String(cfg.autoscale);
        if (cfg.fps) ENV.HSP_FPS = String(cfg.fps);
        if (cfg.limitStep) ENV.HSP_LIMIT_STEP = String(cfg.limitStep);
        log('[設定] ' + JSON.stringify({ saveDir: cfg.saveDir, wx: cfg.wx, wy: cfg.wy, fps: cfg.fps, limitStep: cfg.limitStep, autoscale: cfg.autoscale }));

        layer = createSaveLayer({ FS: FS, saveDir: cfg.saveDir, log: log, toast: toast, localStorage: safeLS() });
        layer.install();
        root.__hspLayer = layer;

        Module.addRunDependency('hsp-assets');
        loadAssets(FS).then(function () {
          Module.removeRunDependency('hsp-assets');
          return prepareMml(FS);
        }).then(function () {
          setBoot('準備ができました', 100);
          Module.addRunDependency('hsp-start');
          el.btn.style.display = 'inline-block';
          el.btn.onclick = function () {
            el.btn.disabled = true;
            if (mml) mml.unlock();            // 音は、このタップの中で有効にする必要がある
            el.boot.style.display = 'none';
            fit();
            Module.removeRunDependency('hsp-start');
          };
        }).catch(function (e) { fatal('読み込みに失敗: ' + errText(e)); });
      }]
    };
    root.Module = Module;
    el.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); toast('描画が中断されました。再読み込みしてください'); });
  }

  function safeLS() { try { return root.localStorage || null; } catch (e) { return null; } }

  function startPersist() {
    try {
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then(function (p) {
          if (p) { log('[保存] 永続化: 済'); return; }
          if (navigator.storage.persist) navigator.storage.persist().then(function (r) { log('[保存] 永続化の申請結果: ' + (r ? '許可' : '未許可(ブラウザ判断)')); });
        });
      }
    } catch (e) {}
  }

  /* ---- 診断パネル(?diag=1) ---- */
  var diagOpen = false;
  function renderDiag() {
    if (!$('diagInfo')) return;
    var s = layer ? layer.state : null, files = layer ? layer.list() : [];
    var lines = [];
    lines.push('build: ' + V);
    lines.push('保存先: ' + (cfg ? '/' + cfg.saveDir : '-') + '  準備: ' + (s ? (s.ready ? 'OK' : (s.populated ? '失敗' : '待機中')) : '-'));
    if (s) lines.push('最後の保存: ' + (s.lastAt ? new Date(s.lastAt).toLocaleTimeString() + (s.lastOk ? ' 成功' : ' 失敗 ' + (s.lastErr || '')) : 'まだ無し') + ' / 回数 ' + s.syncCount + (s.dirty ? ' / 未保存あり' : ''));
    if (s && (s.migrated || s.restored)) lines.push('移行 ' + s.migrated + '件 / 復旧 ' + s.restored + '件');
    lines.push('ファイル ' + files.length + '件:');
    files.forEach(function (f) { lines.push('  ' + f.name + '  ' + f.size + 'B  ' + new Date(f.mtime).toLocaleString()); });
    $('diagInfo').textContent = lines.join('\n');
    $('diagLog').value = LOGS.slice(-200).join('\n');
  }
  function buildDiag() {
    var b = document.createElement('button'); b.id = 'diagBtn'; b.textContent = '⚙'; document.body.appendChild(b);
    var d = document.createElement('div'); d.id = 'diag';
    d.innerHTML = '<div id="diagHead"><b>診断</b><button id="diagClose">閉じる</button></div>' +
      '<pre id="diagInfo"></pre>' +
      '<div id="diagBtns"><button id="dgSave">今すぐ保存</button><button id="dgExp">バックアップ書き出し</button>' +
      '<button id="dgImp">バックアップ読み込み</button><button id="dgBak">.bakから戻す</button><button id="dgCopy">ログをコピー</button></div>' +
      '<input id="dgFile" type="file" accept=".json,application/json" style="display:none">' +
      '<textarea id="diagLog" readonly></textarea>';
    document.body.appendChild(d);
    b.onclick = function () { diagOpen = true; d.style.display = 'block'; renderDiag(); };
    $('diagClose').onclick = function () { diagOpen = false; d.style.display = 'none'; };
    $('dgSave').onclick = function () { if (!layer) return; var r = layer.flushNow('manual'); toast(r ? '保存を開始しました' : '保存するものはありません'); setTimeout(renderDiag, 600); };
    $('dgExp').onclick = function () {
      try {
        var obj = layer.exportAll(), blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = cfg.saveDir + '_backup_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 3000);
        toast(Object.keys(obj.files).length + 'ファイルを書き出しました');
      } catch (e) { toast('書き出し失敗: ' + errText(e)); }
    };
    $('dgImp').onclick = function () { $('dgFile').click(); };
    $('dgFile').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { var n = layer.importAll(JSON.parse(rd.result)); toast(n + 'ファイルを読み込みました。再読み込みしてください'); }
        catch (e) { toast('読み込み失敗: ' + errText(e)); }
        renderDiag();
      };
      rd.readAsText(f);
    };
    $('dgBak').onclick = function () {
      if (!layer) return;
      var baks = layer.list().filter(function (f) { return /\.bak$/.test(f.name); });
      if (!baks.length) return toast('.bak はまだありません');
      var names = baks.map(function (f) { return f.name.replace(/\.bak$/, ''); });
      var pick = root.prompt('どのファイルを1つ前の状態に戻しますか?\n' + names.join('\n'), names[0]);
      if (!pick) return;
      try { layer.restoreFromBak(pick); toast(pick + ' を戻しました。再読み込みしてください'); } catch (e) { toast('失敗: ' + errText(e)); }
      renderDiag();
    };
    $('dgCopy').onclick = function () {
      var t = $('diagLog'); t.value = LOGS.join('\n'); t.select();
      try { document.execCommand('copy'); toast('ログをコピーしました'); } catch (e) { toast('コピーできませんでした(手動で選択してください)'); }
    };
    setInterval(function () { if (diagOpen) renderDiag(); }, 1000);
  }

  /* ---- 起動 ---- */
  document.addEventListener('visibilitychange', function () { if (document.hidden && layer) layer.flushNow('hidden'); });
  root.addEventListener('pagehide', function () { if (layer) layer.flushNow('pagehide'); });
  root.addEventListener('resize', fit);
  root.addEventListener('orientationchange', function () { setTimeout(fit, 200); });

  if (Q.get('diag') === '1') buildDiag();
  log('[起動] build=' + V + ' ' + location.href);
  startPersist();

  fetchJson('webconfig.json?v=' + V).then(function (c) {
    cfg = c;
    ['wx', 'wy', 'fps', 'autoscale'].forEach(function (k) { if (Q.get(k) !== null && Q.get(k) !== '') cfg[k] = parseInt(Q.get(k), 10) || 0; });
    if (Q.get('step')) cfg.limitStep = parseInt(Q.get('step'), 10) || cfg.limitStep;
    if (!cfg.wx || !cfg.wy) { cfg.wx = 480; cfg.wy = 800; }
    document.title = cfg.title || document.title;
    fit();
    setupModule();
    setBoot('エンジンを読み込み中…', 2);
    var prog = function (label, lo, hi) { return function (g, t) { setBoot(label + ' ' + Math.round(g / 1024) + 'KB', lo + (hi - lo) * g / t); }; };
    return fetchBytes('hsp3dish.js', prog('エンジンを読み込み中…', 2, 8)).then(function (js) {
      var head = new TextDecoder('utf-8').decode(js.subarray(0, 64)).trim().toLowerCase();
      if (js.length < 2000 || head.indexOf('<') === 0) throw new Error('hsp3dish.js の中身が不正です(' + js.length + 'B。サーバーのエラーページかもしれません)');
      return fetchBytes('hsp3dish.wasm', prog('エンジンを読み込み中…', 8, 30)).then(function (wasm) {
        if (wasm.length < 1000 || wasm[0] !== 0 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) throw new Error('hsp3dish.wasm の中身が不正です(' + wasm.length + 'B)');
        Module.wasmBinary = wasm.buffer;     // 自分で取得したものを渡す(サーバーの配信種別・キャッシュの影響を受けない)
        log('[エンジン] js ' + js.length + 'B / wasm ' + wasm.length + 'B');
        var url = URL.createObjectURL(new Blob([js], { type: 'application/javascript' }));
        var s = document.createElement('script');
        s.src = url; s.async = true;
        s.onerror = function () { fatal('エンジンの実行を開始できませんでした(hsp3dish.js)'); };
        document.body.appendChild(s);
      });
    });
  }).catch(function (e) { fatal(errText(e)); });

})(typeof window !== 'undefined' ? window : globalThis);
