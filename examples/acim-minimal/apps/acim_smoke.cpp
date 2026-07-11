#include "acim/simulator.hpp"

#include "acim/profiling.hpp"

#include <array>
#include <cstdint>
#include <iostream>
#include <vector>

int main() {
    ACIM_PROFILE_ZONE("acim_smoke::main");
    ACIM_PROFILE_MESSAGE("ACiM smoke request started");

    constexpr acim::MvmShape shape{2, 3};
    constexpr std::array<std::int8_t, 6> weights{1, 2, 3, -1, 0, 4};
    constexpr std::array<std::int8_t, 3> input{1, 1, 1};
    constexpr acim::AdcRange adc_range{-128, 127};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, adc_range);
    const std::vector<std::int32_t> expected{6, 3};

    if (result.status != acim::StatusCode::ok || result.values != expected ||
        result.saturated_outputs != 0) {
        std::cerr << "ACiM functional smoke FAIL: status=" << acim::to_string(result.status)
                  << '\n';
        return 1;
    }

    std::cout << "ACiM functional smoke PASS\n"
              << "shape=2x3 output=[" << result.values[0] << ", " << result.values[1]
              << "] saturated=" << result.saturated_outputs << '\n';
    ACIM_PROFILE_FRAME("ACiM smoke inference");
    return 0;
}
