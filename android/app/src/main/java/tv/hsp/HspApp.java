package tv.hsp;

import android.app.Application;
import android.content.Context;
import android.os.Build;
import android.webkit.WebView;

/**
 * Application。別プロセス(":restart" = バックアップ取り込み後の再起動用の中継画面)でだけ、WebView のデータ置き場を分ける。
 * AdMob SDK は起動時にどのプロセスでも初期化されるが、WebView を複数プロセスで同じ置き場のまま使うと
 * 「Using WebView from more than one process」で落ちるため。本体のプロセスには何もしない。
 * attachBaseContext は、ContentProvider(AdMob の自動初期化)より前に呼ばれる。
 */
public class HspApp extends Application {
    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                String pn = Application.getProcessName();
                if (pn != null && pn.endsWith(":restart")) WebView.setDataDirectorySuffix("restart");
            } catch (Throwable t) { /* 無視(本体の動作には影響しない) */ }
        }
    }
}
