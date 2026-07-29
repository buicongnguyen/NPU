#include "acim/device_events.h"
#include "acim/device_trace.h"
#include "acim/trace_correlation.hpp"

#include <array>
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <iostream>
#include <limits>
#include <random>
#include <string_view>
#include <vector>

namespace {

int failures = 0;

void expect(const bool condition, const std::string_view message) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

template <typename T>
bool has_bytes(const T &value, const std::size_t offset,
               const std::initializer_list<std::uint8_t> expected) {
    const auto *bytes = reinterpret_cast<const std::uint8_t *>(&value);
    std::size_t index = 0;
    for (const std::uint8_t byte : expected) {
        if (bytes[offset + index] != byte) {
            return false;
        }
        ++index;
    }
    return true;
}

void test_device_trace_batch_and_overflow() {
    AcimTraceBatchHeader header{};
    std::array<AcimTraceRecord, 3> records{};
    AcimTraceBuffer buffer{};

    expect(acim_trace_buffer_init(
               &buffer, &header, records.data(), static_cast<std::uint32_t>(records.size()), 2u,
               ACIM_DEVICE_EVENT_DICTIONARY_VERSION, 500'000'000u, 9u, 42u, 101u),
           "trace buffer should initialize");
    expect(acim_trace_zone_begin(&buffer, 1'000u, ACIM_EVENT_ARRAY_SETTLE_MVM, 3u),
           "zone begin should fit");
    expect(acim_trace_counter(&buffer, 1'120u, ACIM_EVENT_ADC_SATURATION_COUNT, 3u, 2),
           "counter should fit");
    expect(acim_trace_zone_end(&buffer, 1'250u, ACIM_EVENT_ARRAY_SETTLE_MVM, 3u),
           "zone end should fit");
    expect(!acim_trace_counter(&buffer, 1'260u, ACIM_EVENT_RETRY_COUNT, 3u, 1),
           "full trace buffer should reject another record");

    expect(header.abi_version == ACIM_TRACE_ABI_VERSION, "trace ABI version");
    expect(header.record_count == records.size(), "record count");
    expect(header.dropped_records == 1u, "overflow should be observable");
    expect(header.clock_hz == 500'000'000u, "device clock metadata");
    expect(header.clock_domain_id == 2u, "clock domain metadata");
    expect(header.clock_epoch == 9u, "clock epoch metadata");
    expect(header.event_dictionary_version == ACIM_DEVICE_EVENT_DICTIONARY_VERSION,
           "event dictionary version");
    expect(header.byte_order == ACIM_TRACE_BYTE_ORDER_LITTLE_ENDIAN, "wire byte order");
    expect(header.capture_id == 42u, "capture correlation ID");
    expect(records[0].command_id == 101u, "command correlation ID");
    expect(records[0].kind == ACIM_TRACE_KIND_ZONE_BEGIN, "zone begin kind");
    expect(records[1].value == 2, "counter payload");
    expect(records[2].sequence == 2u, "monotonic record sequence");

    acim_trace_set_command_id(&buffer, 102u);
    expect(buffer.current_command_id == 102u, "producer command context should be mutable");
}

void test_device_trace_cycle_contract_and_wire_bytes() {
    AcimTraceBatchHeader header{};
    std::array<AcimTraceRecord, 3> records{};
    AcimTraceBuffer buffer{};

    expect(acim_trace_native_byte_order_supported(), "test host must support the trace byte order");
    expect(acim_trace_buffer_init(&buffer, &header, records.data(), 3u, 0x0102'0304u,
                                  ACIM_DEVICE_EVENT_DICTIONARY_VERSION, 0x0102'0304'0506'0708u,
                                  0x1112'1314'1516'1718u, 0x2122'2324'2526'2728u, 0x99AA'BBCCu),
           "wire fixture should initialize");
    expect(acim_trace_counter(&buffer, 0x0102'0304'0506'0708u, 0x1122'3344u, 0x5566u,
                              0x0102'0304'0506'0708),
           "first wire record should fit");
    expect(acim_trace_counter(&buffer, 0x0102'0304'0506'0708u, 0x1122'3344u, 0x5566u, 2),
           "events in the same cycle should be allowed");
    expect(!acim_trace_counter(&buffer, 0x0102'0304'0506'0707u, 0x1122'3344u, 0x5566u, 3),
           "a backwards cycle should be rejected");
    expect(header.record_count == 2u && header.dropped_records == 1u,
           "a backwards cycle should be counted without consuming a slot");

    expect(has_bytes(header, 0u, {0x02u, 0x00u, 0x00u, 0x00u}), "ABI version wire bytes");
    expect(has_bytes(header, 20u, {0x04u, 0x03u, 0x02u, 0x01u}), "clock-domain wire bytes");
    expect(has_bytes(header, 28u, {0x01u, 0x00u, 0x00u, 0x00u}), "byte-order wire bytes");
    expect(has_bytes(header, 32u, {0x08u, 0x07u, 0x06u, 0x05u, 0x04u, 0x03u, 0x02u, 0x01u}),
           "clock-frequency wire bytes");
    expect(has_bytes(records[0], 0u, {0x08u, 0x07u, 0x06u, 0x05u, 0x04u, 0x03u, 0x02u, 0x01u}),
           "cycle wire bytes");
    expect(has_bytes(records[0], 8u, {0x08u, 0x07u, 0x06u, 0x05u, 0x04u, 0x03u, 0x02u, 0x01u}),
           "counter-value wire bytes");
    expect(has_bytes(records[0], 20u, {0x44u, 0x33u, 0x22u, 0x11u}), "event-ID wire bytes");
    expect(has_bytes(records[0], 24u, {0x66u, 0x55u}), "source-ID wire bytes");
    expect(has_bytes(records[0], 28u, {0xCCu, 0xBBu, 0xAAu, 0x99u}), "command-ID wire bytes");
}

void test_clock_correlation() {
    constexpr std::array<acim::trace::ClockSyncSample, 4> samples{
        acim::trace::ClockSyncSample{1'000'180u, 100u, 1'000'220u},
        acim::trace::ClockSyncSample{1'000'385u, 200u, 1'000'415u},
        acim::trace::ClockSyncSample{1'000'570u, 300u, 1'000'630u},
        acim::trace::ClockSyncSample{1'000'795u, 400u, 1'000'805u},
    };

    const auto correlation = acim::trace::fit_clock_correlation(samples);
    expect(correlation.has_value(), "valid sync samples should fit");
    if (!correlation.has_value()) {
        return;
    }

    expect(std::abs(correlation->nanoseconds_per_cycle - 2.0) < 0.01,
           "clock slope should be two nanoseconds per cycle");
    expect(std::abs(acim::trace::device_cycle_to_host_ns(*correlation, 250u) - 1'000'500.0) < 1.0,
           "device cycle should map into the host monotonic timeline");
    expect(correlation->maximum_round_trip_ns == 60.0, "round-trip uncertainty metadata");
    expect(correlation->sample_count == samples.size(), "sync sample count");
}

void test_clock_epoch_rearms_a_completed_slot() {
    AcimTraceBatchHeader header{};
    std::array<AcimTraceRecord, 2> records{};
    AcimTraceBuffer buffer{};
    expect(acim_trace_buffer_init(&buffer, &header, records.data(), 2u, 1u,
                                  ACIM_DEVICE_EVENT_DICTIONARY_VERSION, 500'000'000u, 7u, 1u, 10u),
           "first epoch should initialize");
    expect(acim_trace_counter(&buffer, 100u, ACIM_EVENT_RETRY_COUNT, 1u, 1), "first epoch record");
    expect(acim_trace_buffer_init(&buffer, &header, records.data(), 2u, 1u,
                                  ACIM_DEVICE_EVENT_DICTIONARY_VERSION, 500'000'000u, 8u, 2u, 11u),
           "new epoch should rearm the slot");
    expect(header.clock_epoch == 8u && header.capture_id == 2u,
           "new epoch metadata should replace the previous capture");
    expect(header.record_count == 0u && buffer.next_sequence == 0u,
           "new epoch should reset record and sequence counters");
}

void test_invalid_clock_samples() {
    constexpr std::array<acim::trace::ClockSyncSample, 1> one_sample{
        acim::trace::ClockSyncSample{100u, 10u, 120u},
    };
    constexpr std::array<acim::trace::ClockSyncSample, 2> reversed_host_time{
        acim::trace::ClockSyncSample{200u, 10u, 100u},
        acim::trace::ClockSyncSample{300u, 20u, 320u},
    };
    constexpr std::array<acim::trace::ClockSyncSample, 2> same_device_cycle{
        acim::trace::ClockSyncSample{100u, 10u, 120u},
        acim::trace::ClockSyncSample{200u, 10u, 220u},
    };

    expect(!acim::trace::fit_clock_correlation(one_sample).has_value(),
           "one sync sample is insufficient");
    expect(!acim::trace::fit_clock_correlation(reversed_host_time).has_value(),
           "host receive time cannot precede send time");
    expect(!acim::trace::fit_clock_correlation(same_device_cycle).has_value(),
           "device cycles must span time");

    constexpr std::array<acim::trace::ClockSyncSample, 2> wrapped_cycle{
        acim::trace::ClockSyncSample{100u, std::numeric_limits<std::uint64_t>::max() - 5u, 120u},
        acim::trace::ClockSyncSample{200u, 4u, 220u},
    };
    expect(!acim::trace::fit_clock_correlation(wrapped_cycle).has_value(),
           "a clock wrap must start a new correlation epoch");
}

void test_large_cycle_and_timestamp_precision() {
    constexpr std::uint64_t cycle_base = std::numeric_limits<std::uint64_t>::max() - 1'000u;
    constexpr std::uint64_t host_base = 1'000'000'000'000'000'000u;
    constexpr std::array<acim::trace::ClockSyncSample, 4> samples{
        acim::trace::ClockSyncSample{host_base + 190u, cycle_base + 100u, host_base + 210u},
        acim::trace::ClockSyncSample{host_base + 390u, cycle_base + 200u, host_base + 410u},
        acim::trace::ClockSyncSample{host_base + 590u, cycle_base + 300u, host_base + 610u},
        acim::trace::ClockSyncSample{host_base + 790u, cycle_base + 400u, host_base + 810u},
    };
    const auto correlation = acim::trace::fit_clock_correlation(samples);
    expect(correlation.has_value(), "large clocks and timestamps should retain their deltas");
    if (correlation) {
        expect(std::abs(correlation->nanoseconds_per_cycle - 2.0) < 1e-12, "large clock slope");
        expect(correlation->maximum_fit_residual_ns < 1e-9, "large timestamp residual");
        const auto timestamp =
            acim::trace::device_cycle_to_host_timestamp_ns(*correlation, cycle_base + 250u);
        expect(timestamp == host_base + 500u, "large integer timestamp mapping");
    }
}

void test_checked_timestamp_preserves_full_uint64_cycle_deltas() {
    constexpr std::uint64_t beyond_double_integer = UINT64_C(9007199254740993);
    constexpr std::array<acim::trace::ClockSyncSample, 2> beyond_double_samples{
        acim::trace::ClockSyncSample{0u, 0u, 0u},
        acim::trace::ClockSyncSample{beyond_double_integer, beyond_double_integer,
                                     beyond_double_integer},
    };
    const auto beyond_double_correlation =
        acim::trace::fit_clock_correlation(beyond_double_samples);
    expect(beyond_double_correlation.has_value(), "a full-width slope-one clock should fit");
    if (beyond_double_correlation) {
        expect(acim::trace::device_cycle_to_host_timestamp_ns(
                   *beyond_double_correlation, beyond_double_integer) == beyond_double_integer,
               "checked conversion must preserve cycle deltas beyond double integer precision");
    }

    constexpr std::uint64_t maximum = std::numeric_limits<std::uint64_t>::max();
    constexpr std::array<acim::trace::ClockSyncSample, 2> maximum_samples{
        acim::trace::ClockSyncSample{0u, 0u, 0u},
        acim::trace::ClockSyncSample{maximum, maximum, maximum},
    };
    const auto maximum_correlation = acim::trace::fit_clock_correlation(maximum_samples);
    expect(maximum_correlation.has_value(), "a uint64 boundary clock should fit");
    if (maximum_correlation) {
        expect(acim::trace::device_cycle_to_host_timestamp_ns(*maximum_correlation, maximum) ==
                   maximum,
               "checked conversion must preserve the maximum uint64 timestamp");
    }
}

void test_checked_timestamp_boundaries() {
    constexpr acim::trace::ClockCorrelation zero_anchored{
        1.0, 100u, 0u, 0.0, 0.0, 0.0, 2u,
    };
    expect(acim::trace::device_cycle_to_host_timestamp_ns(zero_anchored, 100u) == 0u,
           "zero host timestamp should be representable");
    expect(!acim::trace::device_cycle_to_host_timestamp_ns(zero_anchored, 99u).has_value(),
           "timestamp conversion should reject uint64 underflow");

    constexpr acim::trace::ClockCorrelation maximum_anchored{
        1.0, 100u, std::numeric_limits<std::uint64_t>::max(), 0.0, 0.0, 0.0, 2u,
    };
    expect(acim::trace::device_cycle_to_host_timestamp_ns(maximum_anchored, 100u) ==
               std::numeric_limits<std::uint64_t>::max(),
           "maximum host timestamp should be representable");
    expect(!acim::trace::device_cycle_to_host_timestamp_ns(maximum_anchored, 101u).has_value(),
           "timestamp conversion should reject uint64 overflow");

    constexpr acim::trace::ClockCorrelation maximum_delta{
        1.0, 0u, 0u, 0.0, 0.0, 0.0, 2u,
    };
    expect(acim::trace::device_cycle_to_host_timestamp_ns(
               maximum_delta, std::numeric_limits<std::uint64_t>::max()) ==
               std::numeric_limits<std::uint64_t>::max(),
           "a maximum-width positive cycle delta should remain exact");

    constexpr acim::trace::ClockCorrelation maximum_negative_delta{
        1.0,
        std::numeric_limits<std::uint64_t>::max(),
        std::numeric_limits<std::uint64_t>::max(),
        0.0,
        0.0,
        0.0,
        2u,
    };
    expect(acim::trace::device_cycle_to_host_timestamp_ns(maximum_negative_delta, 0u) == 0u,
           "a maximum-width negative cycle delta should remain exact");

    constexpr acim::trace::ClockCorrelation overflowing_maximum_delta{
        1.0, 0u, 1u, 0.0, 0.0, 0.0, 2u,
    };
    expect(!acim::trace::device_cycle_to_host_timestamp_ns(
                overflowing_maximum_delta, std::numeric_limits<std::uint64_t>::max())
                .has_value(),
           "a full-width delta plus a nonzero anchor should reject uint64 overflow");

    acim::trace::ClockCorrelation rounding = zero_anchored;
    rounding.host_time_anchor_ns = 10u;
    rounding.reference_host_offset_ns = 0.5;
    expect(acim::trace::device_cycle_to_host_timestamp_ns(rounding, 100u) == 11u,
           "positive half-nanosecond offsets should round away from zero");
    rounding.reference_host_offset_ns = 1.5;
    expect(acim::trace::device_cycle_to_host_timestamp_ns(rounding, 100u) == 12u,
           "positive one-and-a-half offsets should round away from zero");
    rounding.reference_host_offset_ns = -0.5;
    expect(acim::trace::device_cycle_to_host_timestamp_ns(rounding, 100u) == 9u,
           "negative half-nanosecond offsets should round away from zero");
    rounding.reference_host_offset_ns = -1.5;
    expect(acim::trace::device_cycle_to_host_timestamp_ns(rounding, 100u) == 8u,
           "negative one-and-a-half offsets should round away from zero");

    acim::trace::ClockCorrelation nonfinite_slope = zero_anchored;
    nonfinite_slope.nanoseconds_per_cycle = std::numeric_limits<double>::quiet_NaN();
    expect(!acim::trace::device_cycle_to_host_timestamp_ns(nonfinite_slope, 101u).has_value(),
           "timestamp conversion should reject a nonfinite slope");

    nonfinite_slope.nanoseconds_per_cycle = std::numeric_limits<double>::infinity();
    expect(!acim::trace::device_cycle_to_host_timestamp_ns(nonfinite_slope, 101u).has_value(),
           "timestamp conversion should reject an infinite slope");

    acim::trace::ClockCorrelation nonfinite_offset = zero_anchored;
    nonfinite_offset.reference_host_offset_ns = std::numeric_limits<double>::infinity();
    expect(!acim::trace::device_cycle_to_host_timestamp_ns(nonfinite_offset, 100u).has_value(),
           "timestamp conversion should reject a nonfinite offset");
}

void test_checked_timestamp_randomized_against_extended_precision() {
#if LDBL_MANT_DIG > DBL_MANT_DIG
    // Keep the exact binary-rational product within the 64-bit significand of the
    // extended-precision reference while exercising deltas above 2^53.
    // NOLINTNEXTLINE(bugprone-random-generator-seed)
    std::mt19937_64 generator(0xD0B1ED0u);
    constexpr std::uint64_t delta_mask = (UINT64_C(1) << 56u) - 1u;
    constexpr std::uint64_t host_anchor = UINT64_C(1) << 62u;

    for (int trial = 0; trial < 2'000; ++trial) {
        const std::uint64_t delta = generator() & delta_mask;
        const double slope = static_cast<double>((generator() % 255u) + 1u) / 1024.0;
        const auto offset_quarters = static_cast<std::int64_t>(generator() % 8'193u) - 4'096;
        const double reference_offset = static_cast<double>(offset_quarters) / 4.0;
        const bool is_forward = (generator() & 1u) != 0u;
        const std::uint64_t reference_cycle = is_forward ? 0u : delta;
        const std::uint64_t device_cycle = is_forward ? delta : 0u;
        const acim::trace::ClockCorrelation correlation{
            slope, reference_cycle, host_anchor, reference_offset, 0.0, 0.0, 2u,
        };

        const long double signed_delta =
            is_forward ? static_cast<long double>(delta) : -static_cast<long double>(delta);
        const long double exact_offset = static_cast<long double>(reference_offset) +
                                         static_cast<long double>(slope) * signed_delta;
        const long double rounded_offset = std::round(exact_offset);
        const std::uint64_t expected =
            rounded_offset >= 0.0L ? host_anchor + static_cast<std::uint64_t>(rounded_offset)
                                   : host_anchor - static_cast<std::uint64_t>(-rounded_offset);
        expect(acim::trace::device_cycle_to_host_timestamp_ns(correlation, device_cycle) ==
                   expected,
               "checked conversion must match an extended-precision reference");
    }
#endif
}

void test_outlier_is_reported() {
    constexpr std::array<acim::trace::ClockSyncSample, 5> samples{
        acim::trace::ClockSyncSample{90u, 0u, 110u},
        acim::trace::ClockSyncSample{290u, 100u, 310u},
        acim::trace::ClockSyncSample{490u, 200u, 510u},
        acim::trace::ClockSyncSample{1'690u, 300u, 1'710u},
        acim::trace::ClockSyncSample{890u, 400u, 910u},
    };
    const auto correlation = acim::trace::fit_clock_correlation(samples);
    expect(correlation.has_value(), "an outlier should produce diagnosable fit metadata");
    if (correlation) {
        expect(correlation->maximum_fit_residual_ns > 500.0,
               "outlier should appear in maximum residual");
    }
}

void test_randomized_clock_fit() {
    // A fixed seed keeps fit regressions reproducible in CI.
    // NOLINTNEXTLINE(bugprone-random-generator-seed)
    std::mt19937_64 generator(0xC10Cu);
    std::uniform_int_distribution<int> jitter(-10, 10);
    std::vector<acim::trace::ClockSyncSample> samples;
    for (std::uint64_t index = 0; index < 100u; ++index) {
        const std::uint64_t cycle = 10'000u + index * 250u;
        const std::int64_t midpoint =
            1'000'000 + static_cast<std::int64_t>(cycle * 2u) + jitter(generator);
        samples.push_back({static_cast<std::uint64_t>(midpoint - 20), cycle,
                           static_cast<std::uint64_t>(midpoint + 20)});
    }
    const auto correlation = acim::trace::fit_clock_correlation(samples);
    expect(correlation.has_value(), "randomized monotonic samples should fit");
    if (correlation) {
        expect(std::abs(correlation->nanoseconds_per_cycle - 2.0) < 0.001, "randomized fit slope");
        expect(correlation->maximum_fit_residual_ns < 20.0,
               "bounded jitter should have bounded residual");
    }
}

} // namespace

int main() {
    test_device_trace_batch_and_overflow();
    test_device_trace_cycle_contract_and_wire_bytes();
    test_clock_correlation();
    test_clock_epoch_rearms_a_completed_slot();
    test_invalid_clock_samples();
    test_large_cycle_and_timestamp_precision();
    test_checked_timestamp_preserves_full_uint64_cycle_deltas();
    test_checked_timestamp_boundaries();
    test_checked_timestamp_randomized_against_extended_precision();
    test_outlier_is_reported();
    test_randomized_clock_fit();

    if (failures != 0) {
        std::cerr << failures << " trace test(s) failed\n";
        return 1;
    }

    std::cout << "All ACiM device trace and clock correlation tests passed\n";
    return 0;
}
