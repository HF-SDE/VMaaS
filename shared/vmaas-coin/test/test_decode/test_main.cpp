/**
 * @file test_main.cpp
 * @brief Host tests for decoding one pulse train into one coin value.
 *
 * The acceptor is programmed so the pulse count identifies the coin: one
 * pulse is 5 kr, two is 10 kr, three is 20 kr. A train is only complete once
 * the line has been quiet for train_gap_ms, so every test drives tick() past
 * that boundary before expecting a value.
 */
#include <unity.h>
#include "coin_acceptor.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

// The bench calibration: pulses 1..3 are the three accepted Danish coins.
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

// Drive one active-low pulse of `width_ms` starting at `at_ms`.
static void pulse(CoinAcceptor &c, uint32_t at_ms, uint32_t width_ms)
{
    c.on_edge(at_ms, false);            // falling: the coin pulls the line low
    c.on_edge(at_ms + width_ms, true);  // rising: back to idle
}

void test_one_pulse_is_five_kroner()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);

    // Still inside the gap: the train is not closed yet.
    TEST_ASSERT_FALSE(c.tick(1200, ev));
    // Past the gap, measured from the last edge at 1100.
    TEST_ASSERT_TRUE(c.tick(1350, ev));
    TEST_ASSERT_EQUAL_UINT8(1, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);
}

void test_two_pulses_are_ten_kroner()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1200, 100);

    TEST_ASSERT_TRUE(c.tick(1600, ev));
    TEST_ASSERT_EQUAL_UINT8(2, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(1000, ev.value_minor);
}

void test_three_pulses_are_twenty_kroner()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    pulse(c, 1200, 100);
    pulse(c, 1400, 100);

    TEST_ASSERT_TRUE(c.tick(1800, ev));
    TEST_ASSERT_EQUAL_UINT8(3, ev.pulses);
    TEST_ASSERT_EQUAL_UINT32(2000, ev.value_minor);
}

// One train yields exactly one event, however many times tick() is called.
void test_a_train_is_reported_once()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);

    TEST_ASSERT_TRUE(c.tick(1400, ev));
    TEST_ASSERT_FALSE(c.tick(1500, ev));
    TEST_ASSERT_FALSE(c.tick(9000, ev));
}

// Two coins far apart are two coins, not one five-pulse train.
void test_two_coins_separated_by_more_than_the_gap()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    pulse(c, 1000, 100);
    TEST_ASSERT_TRUE(c.tick(1400, ev));
    TEST_ASSERT_EQUAL_UINT32(500, ev.value_minor);

    pulse(c, 5000, 100);
    pulse(c, 5200, 100);
    TEST_ASSERT_TRUE(c.tick(5600, ev));
    TEST_ASSERT_EQUAL_UINT32(1000, ev.value_minor);
}

// A fresh acceptor has nothing to report and no anomalies.
void test_idle_acceptor_reports_nothing()
{
    CoinAcceptor c(danish_coins());
    CoinEvent ev{};

    for (uint32_t t = 0; t < 10000; t += 500)
        TEST_ASSERT_FALSE(c.tick(t, ev));

    TEST_ASSERT_EQUAL_UINT32(0, c.rejected_pulses());
    TEST_ASSERT_EQUAL_UINT32(0, c.unknown_trains());
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_one_pulse_is_five_kroner);
    RUN_TEST(test_two_pulses_are_ten_kroner);
    RUN_TEST(test_three_pulses_are_twenty_kroner);
    RUN_TEST(test_a_train_is_reported_once);
    RUN_TEST(test_two_coins_separated_by_more_than_the_gap);
    RUN_TEST(test_idle_acceptor_reports_nothing);
    return UNITY_END();
}
