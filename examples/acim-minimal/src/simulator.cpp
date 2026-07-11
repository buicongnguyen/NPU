#include "acim/simulator.hpp"

#include "acim/profiling.hpp"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <utility>

namespace acim {

MvmResult run_mvm(const MvmShape shape, const std::span<const std::int8_t> row_major_weights,
                  const std::span<const std::int8_t> input, const AdcRange adc_range) {
    ACIM_PROFILE_ZONE("acim::run_mvm");

    {
        ACIM_PROFILE_ZONE("validate_mvm_request");
        if (shape.rows == 0 || shape.columns == 0 ||
            shape.columns > std::numeric_limits<std::size_t>::max() / shape.rows) {
            return {StatusCode::invalid_shape, {}, 0};
        }

        const std::size_t expected_weight_count = shape.rows * shape.columns;
        if (row_major_weights.size() != expected_weight_count) {
            return {StatusCode::invalid_weight_count, {}, 0};
        }
        if (input.size() != shape.columns) {
            return {StatusCode::invalid_input_count, {}, 0};
        }
        if (adc_range.minimum > adc_range.maximum) {
            return {StatusCode::invalid_adc_range, {}, 0};
        }
    }

    std::vector<std::int32_t> output;
    output.reserve(shape.rows);
    std::size_t saturated_outputs = 0;

    const std::int64_t lower_bound = adc_range.minimum;
    const std::int64_t upper_bound = adc_range.maximum;

    {
        ACIM_PROFILE_ZONE("mvm_and_adc_clamp");
        for (std::size_t row = 0; row < shape.rows; ++row) {
            std::int64_t sum = 0;
            for (std::size_t column = 0; column < shape.columns; ++column) {
                const std::size_t index = row * shape.columns + column;
                sum += static_cast<std::int64_t>(row_major_weights[index]) *
                       static_cast<std::int64_t>(input[column]);
            }

            const std::int64_t clamped = std::clamp(sum, lower_bound, upper_bound);
            if (clamped != sum) {
                ++saturated_outputs;
            }
            output.push_back(static_cast<std::int32_t>(clamped));
        }
    }

    ACIM_PROFILE_PLOT("ACiM saturated outputs", saturated_outputs);
    ACIM_PROFILE_PLOT("ACiM output elements", output.size());

    return {StatusCode::ok, std::move(output), saturated_outputs};
}

const char *to_string(const StatusCode status) noexcept {
    switch (status) {
    case StatusCode::ok:
        return "ok";
    case StatusCode::invalid_shape:
        return "invalid_shape";
    case StatusCode::invalid_weight_count:
        return "invalid_weight_count";
    case StatusCode::invalid_input_count:
        return "invalid_input_count";
    case StatusCode::invalid_adc_range:
        return "invalid_adc_range";
    }
    return "unknown";
}

} // namespace acim
