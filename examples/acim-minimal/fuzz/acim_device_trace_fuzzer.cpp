#include "acim/device_trace.h"

#include <array>
#include <cstddef>
#include <cstdint>

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t *data, const std::size_t size) {
    if (size < 2)
        return 0;

    AcimTraceBatchHeader header{};
    std::array<AcimTraceRecord, 32> records{};
    AcimTraceBuffer buffer{};
    const auto capacity = static_cast<std::uint32_t>((data[0] % records.size()) + 1u);
    if (!acim_trace_buffer_init(&buffer, &header, records.data(), capacity, data[1], 1u,
                                1'000'000u + data[0], data[1], data[0], data[1])) {
        return 0;
    }

    std::uint64_t cycle = 0;
    for (std::size_t index = 2; index < size; ++index) {
        cycle += data[index];
        const auto event = static_cast<std::uint32_t>(data[index]);
        const auto source = static_cast<std::uint16_t>(index);
        switch (data[index] % 4u) {
        case 0:
            acim_trace_zone_begin(&buffer, cycle, event, source);
            break;
        case 1:
            acim_trace_zone_end(&buffer, cycle, event, source);
            break;
        case 2:
            acim_trace_counter(&buffer, cycle, event, source, data[index]);
            break;
        default:
            acim_trace_clock_sync(&buffer, cycle, source, data[index]);
            break;
        }
    }

    if (header.record_count > capacity || header.record_count > records.size())
        __builtin_trap();
    return 0;
}
