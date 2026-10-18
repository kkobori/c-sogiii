package tv.hsp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;

/**
 * ユーザー向けのセーブデータ バックアップ画面。ゲームから
 *     devcontrol "backup::sog3sd*.dat::", slotmax [, size]
 * と呼ばれたときに開く(HSP側では native_patch.sh が backupshow に置き換え、閉じるまで待つ)。
 *
 *  - 対象は、パターンに合うスロットのファイルだけ(BackupSpec)。それ以外は一覧にも出ず、読み書きもできない。
 *  - 取り込みは「スロットを選ぶ」方式。選んだファイルの名前は問わない(端末側で名前が変わっても取り込める)。
 *  - 取り込んだあとは、元の内容を .bak に退避したうえで、アプリを自動で再起動する。
 *  - 画面が開いている間 poll() が 2 を返す。閉じると 0。
 * 指3本長押しのデバッグ用画面(SaveTools)とは別物。
 */
public class BackupWindow {
    private static final String TAG = "HSPSAVE";
    private static final int RC_EXPORT_ONE = 0x5A21, RC_IMPORT_ONE = 0x5A22, RC_EXPORT_ALL = 0x5A23, RC_IMPORT_ALL = 0x5A24;

    private static volatile boolean active = false;
    private static BackupSpec spec = null;
    private static AlertDialog panel = null;
    private static int pendingSlot = -1;

    /** HSP(ネイティブスレッド)から。0=開いた / -1=書き方が不正 */
    public static int open(final Activity act, String cmd, int slotmax, int size) {
        BackupSpec s = BackupSpec.parse(cmd, slotmax, size);
        if (s == null) {
            Log.w(TAG, "backup: 書き方が不正です cmd=" + cmd + " slotmax=" + slotmax + " size=" + size);
            return -1;
        }
        if (active) return 0;
        spec = s;
        active = true;
        act.runOnUiThread(new Runnable() {
            public void run() {
                try { showPanel(act); }
                catch (Throwable t) { Log.w(TAG, "backup showPanel: " + t); finishWindow(); }
            }
        });
        return 0;
    }

    /** 2=画面を表示中 / 0=閉じている */
    public static int poll() { return active ? 2 : 0; }
    public static boolean isActive() { return active; }

    private static void finishWindow() {
        active = false;
        spec = null;
        pendingSlot = -1;
        panel = null;
    }

    private static void closePanel() {
        try { if (panel != null) panel.dismiss(); } catch (Throwable t) { /* 無視 */ }
        panel = null;
    }

