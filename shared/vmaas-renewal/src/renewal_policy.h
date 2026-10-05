#pragma once
/**
 * @file renewal_policy.h
 * @brief When a machine should ask the platform for a new certificate.
 *
 * The device certificate expires (DEVICE_CERT_DAYS on the backend, 90 by
 * default). Once it has, mTLS fails on both the API and the broker and the
 * machine can only be recovered by activating it again, so it renews well
 * before that, over the connection the current certificate still opens.
 *
 * A successful renewal ends in a restart, which reads the new certificate
 * back and asks this policy again. The policy must therefore answer "no" for a
 * certificate that has only just been issued, whatever its lifetime, or a
 * short-lived certificate would renew and restart in a loop.
 *
 * Pure: no clock, no flash. Times are UTC seconds since 1970.
 */
#include <cstdint>

namespace vmaas
{
    /// A broken-down UTC time, as mbedtls_x509_time carries it. mon is 1-12.
    struct CivilTime
    {
        int year, mon, day;
        int hour, min, sec;
    };

    /// UTC seconds since 1970 for @p t. No time zone, no leap seconds.
    int64_t utc_seconds(const CivilTime& t);

    /**
     * @brief Whether a certificate valid from @p not_before to @p not_after
     *        should be renewed at @p now.
     *
     * Due once two thirds of its lifetime have passed: 30 days before expiry
     * for the default 90-day certificate. A share of the lifetime rather than
     * a fixed number of days, so a short-lived certificate (a bench test with
     * a low DEVICE_CERT_DAYS) is not due the moment it is issued. A clock that
     * reads earlier than @p not_before makes it not due; an empty or inverted
     * window is always due.
     */
    bool should_renew(int64_t now, int64_t not_before, int64_t not_after);

    /**
     * @brief Seconds from @p now until should_renew() first answers yes.
     *
     * 0 when it already does. Lets the caller sleep until the certificate is
     * due rather than poll on a fixed interval that could step right past the
     * window of a short-lived certificate.
     */
    int64_t seconds_until_due(int64_t now, int64_t not_before, int64_t not_after);
}
