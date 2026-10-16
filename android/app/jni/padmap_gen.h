// ゲームパッドの割り当て表 (論理ボタン → HSP の getkey キーコード。-1 = 未割り当て)
// CI が config/gamepad.json から上書き生成します。config/gamepad.json が無いビルドでは、このまま(全部未割り当て)です。
// 並び: A B X Y LB RB LT RT BACK START L3 R3 UP DOWN LEFT RIGHT HOME
static const int PAD_HSPKEY[17] = { -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1 };
