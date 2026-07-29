#include "acim/device_events.h"
#include "acim/device_trace.h"

#if !defined(__STDC_VERSION__) || __STDC_VERSION__ < 201112L
#error "acim::device_trace must propagate its C11 public-header requirement"
#endif

int main(void) {
    AcimTraceBatchHeader header = {0};
    AcimTraceRecord record = {0};
    AcimTraceBuffer buffer = {0};

    if (!acim_trace_buffer_init(&buffer, &header, &record, UINT32_C(1), UINT32_C(2),
                                ACIM_DEVICE_EVENT_DICTIONARY_VERSION, UINT64_C(500000000),
                                UINT64_C(3), UINT64_C(4), UINT32_C(5))) {
        return 1;
    }
    if (!acim_trace_counter(&buffer, UINT64_C(6), ACIM_EVENT_RETRY_COUNT, UINT16_C(7),
                            INT64_C(8))) {
        return 2;
    }

    return header.record_count == UINT32_C(1) && record.sequence == UINT32_C(0) &&
                   record.value == INT64_C(8)
               ? 0
               : 3;
}
