if(NOT DEFINED TEST_PROGRAM)
    message(FATAL_ERROR "TEST_PROGRAM is required")
endif()

execute_process(
    COMMAND "${TEST_PROGRAM}"
    RESULT_VARIABLE test_result
    OUTPUT_VARIABLE test_stdout
    ERROR_VARIABLE test_stderr
)

if("${test_result}" STREQUAL "0")
    message(FATAL_ERROR "UBSan recovered instead of terminating the undefined operation")
endif()

set(test_output "${test_stdout}\n${test_stderr}")
if(NOT test_output MATCHES "runtime error")
    message(FATAL_ERROR "The expected UBSan diagnostic was not emitted:\n${test_output}")
endif()
