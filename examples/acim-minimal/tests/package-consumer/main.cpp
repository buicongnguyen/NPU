#include "acim/device_events.h"
#include "acim/device_trace.h"
#include "acim/profiling.hpp"
#include "acim/simulator.hpp"
#include "acim/trace_correlation.hpp"

#include <array>
#include <cstdint>
#include <vector>

int main() {
    ACIM_PROFILE_ZONE("acim_package_consumer");

    constexpr std::array<std::int8_t, 1> weights{3};
    constexpr std::array<std::int8_t, 1> input{4};
    const auto result = acim::run_mvm({1, 1}, weights, input, {-128, 127});

    constexpr std::array<acim::trace::ClockSyncSample, 2> samples{
        acim::trace::ClockSyncSample{100, 10, 120},
        acim::trace::ClockSyncSample{300, 110, 320},
    };
    const auto correlation = acim::trace::fit_clock_correlation(samples);

    return result.status == acim::StatusCode::ok &&
                   result.values == std::vector<std::int32_t>{12} && correlation.has_value() &&
                   ACIM_DEVICE_EVENT_DICTIONARY_VERSION > 0u && ACIM_TRACE_ABI_VERSION > 0u
               ? 0
               : 1;
}
