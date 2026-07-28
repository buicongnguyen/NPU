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
    std::uint64_t host_time_anchor_ns;
    double reference_host_offset_ns;
    double maximum_fit_residual_ns;
    double maximum_round_trip_ns;
    std::size_t sample_count;
};

// Samples must belong to one clock epoch and have strictly increasing device cycles.
// A counter wrap or device reset starts a new epoch and must be fitted separately.
[[nodiscard]] std::optional<ClockCorrelation>
fit_clock_correlation(std::span<const ClockSyncSample> samples);

[[nodiscard]] double device_cycle_to_host_ns(const ClockCorrelation &correlation,
                                             std::uint64_t device_cycle) noexcept;

// Prefer this integer timestamp conversion when host times may exceed the exact
// integer range of a double. Returns nullopt if extrapolation leaves uint64_t range.
[[nodiscard]] std::optional<std::uint64_t>
device_cycle_to_host_timestamp_ns(const ClockCorrelation &correlation,
                                  std::uint64_t device_cycle) noexcept;

} // namespace acim::trace
