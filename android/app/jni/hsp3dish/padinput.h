// ゲームパッド入力 (Android ネイティブ用)
// ボタン(17種)の押下状態をまとめ、HSPの getkey キーコードへ割り当てる。
// 割り当て表は CI が config/gamepad.json から生成する padmap_gen.h (未設定は -1 = 何も割り当てない)。
#ifndef HSP_PADINPUT_H
#define HSP_PADINPUT_H
#ifdef __cplusplus
extern "C" {
#endif

#define PAD_BUTTONS 17   // A B X Y LB RB LT RT BACK START L3 R3 UP DOWN LEFT RIGHT HOME (ミニインタプリタと同じ順)

// Android の KeyEvent コード → 論理ボタン番号(0-16)。パッドのボタンでなければ -1
int PadLogicalFromAndroidKey( int androidKeyCode );
// その論理ボタンに HSP キーが割り当て済みか (未割り当てならイベントを横取りしない)
int PadIsMapped( int logical );
// キーイベント: down=1/0。割り当て済みで処理したら 1
int PadKeyEvent( int androidKeyCode, int down );
// 十字キー(HAT)・トリガーのアナログ値。axisXY は -1,0,1。lt/rt は 0.0-1.0 (閾値 0.5)
void PadAxisEvent( float hatX, float hatY, float lt, float rt );
// 全ボタンを離した状態へ (フォーカスを失った時など、押しっぱなし固着の防止)
void PadReset( void );
// getkey 用: この HSP キーコードに割り当てたボタンが押されていれば 1
int PadGetKey( int hspKey );
// 診断・テスト用
int PadStateBits( void );

#ifdef __cplusplus
}
#endif
#endif
