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

struct HostTimestampOffset {
    std::uint64_t anchor_ns;
    long double offset_ns;
};

// MSVC gives long double only binary64 precision, but checked uint64 conversion
// needs the product residual to round exactly beyond 2^53. These helpers keep
// each value normalized as high + low; the final magnitude conversion preserves
// std::round's ties-away-from-zero semantics for both offset signs.
struct DoubleDouble {
    double high;
    double low;
};

struct DoubleOperands {
    double left;
    double right;
};

struct DoubleDoubleAndDouble {
    DoubleDouble value;
    double addend;
};

struct DoubleDoubleOperands {
    DoubleDouble left;
    DoubleDouble right;
};

struct ScaledUint64 {
    double value;
    std::uint64_t multiplier;
};

DoubleDouble two_sum(const DoubleOperands &operands) noexcept {
    const double sum = operands.left + operands.right;
    const double right_virtual = sum - operands.left;
    const double error = (operands.left - (sum - right_virtual)) + (operands.right - right_virtual);
    return {sum, error};
}

DoubleDouble add_double(const DoubleDoubleAndDouble &operands) noexcept {
    const DoubleDouble high_sum = two_sum({operands.value.high, operands.addend});
    const double low_sum = operands.value.low + high_sum.low;
    return two_sum({high_sum.high, low_sum});
}

DoubleDouble add_double_double(const DoubleDoubleOperands &operands) noexcept {
    const DoubleDouble high_and_right = add_double({operands.left, operands.right.high});
    return add_double({high_and_right, operands.right.low});
}

DoubleDouble two_product(const DoubleOperands &operands) noexcept {
    const double product = operands.left * operands.right;
    return {product, std::fma(operands.left, operands.right, -product)};
}

DoubleDouble multiply_by_uint64(const ScaledUint64 &scaled) noexcept {
    constexpr unsigned half_width = 32;
    constexpr std::uint64_t low_mask = UINT64_C(0xFFFF'FFFF);

    const double high_multiplier =
        std::ldexp(static_cast<double>(scaled.multiplier >> half_width), half_width);
    const double low_multiplier = static_cast<double>(scaled.multiplier & low_mask);
    return add_double_double({two_product({scaled.value, high_multiplier}),
                              two_product({scaled.value, low_multiplier})});
}

bool is_negative(const DoubleDouble &value) noexcept {
    return value.high < 0.0 || (value.high == 0.0 && value.low < 0.0);
}

DoubleDouble negate(const DoubleDouble &value) noexcept { return {-value.high, -value.low}; }

std::int64_t floor_small(const DoubleDouble &value) noexcept {
    const double high_floor = std::floor(value.high);
    auto result = static_cast<std::int64_t>(high_floor);
    const DoubleDouble remainder = add_double({value, -high_floor});
    if (is_negative(remainder)) {
        --result;
        return result;
    }

    const DoubleDouble remainder_minus_one = add_double({remainder, -1.0});
    if (!is_negative(remainder_minus_one)) {
        ++result;
    }
    return result;
}

std::optional<std::uint64_t> round_nonnegative_to_uint64(const DoubleDouble &value) noexcept {
    const double uint64_limit = std::ldexp(1.0, 64);
    if (!std::isfinite(value.high) || !std::isfinite(value.low) || is_negative(value) ||
        value.high > uint64_limit) {
        return std::nullopt;
    }

    if (value.high == uint64_limit) {
        const DoubleDouble relative_to_limit = add_double({value, -uint64_limit});
        const std::int64_t adjustment = floor_small(add_double({relative_to_limit, 0.5}));
        if (adjustment >= 0) {
            return std::nullopt;
        }
        const auto decrement = static_cast<std::uint64_t>(-adjustment);
        return std::uint64_t{0} - decrement;
    }

    const double high_floor = std::floor(value.high);
    std::uint64_t result = static_cast<std::uint64_t>(high_floor);
    const DoubleDouble remainder = add_double({value, -high_floor});
    const std::int64_t adjustment = floor_small(add_double({remainder, 0.5}));
    if (adjustment >= 0) {
        const auto increment = static_cast<std::uint64_t>(adjustment);
        if (increment > std::numeric_limits<std::uint64_t>::max() - result) {
            return std::nullopt;
        }
        result += increment;
        return result;
    }

    const auto decrement = static_cast<std::uint64_t>(-adjustment);
    if (decrement > result) {
        return std::nullopt;
    }
    return result - decrement;
}

std::optional<std::uint64_t> add_rounded_offset(const std::uint64_t anchor,
                                                const DoubleDouble &offset) noexcept {
    if (is_negative(offset)) {
        const auto decrement = round_nonnegative_to_uint64(negate(offset));
        if (!decrement || *decrement > anchor) {
            return std::nullopt;
        }
        return anchor - *decrement;
    }

    const auto increment = round_nonnegative_to_uint64(offset);
    if (!increment || *increment > std::numeric_limits<std::uint64_t>::max() - anchor) {
        return std::nullopt;
    }
    return anchor + *increment;
}

std::optional<std::uint64_t> add_rounded_offset(const HostTimestampOffset &timestamp) {
    const std::uint64_t anchor = timestamp.anchor_ns;
    const long double offset = timestamp.offset_ns;
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
    if (!add_rounded_offset({host_time_anchor_ns, reference_host_offset}).has_value()) {
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
    const bool is_forward = device_cycle >= correlation.reference_device_cycle;
    const std::uint64_t cycle_delta = is_forward
                                          ? device_cycle - correlation.reference_device_cycle
                                          : correlation.reference_device_cycle - device_cycle;
    DoubleDouble scaled_delta =
        multiply_by_uint64({correlation.nanoseconds_per_cycle, cycle_delta});
    if (!is_forward) {
        scaled_delta = negate(scaled_delta);
    }
    const DoubleDouble offset = add_double({scaled_delta, correlation.reference_host_offset_ns});
    return add_rounded_offset(correlation.host_time_anchor_ns, offset);
}

} // namespace acim::trace
