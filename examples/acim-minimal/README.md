# Minimal ACiM Native Build

This example proves the first host-only build path for an Analog Compute-in-Memory
(ACiM) software repository. It implements a deterministic integer matrix-vector
multiplication (MVM), applies an ADC-like output clamp, exposes a small C++ API,
builds a smoke executable, and registers native unit tests with CTest.

It is a functional software model, not a transistor-, circuit-, timing-, noise-,
or silicon-accurate analog simulator.

## Required tools

- CMake 3.24 or newer
- Ninja
- One C11/C++20 compiler toolchain: GCC/G++, Clang/Clang++, or MSVC
- Optional: GoogleTest installed as a CMake package
- Optional: Tracy 0.13.1 for host timeline capture
- Optional: clang-format, clang-tidy, GDB/LLDB, and compiler sanitizers

Verify the active tools before configuring:

```console
cmake --version
ninja --version
cc --version       # GCC/Clang C driver
c++ --version      # GCC/Clang C++ driver
cl                 # MSVC Developer PowerShell
```

## Build with GCC on Linux

```console
cmake --preset gcc
cmake --build --preset gcc
ctest --preset gcc
./build/gcc/acim_smoke
```

## Build with Clang on Linux

```console
cmake --preset clang
cmake --build --preset clang
ctest --preset clang

cmake --preset asan-clang
cmake --build --preset asan-clang
ctest --preset asan-clang
```

The sanitizer preset enables AddressSanitizer and UndefinedBehaviorSanitizer.
ThreadSanitizer should be a separate preset because major sanitizers cannot all be
combined in one binary.

## Build with MSVC on Windows

Open a Visual Studio Developer PowerShell so `cl.exe`, CMake, and Ninja are available:

```console
cmake --preset msvc
cmake --build --preset msvc
ctest --preset msvc
build\msvc\acim_smoke.exe
```

## Portable command without presets

```console
cmake -S . -B build/dev -G Ninja -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON
cmake --build build/dev
ctest --test-dir build/dev --output-on-failure
```

## Optional GoogleTest suite

The default tests have no external dependency. When GoogleTest is installed and
exports the `GTest::gtest_main` CMake target, enable the additional suite:

```console
cmake -S . -B build/gtest -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug \
  -DACIM_ENABLE_GTEST=ON \
  -DCMAKE_PREFIX_PATH=/path/to/googletest/install
cmake --build build/gtest
ctest --test-dir build/gtest --output-on-failure
```

For a one-time developer build without an installed package, explicitly enable the
pinned GoogleTest v1.17.0 FetchContent path, following the official CMake quickstart pattern:

```console
cmake -S . -B build/gtest-fetch -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug \
  -DACIM_ENABLE_GTEST=ON \
  -DACIM_FETCH_GTEST=ON
cmake --build build/gtest-fetch
ctest --test-dir build/gtest-fetch --output-on-failure
```

For a larger repository, a dependency provider, package manager, or pinned
`FetchContent` declaration can supply GoogleTest. Keep network downloads out of the
default configure path used for offline development and reproducible release builds.

## Profile host code with Tracy

The default build compiles the profiling macros to no-ops. The `tracy` preset enables
on-demand, localhost-only host profiling with discovery broadcast disabled and fetches
upstream Tracy 0.13.1 at commit
`05cceee0df3b8d7c6fa87e9638af311dbabc63cb`:

```console
cmake --preset tracy
cmake --build --preset tracy
ctest --preset tracy
```

Start the Tracy profiler application, connect to `127.0.0.1`, and then run
`build/tracy/acim_smoke` (`.exe` on Windows). The sample records host zones for the
request, validation, MVM/ADC work, clock fitting, frame completion, and numerical
counters. `include/acim/profiling.hpp` keeps Tracy-specific macros out of product code.
The FetchContent target builds and links `TracyClient`; obtain or build the desktop
Profiler from the same Tracy version separately.

For an installed Tracy package, use `-DACIM_ENABLE_TRACY=ON` without
`ACIM_FETCH_TRACY` and make its `Tracy::TracyClient` CMake target discoverable through
`CMAKE_PREFIX_PATH`. Keep profiling disabled in the official uninstrumented benchmark
and compare instrumented versus uninstrumented runs to quantify probe overhead.

## Trace device and analog-engine work

Ordinary Tracy host zones cannot represent work that already happened on a device:
creating a host zone while draining would timestamp the drain, not the MVM. The
firmware scaffold therefore uses a separate path:

1. `firmware/include/acim/device_trace.h` writes fixed 32-byte records containing a
   device cycle, sequence, event ID, source ID, kind, flags, and counter value.
2. `firmware/include/acim/device_events.h` assigns stable numeric IDs to dispatch,
   programming, calibration, DAC/input drive, array MVM, ADC, digital accumulation,
   DMA, saturation, retry, remap, and converter occupancy events.
3. One firmware producer owns each bounded buffer. The header records ABI sizes,
   clock domain/rate/epoch, event-dictionary version, capture ID, record count, and
   dropped-record count; every record carries its current command ID.
   The pointer-bearing `AcimTraceBuffer` helper is device-local; DMA only the fixed
   batch header and record array.
4. The runtime drains a completed buffer through MMIO or DMA. A live implementation
   must use double buffering plus an explicit producer/consumer ownership handshake.
5. `acim::trace::fit_clock_correlation` fits several host-send/device-cycle/
   host-receive samples and maps device cycles into the host monotonic timeline.

Use the mapped records for an accurate device CSV, Perfetto trace, or a maintained
Tracy protocol bridge that accepts explicit device timestamps. Upstream Tracy's normal
zone API is the direct host path; it should not be used to fabricate historical device
zones at drain time.

The trace unit test exercises ABI layout, event ordering, overflow reporting, invalid
clock samples, and a known two-nanosecond-per-cycle clock fit:

```console
ctest --preset dev -L device-trace
```

## Cross-compile the host runtime

The example includes `cmake/toolchains/aarch64-linux-gnu.cmake`. Install an AArch64
GNU cross-toolchain and optionally set `ACIM_SYSROOT` before configuring:

```console
ACIM_SYSROOT=/path/to/target/sysroot cmake \
  -S . -B build/aarch64 -G Ninja \
  --toolchain cmake/toolchains/aarch64-linux-gnu.cmake \
  -DBUILD_TESTING=OFF
cmake --build build/aarch64
```

Do not use this host-runtime toolchain for device firmware. Firmware needs its own
ISA, ABI, linker script, startup code, memory map, and usually a separate freestanding
CMake project. A Linux kernel-mode driver should use Kbuild; top-level CMake may
orchestrate it but should not replace the kernel build system.

## What to add next

1. Per-column ADC ranges and saturation counters.
2. Bit-sliced weights and digital partial-sum accumulation.
3. Deterministic programming error, read noise, and drift models.
4. A versioned target descriptor instead of hard-coded simulator parameters.
5. An artifact reader and fake-device HAL behind the same MVM contract.
6. Golden-vector sweeps across shapes, signs, ranges, and fault maps.
7. A DMA-backed double-buffered device trace drain and an explicit-timestamp viewer exporter.
