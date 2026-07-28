#include "acim/simulator.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <limits>
#include <random>
#include <string_view>
#include <vector>

namespace {

int failures = 0;

void expect(const bool condition, const std::string_view message) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

void test_exact_mvm() {
    constexpr acim::MvmShape shape{2, 3};
    constexpr std::array<std::int8_t, 6> weights{1, 2, 3, -1, 0, 4};
    constexpr std::array<std::int8_t, 3> input{1, 1, 1};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, {-128, 127});

    expect(result.status == acim::StatusCode::ok, "exact MVM should succeed");
    expect(result.values == std::vector<std::int32_t>({6, 3}), "exact MVM values");
    expect(result.saturated_outputs == 0, "exact MVM should not saturate");
}

void test_adc_saturation() {
    constexpr acim::MvmShape shape{1, 2};
    constexpr std::array<std::int8_t, 2> weights{100, 100};
    constexpr std::array<std::int8_t, 2> input{2, 2};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, {-128, 127});

    expect(result.status == acim::StatusCode::ok, "saturated MVM should succeed");
    expect(result.values == std::vector<std::int32_t>({127}), "ADC upper clamp");
    expect(result.saturated_outputs == 1, "saturation counter");
}

void test_lower_saturation_and_signed_values() {
    constexpr std::array<std::int8_t, 2> negative_weights{-100, -100};
    constexpr std::array<std::int8_t, 2> positive_input{2, 2};
    const auto saturated = acim::run_mvm({1, 2}, negative_weights, positive_input, {-128, 127});
    expect(saturated.values == std::vector<std::int32_t>{-128}, "ADC lower clamp");
    expect(saturated.saturated_outputs == 1, "lower saturation counter");

    constexpr std::array<std::int8_t, 3> signed_weights{0, -3, 4};
    constexpr std::array<std::int8_t, 3> signed_input{-2, 0, 5};
    const auto signed_result = acim::run_mvm({1, 3}, signed_weights, signed_input, {-128, 127});
    expect(signed_result.values == std::vector<std::int32_t>{20}, "zero and negative operands");
}

void test_wide_accumulation_before_clamp() {
    constexpr std::size_t columns = 200'000;
    const std::vector<std::int8_t> weights(columns, 127);
    const std::vector<std::int8_t> input(columns, 127);
    const auto result = acim::run_mvm(
        {1, columns}, weights, input,
        {std::numeric_limits<std::int32_t>::min(), std::numeric_limits<std::int32_t>::max()});
    expect(result.status == acim::StatusCode::ok, "wide accumulation should succeed");
    expect(result.values == std::vector<std::int32_t>{std::numeric_limits<std::int32_t>::max()},
           "sum above int32 should clamp after int64 accumulation");
    expect(result.saturated_outputs == 1, "wide accumulation saturation counter");
}

void test_randomized_reference_model() {
    // A fixed seed keeps differential failures reproducible in CI.
    // NOLINTNEXTLINE(bugprone-random-generator-seed)
    std::mt19937 generator(0xAC1u);
    std::uniform_int_distribution<int> rows_distribution(1, 8);
    std::uniform_int_distribution<int> columns_distribution(1, 16);
    std::uniform_int_distribution<int> value_distribution(-128, 127);

    for (int trial = 0; trial < 200; ++trial) {
        const auto rows = static_cast<std::size_t>(rows_distribution(generator));
        const auto columns = static_cast<std::size_t>(columns_distribution(generator));
        std::vector<std::int8_t> weights(rows * columns);
        std::vector<std::int8_t> input(columns);
        for (auto &value : weights)
            value = static_cast<std::int8_t>(value_distribution(generator));
        for (auto &value : input)
            value = static_cast<std::int8_t>(value_distribution(generator));

        const auto result = acim::run_mvm({rows, columns}, weights, input, {-5'000, 5'000});
        expect(result.status == acim::StatusCode::ok, "randomized MVM should succeed");
        for (std::size_t row = 0; row < rows; ++row) {
            std::int64_t reference = 0;
            for (std::size_t column = 0; column < columns; ++column) {
                reference += static_cast<std::int64_t>(weights[row * columns + column]) *
                             static_cast<std::int64_t>(input[column]);
            }
            reference = std::clamp<std::int64_t>(reference, -5'000, 5'000);
            expect(result.values[row] == reference, "randomized MVM must match reference");
        }
    }
}

void test_bad_weight_count() {
    constexpr acim::MvmShape shape{2, 2};
    constexpr std::array<std::int8_t, 3> weights{1, 2, 3};
    constexpr std::array<std::int8_t, 2> input{1, 1};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, {-128, 127});
    expect(result.status == acim::StatusCode::invalid_weight_count,
           "weight count should be validated");
}

void test_bad_adc_range() {
    constexpr acim::MvmShape shape{1, 1};
    constexpr std::array<std::int8_t, 1> weights{1};
    constexpr std::array<std::int8_t, 1> input{1};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, {10, -10});
    expect(result.status == acim::StatusCode::invalid_adc_range, "ADC range should be validated");
}

void test_bad_shape_and_input_count() {
    constexpr std::array<std::int8_t, 1> weights{1};
    constexpr std::array<std::int8_t, 1> input{1};

    expect(acim::run_mvm({0, 1}, weights, input, {-128, 127}).status ==
               acim::StatusCode::invalid_shape,
           "zero-sized shape should be rejected");
    expect(acim::run_mvm({1, 1}, weights, std::span<const std::int8_t>{}, {-128, 127}).status ==
               acim::StatusCode::invalid_input_count,
           "input count should be validated");
    expect(
        acim::run_mvm({std::numeric_limits<std::size_t>::max(), 2}, {}, {}, {-128, 127}).status ==
            acim::StatusCode::invalid_shape,
        "overflowing dimensions should be rejected before span validation");
}

} // namespace

int main() {
    test_exact_mvm();
    test_adc_saturation();
    test_lower_saturation_and_signed_values();
    test_wide_accumulation_before_clamp();
    test_randomized_reference_model();
    test_bad_weight_count();
    test_bad_adc_range();
    test_bad_shape_and_input_count();

    if (failures != 0) {
        std::cerr << failures << " unit test(s) failed\n";
        return 1;
    }

    std::cout << "All ACiM functional simulator unit tests passed\n";
    return 0;
}
