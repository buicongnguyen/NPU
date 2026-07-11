#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace acim {

struct MvmShape {
    std::size_t rows;
    std::size_t columns;
};

struct AdcRange {
    std::int32_t minimum;
    std::int32_t maximum;
};

enum class StatusCode : std::uint8_t {
    ok,
    invalid_shape,
    invalid_weight_count,
    invalid_input_count,
    invalid_adc_range
};

struct MvmResult {
    StatusCode status;
    std::vector<std::int32_t> values;
    std::size_t saturated_outputs;
};

[[nodiscard]] MvmResult run_mvm(MvmShape shape, std::span<const std::int8_t> row_major_weights,
                                std::span<const std::int8_t> input, AdcRange adc_range);

[[nodiscard]] const char *to_string(StatusCode status) noexcept;

} // namespace acim
