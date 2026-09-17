/**
 * @file test_main.cpp
 * @brief Host tests for the scan pass and the key map.
 *
 * Every one of the 12 switches must produce its own character, because a
 * transposed key map is the kind of bug that survives a casual bench check
 * ("the 5 works!") and then bites on slot 12. The scan-shape test pins down
 * that exactly one row is low at a time, which is what keeps a single press
 * from lighting up several columns.
 */
#include <unity.h>
#include "keypad.h"
#include "../fake_keypad_port.h"

using namespace vmaas;

static const int ROWS[4] = {14, 25, 26, 27};
static const int COLS[3] = {18, 19, 23};

void setUp() {}
void tearDown() {}

// Hold a key long enough to clear debounce and return the character it produced.
static char press_and_read(FakeKeypadPort& port, Keypad& kp, size_t r, size_t c)
{
    port.release_all();
    kp.tick(0);
    port.press(r, c);
    kp.tick(100);                               // first sight of the new raw state
    kp.tick(100 + KEYPAD_DEFAULT_DEBOUNCE_MS);  // accepted here
    KeyEvent ev{};
    if (!kp.next_event(ev))
        return '\0';
    return (ev.type == KeyEventType::Pressed) ? ev.key : '\0';
}

// All 12 switches, in layout order. A transposition shows up immediately.
void test_every_switch_maps_to_its_character()
{
    const char expected[4][3] = {
        {'1', '2', '3'},
        {'4', '5', '6'},
        {'7', '8', '9'},
        {'*', '0', '#'},
    };
    for (size_t r = 0; r < 4; ++r)
        for (size_t c = 0; c < 3; ++c)
        {
            // Fresh driver per key so a leftover active_ cannot mask a mapping bug.
            FakeKeypadPort p;
            Keypad k(p);
            k.begin(ROWS, 4, COLS, 3);
            TEST_ASSERT_EQUAL_CHAR(expected[r][c], press_and_read(p, k, r, c));
        }
}

// One scan pass must sample every column once per row: 4 rows x 3 columns.
void test_one_tick_samples_the_whole_matrix()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    port.read_col_calls = 0;
    kp.tick(0);
    TEST_ASSERT_EQUAL_INT(12, port.read_col_calls);
}

// With nothing pressed the driver must stay silent forever.
void test_idle_matrix_produces_no_events()
{
    FakeKeypadPort port;
    Keypad kp(port);
    kp.begin(ROWS, 4, COLS, 3);
    for (uint32_t t = 0; t < 500; t += 5)
        kp.tick(t);
    KeyEvent ev{};
    TEST_ASSERT_FALSE(kp.next_event(ev));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_every_switch_maps_to_its_character);
    RUN_TEST(test_one_tick_samples_the_whole_matrix);
    RUN_TEST(test_idle_matrix_produces_no_events);
    return UNITY_END();
}
