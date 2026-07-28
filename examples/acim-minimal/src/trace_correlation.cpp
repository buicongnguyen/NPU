#include "acim/trace_correlation.hpp"

#include "acim/profiling.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace acim::trace {
namespace {

long double integer_delta(const std::uint64_t reference, const std::uint64_t value) {
    if (value >= reference) {
        return static_cast<long double>(value - reference);
    }
    return -static_cast<long double>(reference - value);
}

long double host_midpoint_offset_ns(const ClockSyncSample &sample,
                                    const std::uint64_t host_time_anchor_ns) {
    const long double send_offset = integer_delta(host_time_anchor_ns, sample.host_send_ns);
    const long double round_trip =
        static_cast<long double>(sample.host_receive_ns - sample.host_send_ns);
    return send_offset + round_trip / 2.0L;
}

std::optional<std::uint64_t> add_rounded_offset(const std::uint64_t anchor,
                                                const long double offset) {
    if (!std::isfinite(offset)) {
        return std::nullopt;
    }

    const long double rounded = std::round(offset);
    const long double uint64_limit = std::ldexp(1.0L, 64);
    if (rounded >= 0.0L) {
        const std::uint64_t room = std::numeric_limits<std::uint64_t>::max() - anchor;
        if (rounded >= uint64_limit || rounded > static_cast<long double>(room)) {
            return std::nullopt;
        }
        const std::uint64_t increment = static_cast<std::uint64_t>(rounded);
        if (increment > room) {
            return std::nullopt;
        }
        return anchor + increment;
    }

    const long double magnitude = -rounded;
    if (magnitude >= uint64_limit || magnitude > static_cast<long double>(anchor)) {
        return std::nullopt;
    }
    const std::uint64_t decrement = static_cast<std::uint64_t>(magnitude);
    if (decrement > anchor) {
        return std::nullopt;
    }
    return anchor - decrement;
}

} // namespace

std::optional<ClockCorrelation>
fit_clock_correlation(const std::span<const ClockSyncSample> samples) {
    ACIM_PROFILE_ZONE("acim::trace::fit_clock_correlation");

    if (samples.size() < 2) {
        return std::nullopt;
    }

    const std::uint64_t reference_cycle = samples.front().device_cycle;
    const std::uint64_t host_time_anchor_ns = samples.front().host_send_ns;
    long double cycle_delta_sum = 0.0L;
    long double midpoint_offset_sum = 0.0L;
    long double maximum_round_trip = 0.0L;

    std::uint64_t previous_cycle = reference_cycle;
    for (std::size_t index = 0; index < samples.size(); ++index) {
        const ClockSyncSample &sample = samples[index];
        if (sample.host_receive_ns < sample.host_send_ns) {
            return std::nullopt;
        }
        if (index > 0 && sample.device_cycle <= previous_cycle) {
            return std::nullopt;
        }

        cycle_delta_sum += integer_delta(reference_cycle, sample.device_cycle);
        midpoint_offset_sum += host_midpoint_offset_ns(sample, host_time_anchor_ns);
        maximum_round_trip =
            std::max(maximum_round_trip,
                     static_cast<long double>(sample.host_receive_ns - sample.host_send_ns));
        previous_cycle = sample.device_cycle;
    }

    const long double sample_count = static_cast<long double>(samples.size());
    const long double mean_cycle_delta = cycle_delta_sum / sample_count;
    const long double mean_midpoint_offset = midpoint_offset_sum / sample_count;

    long double cycle_variance = 0.0L;
    long double covariance = 0.0L;
    for (const ClockSyncSample &sample : samples) {
        const long double sample_cycle_delta =
            integer_delta(reference_cycle, sample.device_cycle) - mean_cycle_delta;
        const long double midpoint_delta =
            host_midpoint_offset_ns(sample, host_time_anchor_ns) - mean_midpoint_offset;
        cycle_variance += sample_cycle_delta * sample_cycle_delta;
        covariance += sample_cycle_delta * midpoint_delta;
    }

    if (cycle_variance == 0.0L) {
        return std::nullopt;
    }

    const long double nanoseconds_per_cycle = covariance / cycle_variance;
    if (!(nanoseconds_per_cycle > 0.0L) || !std::isfinite(nanoseconds_per_cycle)) {
        return std::nullopt;
    }

    const long double reference_host_offset =
        mean_midpoint_offset - nanoseconds_per_cycle * mean_cycle_delta;
    if (!add_rounded_offset(host_time_anchor_ns, reference_host_offset).has_value()) {
        return std::nullopt;
    }

    long double maximum_residual = 0.0L;
    for (const ClockSyncSample &sample : samples) {
        const long double predicted =
            reference_host_offset +
            nanoseconds_per_cycle * integer_delta(reference_cycle, sample.device_cycle);
        maximum_residual =
            std::max(maximum_residual,
                     std::abs(host_midpoint_offset_ns(sample, host_time_anchor_ns) - predicted));
    }

    return ClockCorrelation{static_cast<double>(nanoseconds_per_cycle),
                            reference_cycle,
                            host_time_anchor_ns,
                            static_cast<double>(reference_host_offset),
                            static_cast<double>(maximum_residual),
                            static_cast<double>(maximum_round_trip),
                            samples.size()};
}

double device_cycle_to_host_ns(const ClockCorrelation &correlation,
                               const std::uint64_t device_cycle) noexcept {
    const long double delta = integer_delta(correlation.reference_device_cycle, device_cycle);
    const long double host_ns = static_cast<long double>(correlation.host_time_anchor_ns) +
                                static_cast<long double>(correlation.reference_host_offset_ns) +
                                static_cast<long double>(correlation.nanoseconds_per_cycle) * delta;
    return static_cast<double>(host_ns);
}

std::optional<std::uint64_t>
device_cycle_to_host_timestamp_ns(const ClockCorrelation &correlation,
                                  const std::uint64_t device_cycle) noexcept {
    const long double delta = integer_delta(correlation.reference_device_cycle, device_cycle);
    const long double offset = static_cast<long double>(correlation.reference_host_offset_ns) +
                               static_cast<long double>(correlation.nanoseconds_per_cycle) * delta;
    return add_rounded_offset(correlation.host_time_anchor_ns, offset);
}

} // namespace acim::trace
