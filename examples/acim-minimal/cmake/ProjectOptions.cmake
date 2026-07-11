include_guard(GLOBAL)

function(acim_configure_target target_name)
    set_target_properties(${target_name} PROPERTIES CXX_EXTENSIONS OFF)

    if(MSVC)
        target_compile_options(
            ${target_name}
            PRIVATE
                /W4
                $<$<COMPILE_LANGUAGE:CXX>:/permissive->
                $<$<COMPILE_LANGUAGE:CXX>:/Zc:__cplusplus>
        )
        if(ACIM_WARNINGS_AS_ERRORS)
            target_compile_options(${target_name} PRIVATE /WX)
        endif()
    else()
        target_compile_options(
            ${target_name}
            PRIVATE
                -Wall
                -Wextra
                -Wpedantic
                -Wconversion
                -Wsign-conversion
        )
        if(ACIM_WARNINGS_AS_ERRORS)
            target_compile_options(${target_name} PRIVATE -Werror)
        endif()
    endif()

    if(ACIM_ENABLE_SANITIZERS)
        if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU" AND NOT WIN32)
            target_compile_options(
                ${target_name}
                PRIVATE
                    -fsanitize=address,undefined
                    -fno-omit-frame-pointer
            )

            get_target_property(target_type ${target_name} TYPE)
            if(NOT target_type STREQUAL "STATIC_LIBRARY")
                target_link_options(${target_name} PRIVATE -fsanitize=address,undefined)
            endif()
        else()
            message(
                FATAL_ERROR
                "ACIM_ENABLE_SANITIZERS currently supports GCC or Clang on non-Windows hosts"
            )
        endif()
    endif()
endfunction()
