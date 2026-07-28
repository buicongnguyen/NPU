cmake_minimum_required(VERSION 3.24)

project(acim_package_consumer LANGUAGES C CXX)

find_package(acim_minimal CONFIG REQUIRED)

add_executable(acim_package_consumer main.cpp)
target_compile_features(acim_package_consumer PRIVATE cxx_std_20)
target_link_libraries(
    acim_package_consumer
    PRIVATE acim::sim acim::trace acim::device_trace acim::profiling
)
