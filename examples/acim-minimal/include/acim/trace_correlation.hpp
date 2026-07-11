#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>

namespace acim::trace {

struct ClockSyncSample {
    std::uint64_t host_send_ns;
    std::uint64_t device_cycle;
    std::uint64_t host_receive_ns;
};

struct ClockCorrelation {
    double nanoseconds_per_cycle;
    std::uint64_t reference_device_cycle;
    double reference_host_ns;
    double maximum_fit_residual_ns;
    double maximum_round_trip_ns;
    std::size_t sample_count;
};

[[nodiscard]] std::optional<ClockCorrelation>
fit_clock_correlation(std::span<const ClockSyncSample> samples);

[[nodiscard]] double device_cycle_to_host_ns(const ClockCorrelation &correlation,
                                             std::uint64_t device_cycle) noexcept;

} // namespace acim::trace
