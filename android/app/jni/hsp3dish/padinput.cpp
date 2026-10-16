#include "padinput.h"
#include "../padmap_gen.h"   // static const int PAD_HSPKEY[PAD_BUTTONS]  (CI が生成。無ければ全部 -1)

// 論理ボタンの並び: A B X Y LB RB LT RT BACK START L3 R3 UP DOWN LEFT RIGHT HOME
// Android の AKEYCODE_* の値 (NDK の定数と同じ。ABIとして固定)
static const int ANDROID_KEY[PAD_BUTTONS] = {
    96,  97,  99, 100,   // BUTTON_A B X Y
    102, 103, 104, 105,  // BUTTON_L1 R1 L2 R2
    109, 108, 106, 107,  // BUTTON_SELECT START THUMBL THUMBR
    19, 20, 21, 22,      // DPAD_UP DOWN LEFT RIGHT
    110                  // BUTTON_MODE
};
enum { L_LT = 6, L_RT = 7, L_UP = 12, L_DOWN = 13, L_LEFT = 14, L_RIGHT = 15 };

static int g_keyBits = 0;    // KeyEvent 由来
static int g_axisBits = 0;   // HAT/トリガー(アナログ)由来。両方の OR が「押している」

int PadLogicalFromAndroidKey( int code ) {
    for ( int i = 0; i < PAD_BUTTONS; i++ ) if ( ANDROID_KEY[i] == code ) return i;
    return -1;
}
int PadIsMapped( int logical ) {
    return ( logical >= 0 && logical < PAD_BUTTONS && PAD_HSPKEY[logical] >= 0 ) ? 1 : 0;
}
int PadKeyEvent( int code, int down ) {
    int l = PadLogicalFromAndroidKey( code );
    if ( l < 0 || !PadIsMapped( l ) ) return 0;
    if ( down ) g_keyBits |= ( 1 << l ); else g_keyBits &= ~( 1 << l );
    return 1;
}
void PadAxisEvent( float hx, float hy, float lt, float rt ) {
    int b = 0;
    if ( hy < -0.5f ) b |= 1 << L_UP;
    if ( hy >  0.5f ) b |= 1 << L_DOWN;
    if ( hx < -0.5f ) b |= 1 << L_LEFT;
    if ( hx >  0.5f ) b |= 1 << L_RIGHT;
    if ( lt > 0.5f ) b |= 1 << L_LT;
    if ( rt > 0.5f ) b |= 1 << L_RT;
    g_axisBits = b;
}
void PadReset( void ) { g_keyBits = 0; g_axisBits = 0; }
int PadGetKey( int hspKey ) {
    int bits = g_keyBits | g_axisBits;
    if ( !bits ) return 0;
    for ( int i = 0; i < PAD_BUTTONS; i++ ) {
        if ( ( bits & ( 1 << i ) ) && PAD_HSPKEY[i] == hspKey ) return 1;
    }
    return 0;
}
int PadStateBits( void ) { return g_keyBits | g_axisBits; }
