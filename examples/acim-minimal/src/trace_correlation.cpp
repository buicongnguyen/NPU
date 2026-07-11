#include "acim/trace_correlation.hpp"

#include "acim/profiling.hpp"

#include <algorithm>
#include <cmath>

namespace acim::trace {
namespace {

long double host_midpoint_ns(const ClockSyncSample &sample) {
    const long double send = static_cast<long double>(sample.host_send_ns);
    const long double round_trip =
        static_cast<long double>(sample.host_receive_ns - sample.host_send_ns);
    return send + round_trip / 2.0L;
}

} // namespace

std::optional<ClockCorrelation>
fit_clock_correlation(const std::span<const ClockSyncSample> samples) {
    ACIM_PROFILE_ZONE("acim::trace::fit_clock_correlation");

    if (samples.size() < 2) {
        return std::nullopt;
    }

    long double cycle_sum = 0.0L;
    long double midpoint_sum = 0.0L;
    long double maximum_round_trip = 0.0L;

    for (const ClockSyncSample &sample : samples) {
        if (sample.host_receive_ns < sample.host_send_ns) {
            return std::nullopt;
        }

        cycle_sum += static_cast<long double>(sample.device_cycle);
        midpoint_sum += host_midpoint_ns(sample);
        maximum_round_trip =
            std::max(maximum_round_trip,
                     static_cast<long double>(sample.host_receive_ns - sample.host_send_ns));
    }

    const long double sample_count = static_cast<long double>(samples.size());
    const long double mean_cycle = cycle_sum / sample_count;
    const long double mean_midpoint = midpoint_sum / sample_count;

    long double cycle_variance = 0.0L;
    long double covariance = 0.0L;
    for (const ClockSyncSample &sample : samples) {
        const long double cycle_delta = static_cast<long double>(sample.device_cycle) - mean_cycle;
        const long double midpoint_delta = host_midpoint_ns(sample) - mean_midpoint;
        cycle_variance += cycle_delta * cycle_delta;
        covariance += cycle_delta * midpoint_delta;
    }

    if (cycle_variance == 0.0L) {
        return std::nullopt;
    }

    const long double nanoseconds_per_cycle = covariance / cycle_variance;
    if (!(nanoseconds_per_cycle > 0.0L) || !std::isfinite(nanoseconds_per_cycle)) {
        return std::nullopt;
    }

    const std::uint64_t reference_cycle = samples.front().device_cycle;
    const long double reference_host =
        mean_midpoint +
        nanoseconds_per_cycle * (static_cast<long double>(reference_cycle) - mean_cycle);

    long double maximum_residual = 0.0L;
    for (const ClockSyncSample &sample : samples) {
        const long double predicted =
            reference_host +
            nanoseconds_per_cycle * (static_cast<long double>(sample.device_cycle) -
                                     static_cast<long double>(reference_cycle));
        maximum_residual =
            std::max(maximum_residual, std::abs(host_midpoint_ns(sample) - predicted));
    }

    return ClockCorrelation{
        static_cast<double>(nanoseconds_per_cycle), reference_cycle,
        static_cast<double>(reference_host),        static_cast<double>(maximum_residual),
        static_cast<double>(maximum_round_trip),    samples.size()};
}

double device_cycle_to_host_ns(const ClockCorrelation &correlation,
                               const std::uint64_t device_cycle) noexcept {
    const long double cycle_delta = static_cast<long double>(device_cycle) -
                                    static_cast<long double>(correlation.reference_device_cycle);
    const long double host_ns =
        static_cast<long double>(correlation.reference_host_ns) +
        static_cast<long double>(correlation.nanoseconds_per_cycle) * cycle_delta;
    return static_cast<double>(host_ns);
}

} // namespace acim::trace
