cmake_minimum_required(VERSION 3.24)

project(
    acim_minimal
    VERSION 0.1.0
    DESCRIPTION "Minimal functional Analog CIM simulator and profiling scaffold"
    LANGUAGES C CXX
)

include(CTest)
include(GNUInstallDirs)

option(ACIM_WARNINGS_AS_ERRORS "Treat warnings in ACiM-owned targets as errors" OFF)
option(ACIM_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
option(ACIM_ENABLE_GTEST "Build the optional GoogleTest suite" OFF)
option(ACIM_FETCH_GTEST "Fetch the pinned GoogleTest source when it is not installed" OFF)
option(ACIM_ENABLE_TRACY "Instrument host targets with the Tracy profiler" OFF)
option(ACIM_FETCH_TRACY "Fetch the pinned Tracy source when it is not installed" OFF)

if(ACIM_FETCH_GTEST AND NOT ACIM_ENABLE_GTEST)
    message(FATAL_ERROR "ACIM_FETCH_GTEST requires ACIM_ENABLE_GTEST=ON")
endif()

if(ACIM_FETCH_TRACY AND NOT ACIM_ENABLE_TRACY)
    message(FATAL_ERROR "ACIM_FETCH_TRACY requires ACIM_ENABLE_TRACY=ON")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ProjectOptions)

add_library(acim_profiling INTERFACE)
add_library(acim::profiling ALIAS acim_profiling)

if(ACIM_ENABLE_TRACY)
    if(ACIM_FETCH_TRACY)
        include(FetchContent)
        set(TRACY_ENABLE ON CACHE BOOL "" FORCE)
        set(TRACY_ON_DEMAND ON CACHE BOOL "" FORCE)
        set(TRACY_ONLY_LOCALHOST ON CACHE BOOL "" FORCE)
        set(TRACY_NO_BROADCAST ON CACHE BOOL "" FORCE)
        FetchContent_Declare(
            tracy
            URL
                https://github.com/wolfpld/tracy/archive/05cceee0df3b8d7c6fa87e9638af311dbabc63cb.zip
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        )
        FetchContent_MakeAvailable(tracy)
    else()
        find_package(Tracy CONFIG REQUIRED)
    endif()

    target_compile_definitions(acim_profiling INTERFACE ACIM_TRACY_ENABLED=1)
    target_link_libraries(acim_profiling INTERFACE Tracy::TracyClient)
endif()

add_library(acim_device_trace INTERFACE)
add_library(acim::device_trace ALIAS acim_device_trace)
target_include_directories(
    acim_device_trace
    INTERFACE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/firmware/include>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)

configure_file(
    cmake/build-manifest.txt.in
    "${CMAKE_CURRENT_BINARY_DIR}/acim-build-manifest.txt"
    @ONLY
)

add_library(acim_sim STATIC src/simulator.cpp)
add_library(acim::sim ALIAS acim_sim)

target_compile_features(acim_sim PUBLIC cxx_std_20)
target_include_directories(
    acim_sim
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
target_link_libraries(acim_sim PRIVATE acim::profiling)
acim_configure_target(acim_sim)

add_library(acim_trace STATIC src/trace_correlation.cpp)
add_library(acim::trace ALIAS acim_trace)
target_compile_features(acim_trace PUBLIC cxx_std_20)
target_include_directories(
    acim_trace
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
target_link_libraries(acim_trace PRIVATE acim::profiling)
acim_configure_target(acim_trace)

add_executable(acim_smoke apps/acim_smoke.cpp)
target_link_libraries(acim_smoke PRIVATE acim::sim acim::profiling)
acim_configure_target(acim_smoke)

if(BUILD_TESTING)
    add_executable(acim_unit_tests tests/simulator_test.cpp)
    target_link_libraries(acim_unit_tests PRIVATE acim::sim)
    acim_configure_target(acim_unit_tests)

    add_executable(acim_trace_tests tests/trace_test.cpp)
    target_link_libraries(acim_trace_tests PRIVATE acim::device_trace acim::trace)
    acim_configure_target(acim_trace_tests)

    add_executable(acim_device_trace_c_test tests/device_trace_c_test.c)
    target_compile_features(acim_device_trace_c_test PRIVATE c_std_11)
    target_link_libraries(acim_device_trace_c_test PRIVATE acim::device_trace)
    acim_configure_target(acim_device_trace_c_test)

    add_test(NAME acim.unit.functional_simulator COMMAND acim_unit_tests)
    set_tests_properties(
        acim.unit.functional_simulator
        PROPERTIES LABELS "unit" TIMEOUT 10
    )

    add_test(NAME acim.unit.device_trace COMMAND acim_trace_tests)
    set_tests_properties(
        acim.unit.device_trace
        PROPERTIES LABELS "unit;device-trace" TIMEOUT 10
    )

    add_test(NAME acim.unit.device_trace_c_abi COMMAND acim_device_trace_c_test)
    set_tests_properties(
        acim.unit.device_trace_c_abi
        PROPERTIES LABELS "unit;device-trace;c-abi" TIMEOUT 10
    )

    add_test(NAME acim.smoke.functional_simulator COMMAND acim_smoke)
    set_tests_properties(
        acim.smoke.functional_simulator
        PROPERTIES LABELS "smoke" TIMEOUT 10
    )

    if(ACIM_ENABLE_GTEST)
        if(ACIM_FETCH_GTEST)
            include(FetchContent)
            FetchContent_Declare(
                googletest
                URL
                    https://github.com/google/googletest/archive/52eb8108c5bdec04579160ae17225d66034bd723.zip
                DOWNLOAD_EXTRACT_TIMESTAMP TRUE
            )
            set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
            FetchContent_MakeAvailable(googletest)
        else()
            find_package(GTest CONFIG REQUIRED)
        endif()

        add_executable(acim_gtests tests/simulator_gtest.cpp)
        target_link_libraries(acim_gtests PRIVATE acim::sim GTest::gtest_main)
        acim_configure_target(acim_gtests)

        include(GoogleTest)
        gtest_discover_tests(
            acim_gtests
            PROPERTIES LABELS "unit;gtest"
            DISCOVERY_TIMEOUT 30
        )
    endif()
endif()

install(
    TARGETS acim_sim acim_trace acim_smoke
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(DIRECTORY firmware/include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(
    FILES "${CMAKE_CURRENT_BINARY_DIR}/acim-build-manifest.txt"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/acim-minimal"
)
