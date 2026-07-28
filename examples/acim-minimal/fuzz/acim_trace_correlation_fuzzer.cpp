#include "acim/trace_correlation.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t *data, const std::size_t size) {
    constexpr std::size_t sample_bytes = sizeof(acim::trace::ClockSyncSample);
    const std::size_t count = std::min<std::size_t>(size / sample_bytes, 64u);
    if (count < 2)
        return 0;

    std::vector<acim::trace::ClockSyncSample> samples(count);
    std::memcpy(samples.data(), data, count * sample_bytes);
    if (const auto correlation = acim::trace::fit_clock_correlation(samples)) {
        for (const auto &sample : samples) {
            const double mapped =
                acim::trace::device_cycle_to_host_ns(*correlation, sample.device_cycle);
            if (!std::isfinite(mapped))
                __builtin_trap();
            (void)acim::trace::device_cycle_to_host_timestamp_ns(*correlation, sample.device_cycle);
        }
    }
    return 0;
}
