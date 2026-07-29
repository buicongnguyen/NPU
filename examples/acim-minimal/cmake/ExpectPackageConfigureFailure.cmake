foreach(required_variable IN ITEMS CONSUMER_SOURCE_DIR CONSUMER_BINARY_DIR PACKAGE_PREFIX)
    if(NOT DEFINED ${required_variable} OR "${${required_variable}}" STREQUAL "")
        message(FATAL_ERROR "${required_variable} is required")
    endif()
endforeach()

execute_process(
    COMMAND
        "${CMAKE_COMMAND}"
        -S "${CONSUMER_SOURCE_DIR}"
        -B "${CONSUMER_BINARY_DIR}"
        -G Ninja
        -DCMAKE_BUILD_TYPE=Release
        "-DCMAKE_PREFIX_PATH=${PACKAGE_PREFIX}"
    RESULT_VARIABLE configure_result
    OUTPUT_VARIABLE configure_stdout
    ERROR_VARIABLE configure_stderr
)

string(CONCAT configure_log "${configure_stdout}" "\n" "${configure_stderr}")
if(configure_result EQUAL 0)
    message(
        FATAL_ERROR
        "A Release consumer unexpectedly accepted a Debug-only acim_minimal package"
    )
endif()

if(NOT configure_log MATCHES
   "does not contain artifacts for requested[ \r\n]+configuration\\(s\\): Release")
    message(
        FATAL_ERROR
        "The expected configuration-mismatch diagnostic was not emitted:\n${configure_log}"
    )
endif()

message(STATUS "Debug-only package correctly rejected the Release consumer")
