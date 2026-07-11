#include "acim/simulator.hpp"

#include <array>
#include <cstdint>
#include <vector>

#include <gtest/gtest.h>

TEST(FunctionalSimulator, ComputesExactMvm) {
    constexpr acim::MvmShape shape{2, 3};
    constexpr std::array<std::int8_t, 6> weights{1, 2, 3, -1, 0, 4};
    constexpr std::array<std::int8_t, 3> input{1, 1, 1};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, {-128, 127});

    EXPECT_EQ(result.status, acim::StatusCode::ok);
    EXPECT_EQ(result.values, std::vector<std::int32_t>({6, 3}));
    EXPECT_EQ(result.saturated_outputs, 0U);
}

TEST(FunctionalSimulator, ClampsAtAdcRange) {
    constexpr acim::MvmShape shape{1, 2};
    constexpr std::array<std::int8_t, 2> weights{100, 100};
    constexpr std::array<std::int8_t, 2> input{2, 2};

    const acim::MvmResult result = acim::run_mvm(shape, weights, input, {-128, 127});

    EXPECT_EQ(result.status, acim::StatusCode::ok);
    EXPECT_EQ(result.values, std::vector<std::int32_t>({127}));
    EXPECT_EQ(result.saturated_outputs, 1U);
}

TEST(FunctionalSimulator, RejectsInvalidDimensions) {
    constexpr std::array<std::int8_t, 1> weights{1};
    constexpr std::array<std::int8_t, 1> input{1};

    EXPECT_EQ(acim::run_mvm({0, 1}, weights, input, {-128, 127}).status,
              acim::StatusCode::invalid_shape);
    EXPECT_EQ(acim::run_mvm({1, 2}, weights, input, {-128, 127}).status,
              acim::StatusCode::invalid_weight_count);
}