    /* ------------------------------------------------------------ 画面 */
    private static void showPanel(final Activity act) {
        if (!active || spec == null) return;
        if (panel != null && panel.isShowing()) return;
        final BackupSpec sp = spec;

        LinearLayout root = new LinearLayout(act);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(SaveTools.dp(act, 14), SaveTools.dp(act, 12), SaveTools.dp(act, 14), SaveTools.dp(act, 6));
        root.setBackgroundColor(0xFF1A212B);

        root.addView(SaveTools.label(act, "セーブデータのバックアップ", 18, Color.WHITE));
        root.addView(SaveTools.label(act, "読み込みのあとは、アプリが自動で再起動します。", 12, 0xFF93A1B3));

        root.addView(SaveTools.button(act, "全部まとめて書き出し", new View.OnClickListener() { public void onClick(View v) { startExportAll(act); } }));
        root.addView(SaveTools.button(act, "全部まとめて読み込み", new View.OnClickListener() { public void onClick(View v) { startPick(act, RC_IMPORT_ALL); } }));

        TextView head = SaveTools.label(act, "スロット(0〜" + (sp.slotmax - 1) + ")", 13, 0xFF93A1B3);
        head.setPadding(0, SaveTools.dp(act, 12), 0, SaveTools.dp(act, 2));
        root.addView(head);

        SimpleDateFormat df = new SimpleDateFormat("MM/dd HH:mm", Locale.US);
        for (int i = 0; i < sp.slotmax; i++) {
            final int slot = i;
            final String name = sp.name(i);
            File f = new File(act.getFilesDir(), name);
            boolean has = f.isFile();
            LinearLayout row = new LinearLayout(act);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            String info = has ? (f.length() + "B  " + df.format(new Date(f.lastModified()))) : "(空)";
            TextView t = SaveTools.label(act, name + "\n" + info, 12, has ? Color.WHITE : 0xFF6B7A8C);
            row.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            Button b1 = SaveTools.button(act, "書き出し", new View.OnClickListener() { public void onClick(View v) { startExportOne(act, slot); } });
            b1.setEnabled(has);
            row.addView(b1);
            row.addView(SaveTools.button(act, "読み込み", new View.OnClickListener() { public void onClick(View v) { pendingSlot = slot; startPick(act, RC_IMPORT_ONE); } }));
            root.addView(row);
        }

        ScrollView sv = new ScrollView(act);
        sv.addView(root);
        panel = new AlertDialog.Builder(act).setView(sv)
            .setNegativeButton("閉じる", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) { finishWindow(); }
            })
            .setOnCancelListener(new DialogInterface.OnCancelListener() {
                public void onCancel(DialogInterface d) { finishWindow(); }
            }).create();
        panel.setCanceledOnTouchOutside(false);
        panel.show();
    }

    /* ------------------------------------------------------------ SAF の呼び出し */
    private static void startExportOne(Activity act, int slot) {
        try {
            String name = spec.name(slot);
            if (name == null || !new File(act.getFilesDir(), name).isFile()) { SaveTools.toast(act, "スロット " + slot + " は空です"); return; }
            pendingSlot = slot;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(SaveTools.mimeFor(name));
            i.putExtra(Intent.EXTRA_TITLE, name);
            closePanel();
            act.startActivityForResult(i, RC_EXPORT_ONE);
        } catch (Throwable t) { SaveTools.toast(act, "書き出しを開始できません: " + t.getMessage()); showPanel(act); }
    }

    private static void startExportAll(Activity act) {
        try {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, act.getPackageName() + "_backup_" + SaveTools.stamp("yyyyMMdd_HHmmss", false) + ".json");
            closePanel();
            act.startActivityForResult(i, RC_EXPORT_ALL);
        } catch (Throwable t) { SaveTools.toast(act, "書き出しを開始できません: " + t.getMessage()); showPanel(act); }
    }

    private static void startPick(Activity act, int rc) {
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            closePanel();
            act.startActivityForResult(i, rc);
        } catch (Throwable t) { SaveTools.toast(act, "ファイル選択を開始できません: " + t.getMessage()); showPanel(act); }
    }

    /* ------------------------------------------------------------ 結果の受け取り(HspActivity.onActivityResult から) */
    public static boolean onResult(final Activity act, int rc, int res, Intent data) {
        if (rc < RC_EXPORT_ONE || rc > RC_IMPORT_ALL) return false;
        if (!active || spec == null) return true;             // 画面はもう閉じている(状態が失われた)
        final BackupSpec sp = spec;
        if (res != Activity.RESULT_OK || data == null) { showPanel(act); return true; }
        try {
            if (rc == RC_EXPORT_ONE) {
                int slot = pendingSlot; pendingSlot = -1;
                String name = sp.name(slot);
                if (name == null) throw new IOException("対象のスロットが不明です");
                byte[] b = SaveTools.readFile(new File(act.getFilesDir(), name));
                SaveTools.writeUri(act, data.getData(), b);
                SaveTools.toast(act, name + " を書き出しました (" + b.length + "B)");
                showPanel(act);
            } else if (rc == RC_EXPORT_ALL) {
                JSONObject files = new JSONObject();
                int n = 0;
                for (int i = 0; i < sp.slotmax; i++) {
                    File f = new File(act.getFilesDir(), sp.name(i));
                    if (!f.isFile()) continue;
                    files.put(f.getName(), Base64.encodeToString(SaveTools.readFile(f), Base64.NO_WRAP));
                    n++;
                }
                JSONObject o = new JSONObject();
                o.put("format", "hsp-web-save"); o.put("version", 1); o.put("saveDir", "android");
                o.put("pattern", sp.pattern); o.put("slotmax", sp.slotmax); o.put("size", sp.size);
                o.put("created", SaveTools.stamp("yyyy-MM-dd'T'HH:mm:ss'Z'", true)); o.put("files", files);
                SaveTools.writeUri(act, data.getData(), o.toString().getBytes("UTF-8"));
                SaveTools.toast(act, n + "ファイルを書き出しました");
                showPanel(act);
            } else if (rc == RC_IMPORT_ONE) {
                final int slot = pendingSlot; pendingSlot = -1;
                final String name = sp.name(slot);
                if (name == null) throw new IOException("対象のスロットが不明です");
                final Uri u = data.getData();
                final byte[] b = SaveTools.readUri(act, u);
                if (!sp.sizeOk(b.length)) {
                    String need = sp.size > 0 ? "(このゲームのセーブは " + sp.size + "B です)" : "";
                    SaveTools.toast(act, "このファイルは取り込めません。大きさが合いません: " + b.length + "B " + need);
                    showPanel(act);
                    return true;
                }
                final String shown = SaveTools.displayName(act, u);
                confirm(act, "スロット " + slot + " (" + name + ") を、「" + shown + "」の内容で上書きします。\n今の内容は " + name + ".bak に残ります。\n取り込んだあと、アプリが再起動します。", new Runnable() {
                    public void run() {
                        try { SaveTools.importBytes(act, name, b); restartApp(act); }
                        catch (Throwable t) { SaveTools.toast(act, "読み込み失敗: " + t.getMessage()); showPanel(act); }
                    }
                });
            } else if (rc == RC_IMPORT_ALL) {
                byte[] raw = SaveTools.readUri(act, data.getData());
                JSONObject o = new JSONObject(new String(raw, "UTF-8"));
                if (!"hsp-web-save".equals(o.optString("format")) || o.optJSONObject("files") == null) throw new IOException("バックアップファイルの形式が違います");
                String pat = o.optString("pattern", "");
                if (pat.length() > 0 && !pat.equals(sp.pattern)) throw new IOException("別のデータのバックアップです(" + pat + ")");
                final JSONObject files = o.getJSONObject("files");
                final java.util.ArrayList<String> okNames = new java.util.ArrayList<String>();
                final java.util.ArrayList<byte[]> okData = new java.util.ArrayList<byte[]>();
                int skipped = 0;
                for (Iterator<String> it = files.keys(); it.hasNext(); ) {
                    String k = it.next();
                    if (sp.slotOf(k) < 0) { skipped++; continue; }
                    byte[] b;
                    try { b = Base64.decode(files.getString(k), Base64.DEFAULT); } catch (Throwable t) { skipped++; continue; }
                    if (!sp.sizeOk(b.length)) { skipped++; continue; }
                    okNames.add(k); okData.add(b);
                }
                if (okNames.isEmpty()) {
                    SaveTools.toast(act, "取り込めるデータがありません" + (skipped > 0 ? "(対象外 " + skipped + "件)" : ""));
                    showPanel(act);
                    return true;
                }
                final int sk = skipped;
                confirm(act, "バックアップの " + okNames.size() + " ファイルを読み込みます" + (sk > 0 ? "(対象外の " + sk + " 件は飛ばします)" : "") + "。\n同じスロットの今の内容は .bak に残ります。\n取り込んだあと、アプリが再起動します。", new Runnable() {
                    public void run() {
                        int done = 0;
                        for (int i = 0; i < okNames.size(); i++) {
                            try { SaveTools.importBytes(act, okNames.get(i), okData.get(i)); done++; }
                            catch (Throwable t) { Log.w(TAG, "import fail " + okNames.get(i) + ": " + t); }
                        }
                        if (done > 0) restartApp(act);
                        else { SaveTools.toast(act, "読み込みに失敗しました"); showPanel(act); }
                    }
                });
            }
        } catch (Throwable t) {
            Log.w(TAG, "backup onResult " + rc + ": " + t);
            SaveTools.toast(act, "失敗: " + t.getMessage());
            showPanel(act);
        }
        return true;
    }

    private static void confirm(final Activity act, String msg, final Runnable yes) {
        new AlertDialog.Builder(act).setMessage(msg).setCancelable(false)
            .setPositiveButton("はい", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) { yes.run(); }
            })
            .setNegativeButton("やめる", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) { showPanel(act); }
            }).show();
    }

    /** アプリを作り直す(別プロセスの RestartActivity が、このプロセスを止めてから起動し直す) */
    private static void restartApp(Activity act) {
        try {
            SaveTools.toast(act, "読み込みました。アプリを再起動します");
            Intent launch = act.getPackageManager().getLaunchIntentForPackage(act.getPackageName());
            if (launch == null) throw new IOException("起動用の情報が取得できません");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            Intent r = new Intent(act, RestartActivity.class);
            r.putExtra("next", launch);
            r.putExtra("pid", android.os.Process.myPid());
            r.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(r);
            // 以降は RestartActivity がこのプロセスを終了させる。
            // active は true のままにする: ゲームが待ち続け、止まる前に自動保存などで取り込んだデータを上書きしないため
            // (万一、再起動が起きなかったときは、固まったままにならないよう一定時間で待ちを解く)
            final Activity a = act;
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                public void run() {
                    if (!active) return;
                    SaveTools.toast(a, "再起動できませんでした。アプリを一度終了して開き直してください");
                    finishWindow();
                }
            }, 8000);
        } catch (Throwable t) {
            Log.w(TAG, "restart: " + t);
            SaveTools.toast(act, "再起動できませんでした。アプリを一度終了して開き直してください");
            finishWindow();
        }
    }
}
