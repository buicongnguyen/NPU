#include "acim/device_events.h"
#include "acim/device_trace.h"
#include "acim/trace_correlation.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <string_view>

namespace {

int failures = 0;

void expect(const bool condition, const std::string_view message) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
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
    expect(header.capture_id == 42u, "capture correlation ID");
    expect(records[0].command_id == 101u, "command correlation ID");
    expect(records[0].kind == ACIM_TRACE_KIND_ZONE_BEGIN, "zone begin kind");
    expect(records[1].value == 2, "counter payload");
    expect(records[2].sequence == 2u, "monotonic record sequence");

    acim_trace_set_command_id(&buffer, 102u);
    expect(buffer.current_command_id == 102u, "producer command context should be mutable");
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
}

} // namespace

int main() {
    test_device_trace_batch_and_overflow();
    test_clock_correlation();
    test_invalid_clock_samples();

    if (failures != 0) {
        std::cerr << failures << " trace test(s) failed\n";
        return 1;
    }

    std::cout << "All ACiM device trace and clock correlation tests passed\n";
    return 0;
}
