package tv.hsp;

/**
 * devcontrol "backup::パターン::", slotmax, size の解釈(Android部品に依存しない純粋なロジック)。
 *
 * パターン: 英数字・_・-・. と、ちょうど1個の * だけ。* がスロット番号(10進・ゼロ埋めなし・0〜slotmax-1)。
 *   例: "sog3sd*.dat", slotmax=20 → sog3sd0.dat 〜 sog3sd19.dat だけが対象
 * size : 0 のときはサイズを検査しない。1以上なら、その大きさのファイルだけ取り込める。
 * Web版(hsp-web-runtime.js の parseBackupSpec)と同じ規則。変えるときは両方そろえる。
 */
final class BackupSpec {
    static final int MAX_SLOTS = 256;
    static final long MAX_SIZE = 32L * 1024 * 1024;

    final String prefix, suffix, pattern;
    final int slotmax;
    final long size;   // 0 = 検査しない

    private BackupSpec(String prefix, String suffix, int slotmax, long size) {
        this.prefix = prefix; this.suffix = suffix; this.slotmax = slotmax; this.size = size;
        this.pattern = prefix + "*" + suffix;
    }

    /** 規則に合わなければ null。cmd は "backup::...::" の全体 */
    static BackupSpec parse(String cmd, int slotmax, int size) {
        if (cmd == null) return null;
        if (!cmd.startsWith("backup::") || !cmd.endsWith("::") || cmd.length() <= 10) return null;
        String body = cmd.substring(8, cmd.length() - 2);
        if (body.length() == 0 || body.charAt(0) == '.' || body.indexOf("..") >= 0) return null;
        int star = -1;
        for (int i = 0; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '*') { if (star >= 0) return null; star = i; continue; }
            boolean ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
            if (!ok) return null;
        }
        if (star < 0) return null;
        String prefix = body.substring(0, star), suffix = body.substring(star + 1);
        if (prefix.length() + suffix.length() == 0) return null;
        if (slotmax < 1 || slotmax > MAX_SLOTS) return null;
        if (size < 0 || size > MAX_SIZE) return null;
        return new BackupSpec(prefix, suffix, slotmax, size);
    }

    /** スロット i のファイル名(範囲外は null) */
    String name(int i) {
        if (i < 0 || i >= slotmax) return null;
        return prefix + i + suffix;
    }

    /** ファイル名からスロット番号。対象外の名前は -1 (05 や +5 や .bak つきは対象外) */
    int slotOf(String name) {
        if (name == null) return -1;
        if (name.length() < prefix.length() + suffix.length() + 1) return -1;
        if (!name.startsWith(prefix) || !name.endsWith(suffix)) return -1;
        String mid = name.substring(prefix.length(), name.length() - suffix.length());
        if (mid.length() == 0 || mid.length() > 3) return -1;
        for (int i = 0; i < mid.length(); i++) { char c = mid.charAt(i); if (c < '0' || c > '9') return -1; }
        if (mid.length() > 1 && mid.charAt(0) == '0') return -1;
        int n = Integer.parseInt(mid);
        return n < slotmax ? n : -1;
    }

    /** 取り込むデータの大きさが許されるか */
    boolean sizeOk(long len) {
        if (len <= 0 || len > MAX_SIZE) return false;
        return size == 0 || len == size;
    }
}
