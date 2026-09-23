/**
 * @file test_main.cpp
 * @brief Host tests for broker_endpoint(): which of two sources wins.
 *
 * The device learns its broker address twice over: once from
 * POST /device/activate, stored in NVS, and once from config.json. Keeping the
 * broker out of the file used to be what guaranteed they could never disagree
 * (see device_config.h). Now that the file may override, the two CAN disagree,
 * so the rule that settles it is written here rather than inferred from a
 * couple of lines inside broker_client.
 */
#include <unity.h>
#include <cstring>
#include "broker_endpoint.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_the_file_wins_when_it_names_a_host_and_a_port()
{
    const BrokerEndpoint e = broker_endpoint("192.168.78.225", 8883, "localhost", 1883);
    TEST_ASSERT_EQUAL_STRING("192.168.78.225", e.host);
    TEST_ASSERT_EQUAL_UINT16(8883, e.port);
    TEST_ASSERT_TRUE(e.host_overridden);
    TEST_ASSERT_TRUE(e.port_overridden);
}

void test_activation_is_used_when_the_file_says_nothing()
{
    const BrokerEndpoint e = broker_endpoint("", 0, "broker.vmaas.dk", 8883);
    TEST_ASSERT_EQUAL_STRING("broker.vmaas.dk", e.host);
    TEST_ASSERT_EQUAL_UINT16(8883, e.port);
    TEST_ASSERT_FALSE(e.host_overridden);
    TEST_ASSERT_FALSE(e.port_overridden);
}

// The two are independent: a broker that moved address but kept its port, or
// kept its address and moved port, should need only the line that changed.
void test_a_host_override_alone_keeps_the_activation_port()
{
    const BrokerEndpoint e = broker_endpoint("192.168.78.225", 0, "localhost", 8883);
    TEST_ASSERT_EQUAL_STRING("192.168.78.225", e.host);
    TEST_ASSERT_EQUAL_UINT16(8883, e.port);
    TEST_ASSERT_TRUE(e.host_overridden);
    TEST_ASSERT_FALSE(e.port_overridden);
}

void test_a_port_override_alone_keeps_the_activation_host()
{
    const BrokerEndpoint e = broker_endpoint("", 8884, "broker.vmaas.dk", 8883);
    TEST_ASSERT_EQUAL_STRING("broker.vmaas.dk", e.host);
    TEST_ASSERT_EQUAL_UINT16(8884, e.port);
    TEST_ASSERT_FALSE(e.host_overridden);
    TEST_ASSERT_TRUE(e.port_overridden);
}

// An unactivated device has nothing in NVS. The file alone must still produce
// a usable endpoint, or a bench machine could never be pointed anywhere.
void test_the_file_alone_is_enough_when_activation_stored_nothing()
{
    const BrokerEndpoint e = broker_endpoint("192.168.78.225", 8883, "", 0);
    TEST_ASSERT_EQUAL_STRING("192.168.78.225", e.host);
    TEST_ASSERT_EQUAL_UINT16(8883, e.port);
}

// Neither source has an address: the caller must be able to tell, rather than
// being handed "" and left to dial it.
void test_an_empty_result_is_reported_as_unusable()
{
    const BrokerEndpoint e = broker_endpoint("", 0, "", 0);
    TEST_ASSERT_FALSE(e.usable);
}

void test_a_complete_result_is_reported_as_usable()
{
    const BrokerEndpoint e = broker_endpoint("", 0, "broker.vmaas.dk", 8883);
    TEST_ASSERT_TRUE(e.usable);
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_the_file_wins_when_it_names_a_host_and_a_port);
    RUN_TEST(test_activation_is_used_when_the_file_says_nothing);
    RUN_TEST(test_a_host_override_alone_keeps_the_activation_port);
    RUN_TEST(test_a_port_override_alone_keeps_the_activation_host);
    RUN_TEST(test_the_file_alone_is_enough_when_activation_stored_nothing);
    RUN_TEST(test_an_empty_result_is_reported_as_unusable);
    RUN_TEST(test_a_complete_result_is_reported_as_usable);
    return UNITY_END();
}
