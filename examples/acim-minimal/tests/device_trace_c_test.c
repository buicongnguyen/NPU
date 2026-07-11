#include "acim/device_events.h"
#include "acim/device_trace.h"

#include <stdint.h>

int main(void) {
    AcimTraceBatchHeader header = {0};
    AcimTraceRecord records[2] = {0};
    AcimTraceBuffer buffer = {0};
    const uint32_t capacity = (uint32_t)(sizeof(records) / sizeof(records[0]));

    if (!acim_trace_buffer_init(&buffer, &header, records, capacity, UINT32_C(1),
                                ACIM_DEVICE_EVENT_DICTIONARY_VERSION, UINT64_C(250000000),
                                UINT64_C(3), UINT64_C(7), UINT32_C(11))) {
        return 1;
    }
    if (!acim_trace_zone_begin(&buffer, UINT64_C(10), ACIM_EVENT_ADC_CONVERT, UINT16_C(1))) {
        return 2;
    }
    if (!acim_trace_zone_end(&buffer, UINT64_C(30), ACIM_EVENT_ADC_CONVERT, UINT16_C(1))) {
        return 3;
    }

    return header.abi_version == ACIM_TRACE_ABI_VERSION && header.record_count == 2u &&
                   records[0].command_id == UINT32_C(11) &&
                   records[0].kind == ACIM_TRACE_KIND_ZONE_BEGIN &&
                   records[1].kind == ACIM_TRACE_KIND_ZONE_END
               ? 0
               : 4;
}
