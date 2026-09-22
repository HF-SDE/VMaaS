/**
 * @file test_main.cpp
 * @brief Host tests for everything that is not a clean coin: contact noise,
 *        solenoid spikes, inverted polarity, and pulse counts the acceptor
 *        was never programmed to emit.
 */
#include <unity.h>
#include "coin_acceptor.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

static CoinConfig danish_coins()
{
    CoinConfig cfg;
    cfg.active_low = true;
    cfg.min_pulse_ms = 15;
    cfg.train_gap_ms = 250;
    cfg.value_by_pulses[1] = 500;
    cfg.value_by_pulses[2] = 1000;
    cfg.value_by_pulses[3] = 2000;
    return cfg;
}

static void pulse(CoinAcceptor &c, uint32_t at_ms, uint32_t width_ms, bool active_low = true)
{
    c.on_edge(at_ms, !active_low);
    c.on_edge(at_ms + width_ms, active_low);
}

// A 5 ms glitch is shorter than any real coin pulse. It must not become credit.
void test_short_pulse_is_rejected()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 5);

    TEST_ASSERT_FALSE(c.tick(2000, ev));
    TEST_ASSERT_EQUAL_UINT32(1, c.rejected_pulses());
}

// The dangerous case: noise riding on a real coin would inflate its value.
void test_noise_does_not_inflate_a_real_coin()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);  // the real coin: 5 kr
    pulse(c, 1150, 3);    // a spike inside the train window

    TEST_ASSERT_TRUE(c.tick(1500, ev));
    TEST_ASSERT_EQUAL_UINT8(1, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);
    TEST_ASSERT_EQUAL_UINT32(1, c.rejected_pulses());
}

// A pulse exactly at the threshold counts; the boundary is inclusive.
void test_pulse_at_the_threshold_counts()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 15);

    TEST_ASSERT_TRUE(c.tick(1400, ev));
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);
    TEST_ASSERT_EQUAL_UINT32(0, c.rejected_pulses());
}

// Two pulses closer together than the gap are one coin, not two.
void test_pulses_inside_the_gap_are_one_train()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1240, 100);   // last edge 1340, well inside 250 ms of 1100

    TEST_ASSERT_TRUE(c.tick(1600, ev));
    TEST_ASSERT_EQUAL_UINT8(2, ev.pulses);
}

// The whole suite must work with the polarity inverted, because which way
// round it is cannot be known before the bench says so.
void test_active_high_decodes_the_same_way()
{
    CoinConfig cfg = danish_coins();
    cfg.active_low = false;
    CoinAcceptor c(cfg);
    CoinEvent ev{};

    pulse(c, 1000, 100, false);
    pulse(c, 1200, 100, false);

    TEST_ASSERT_TRUE(c.tick(1600, ev));
    TEST_ASSERT_EQUAL_UINT8(2, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(1000, ev.value_minor);
}

// OWNER DECISION default: an unrecognised count is reported with value 0 and
// counted, so the caller can decide what to do with a coin it cannot name.
void test_unrecognised_pulse_count_reports_zero_value()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1200, 100);
    pulse(c, 1400, 100);
    pulse(c, 1600, 100);   // four pulses: not in the table

    TEST_ASSERT_TRUE(c.tick(2000, ev));
    TEST_ASSERT_EQUAL_UINT8(4, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(0, ev.value_minor);
    TEST_ASSERT_EQUAL_UINT32(1, c.unknown_trains());
}

// The counter must not saturate the pulse count into a valid coin.
void test_more_pulses_than_the_maximum_stay_unrecognised()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    for (uint32_t i = 0; i < 12; ++i)
        pulse(c, 1000 + i * 200, 100);

    TEST_ASSERT_TRUE(c.tick(1000 + 12 * 200 + 400, ev));
    TEST_ASSERT_EQUAL_UINT8(COIN_MAX_PULSES, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(0, ev.value_minor);
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_short_pulse_is_rejected);
    RUN_TEST(test_noise_does_not_inflate_a_real_coin);
    RUN_TEST(test_pulse_at_the_threshold_counts);
    RUN_TEST(test_pulses_inside_the_gap_are_one_train);
    RUN_TEST(test_active_high_decodes_the_same_way);
    RUN_TEST(test_unrecognised_pulse_count_reports_zero_value);
    RUN_TEST(test_more_pulses_than_the_maximum_stay_unrecognised);
    return UNITY_END();
}
