#include <unity.h>
#include <cstring>
#include "crc8.h"

using namespace vmaas;

void setUp() {}
void tearDown() {}

void test_empty_input_is_zero()
{
    TEST_ASSERT_EQUAL_HEX8(0x00, crc8(nullptr, 0));
}

void test_single_zero_byte_is_zero()
{
    const uint8_t d[] = {0x00};
    TEST_ASSERT_EQUAL_HEX8(0x00, crc8(d, 1));
}

void test_single_one_byte_is_poly()
{
    // 0x01 shifted through 8 rounds of poly 0x07 gives 0x07.
    const uint8_t d[] = {0x01};
    TEST_ASSERT_EQUAL_HEX8(0x07, crc8(d, 1));
}

void test_standard_check_value()
{
    // Standard CRC-8 (poly 0x07, init 0, no reflection) check string.
    const char* s = "123456789";
    TEST_ASSERT_EQUAL_HEX8(0xF4, crc8(reinterpret_cast<const uint8_t*>(s), std::strlen(s)));
}

void test_run_slot_3_header()
{
    // LEN=1, CMD=RUN(0x10), payload=3. This is the CRC byte in the
    // PROTOCOL.md example frame AA 01 10 03 35.
    const uint8_t d[] = {0x01, 0x10, 0x03};
    TEST_ASSERT_EQUAL_HEX8(0x35, crc8(d, 3));
}

void test_flipping_a_bit_changes_crc()
{
    const uint8_t a[] = {0x01, 0x10, 0x03};
    const uint8_t b[] = {0x01, 0x10, 0x02};
    TEST_ASSERT_NOT_EQUAL(crc8(a, 3), crc8(b, 3));
}

int main(int, char**)
{
    UNITY_BEGIN();
    RUN_TEST(test_empty_input_is_zero);
    RUN_TEST(test_single_zero_byte_is_zero);
    RUN_TEST(test_single_one_byte_is_poly);
    RUN_TEST(test_standard_check_value);
    RUN_TEST(test_run_slot_3_header);
    RUN_TEST(test_flipping_a_bit_changes_crc);
    return UNITY_END();
}
