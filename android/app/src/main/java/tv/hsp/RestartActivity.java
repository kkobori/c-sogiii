package tv.hsp;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * アプリの再起動用(マニフェストで別プロセス ":restart" に置く)。
 * 本体のプロセスを止めてから、起動用の Intent を投げ直す。本体と同じプロセスだと、
 * 起動し直した画面まで一緒に止めてしまうため、別プロセスで行う(ProcessPhoenix と同じ方式)。
 */
public class RestartActivity extends Activity {
    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        try {
            Intent in = getIntent();
            int pid = in.getIntExtra("pid", -1);
            Intent next = (Intent) in.getParcelableExtra("next");
            if (pid > 0) android.os.Process.killProcess(pid);
            if (next != null) startActivity(next);
        } catch (Throwable t) {
            android.util.Log.w("HSPSAVE", "RestartActivity: " + t);
        }
        finish();
        Runtime.getRuntime().exit(0);
    }
}
