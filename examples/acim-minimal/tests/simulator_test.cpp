#include "acim/simulator.hpp"

#include <array>
#include <cstdint>
#include <iostream>
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
}

} // namespace

int main() {
    test_exact_mvm();
    test_adc_saturation();
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
