#ifndef ACIM_DEVICE_TRACE_H
#define ACIM_DEVICE_TRACE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ACIM_TRACE_ABI_VERSION 2u
#define ACIM_TRACE_BYTE_ORDER_LITTLE_ENDIAN 1u
#define ACIM_TRACE_KIND_ZONE_BEGIN ((uint8_t)1u)
#define ACIM_TRACE_KIND_ZONE_END ((uint8_t)2u)
#define ACIM_TRACE_KIND_COUNTER ((uint8_t)3u)
#define ACIM_TRACE_KIND_CLOCK_SYNC ((uint8_t)4u)
#define ACIM_TRACE_FLAG_NONE ((uint8_t)0u)
#define ACIM_TRACE_FLAG_ERROR ((uint8_t)1u)

typedef struct AcimTraceRecord {
    uint64_t cycle;
    int64_t value;
    uint32_t sequence;
    uint32_t event_id;
    uint16_t source_id;
    uint8_t kind;
    uint8_t flags;
    uint32_t command_id;
} AcimTraceRecord;

typedef struct AcimTraceBatchHeader {
    uint32_t abi_version;
    uint32_t header_size;
    uint32_t record_size;
    uint32_t record_count;
    uint32_t dropped_records;
    uint32_t clock_domain_id;
    uint32_t event_dictionary_version;
    uint32_t byte_order;
    uint64_t clock_hz;
    uint64_t clock_epoch;
    uint64_t capture_id;
} AcimTraceBatchHeader;

/* This pointer-bearing descriptor is device-local and is not part of the transfer ABI.
 * One producer owns it. Transfer only the header and records after completion, or place
 * two buffers behind a firmware/host ownership handshake for live collection. */
typedef struct AcimTraceBuffer {
    AcimTraceBatchHeader *header;
    AcimTraceRecord *records;
    uint32_t capacity;
    uint32_t next_sequence;
    uint32_t current_command_id;
} AcimTraceBuffer;

#if defined(__cplusplus)
static_assert(sizeof(AcimTraceRecord) == 32u, "ACiM trace record ABI changed");
static_assert(sizeof(AcimTraceBatchHeader) == 56u, "ACiM trace header ABI changed");
static_assert(offsetof(AcimTraceRecord, cycle) == 0u, "ACiM trace cycle offset changed");
static_assert(offsetof(AcimTraceRecord, value) == 8u, "ACiM trace value offset changed");
static_assert(offsetof(AcimTraceRecord, sequence) == 16u, "ACiM trace sequence offset changed");
static_assert(offsetof(AcimTraceRecord, event_id) == 20u, "ACiM trace event offset changed");
static_assert(offsetof(AcimTraceRecord, source_id) == 24u, "ACiM trace source offset changed");
static_assert(offsetof(AcimTraceRecord, kind) == 26u, "ACiM trace kind offset changed");
static_assert(offsetof(AcimTraceRecord, flags) == 27u, "ACiM trace flags offset changed");
static_assert(offsetof(AcimTraceRecord, command_id) == 28u, "ACiM trace command offset changed");
static_assert(offsetof(AcimTraceBatchHeader, clock_hz) == 32u, "ACiM trace clock offset changed");
static_assert(offsetof(AcimTraceBatchHeader, capture_id) == 48u,
              "ACiM trace capture offset changed");
#else
_Static_assert(sizeof(AcimTraceRecord) == 32u, "ACiM trace record ABI changed");
_Static_assert(sizeof(AcimTraceBatchHeader) == 56u, "ACiM trace header ABI changed");
_Static_assert(offsetof(AcimTraceRecord, cycle) == 0u, "ACiM trace cycle offset changed");
_Static_assert(offsetof(AcimTraceRecord, value) == 8u, "ACiM trace value offset changed");
_Static_assert(offsetof(AcimTraceRecord, sequence) == 16u, "ACiM trace sequence offset changed");
_Static_assert(offsetof(AcimTraceRecord, event_id) == 20u, "ACiM trace event offset changed");
_Static_assert(offsetof(AcimTraceRecord, source_id) == 24u, "ACiM trace source offset changed");
_Static_assert(offsetof(AcimTraceRecord, kind) == 26u, "ACiM trace kind offset changed");
_Static_assert(offsetof(AcimTraceRecord, flags) == 27u, "ACiM trace flags offset changed");
_Static_assert(offsetof(AcimTraceRecord, command_id) == 28u, "ACiM trace command offset changed");
_Static_assert(offsetof(AcimTraceBatchHeader, clock_hz) == 32u, "ACiM trace clock offset changed");
_Static_assert(offsetof(AcimTraceBatchHeader, capture_id) == 48u,
               "ACiM trace capture offset changed");
#endif

static inline bool acim_trace_native_byte_order_supported(void) {
    const uint64_t marker = UINT64_C(0x0102030405060708);
    const unsigned char *bytes = (const unsigned char *)&marker;
    return bytes[0] == 0x08u && bytes[1] == 0x07u && bytes[2] == 0x06u && bytes[3] == 0x05u &&
           bytes[4] == 0x04u && bytes[5] == 0x03u && bytes[6] == 0x02u && bytes[7] == 0x01u;
}

static inline bool acim_trace_buffer_init(AcimTraceBuffer *buffer, AcimTraceBatchHeader *header,
                                          AcimTraceRecord *records, uint32_t capacity,
                                          uint32_t clock_domain_id,
                                          uint32_t event_dictionary_version, uint64_t clock_hz,
                                          uint64_t clock_epoch, uint64_t capture_id,
                                          uint32_t initial_command_id) {
    if (!acim_trace_native_byte_order_supported() || buffer == NULL || header == NULL ||
        records == NULL || capacity == 0u || event_dictionary_version == 0u || clock_hz == 0u) {
        return false;
    }

    header->abi_version = ACIM_TRACE_ABI_VERSION;
    header->header_size = (uint32_t)sizeof(AcimTraceBatchHeader);
    header->record_size = (uint32_t)sizeof(AcimTraceRecord);
    header->record_count = 0u;
    header->dropped_records = 0u;
    header->clock_domain_id = clock_domain_id;
    header->event_dictionary_version = event_dictionary_version;
    header->byte_order = ACIM_TRACE_BYTE_ORDER_LITTLE_ENDIAN;
    header->clock_hz = clock_hz;
    header->clock_epoch = clock_epoch;
    header->capture_id = capture_id;

    buffer->header = header;
    buffer->records = records;
    buffer->capacity = capacity;
    buffer->next_sequence = 0u;
    buffer->current_command_id = initial_command_id;
    return true;
}

static inline void acim_trace_set_command_id(AcimTraceBuffer *buffer, uint32_t command_id) {
    if (buffer != NULL) {
        buffer->current_command_id = command_id;
    }
}

static inline bool acim_trace_emit(AcimTraceBuffer *buffer, uint64_t cycle, uint32_t event_id,
                                   uint16_t source_id, uint8_t kind, uint8_t flags, int64_t value) {
    AcimTraceBatchHeader *header;
    AcimTraceRecord *record;

    if (buffer == NULL || buffer->header == NULL || buffer->records == NULL) {
        return false;
    }

    header = buffer->header;
    if (header->record_count >= buffer->capacity) {
        if (header->dropped_records != UINT32_MAX) {
            ++header->dropped_records;
        }
        return false;
    }

    if (header->record_count > 0u && cycle < buffer->records[header->record_count - 1u].cycle) {
        if (header->dropped_records != UINT32_MAX) {
            ++header->dropped_records;
        }
        return false;
    }

    record = &buffer->records[header->record_count];
    record->cycle = cycle;
    record->value = value;
    record->sequence = buffer->next_sequence;
    record->event_id = event_id;
    record->source_id = source_id;
    record->kind = kind;
    record->flags = flags;
    record->command_id = buffer->current_command_id;

    ++buffer->next_sequence;
    ++header->record_count;
    return true;
}

static inline bool acim_trace_zone_begin(AcimTraceBuffer *buffer, uint64_t cycle, uint32_t event_id,
                                         uint16_t source_id) {
    return acim_trace_emit(buffer, cycle, event_id, source_id, ACIM_TRACE_KIND_ZONE_BEGIN,
                           ACIM_TRACE_FLAG_NONE, 0);
}

static inline bool acim_trace_zone_end(AcimTraceBuffer *buffer, uint64_t cycle, uint32_t event_id,
                                       uint16_t source_id) {
    return acim_trace_emit(buffer, cycle, event_id, source_id, ACIM_TRACE_KIND_ZONE_END,
                           ACIM_TRACE_FLAG_NONE, 0);
}

static inline bool acim_trace_counter(AcimTraceBuffer *buffer, uint64_t cycle, uint32_t event_id,
                                      uint16_t source_id, int64_t value) {
    return acim_trace_emit(buffer, cycle, event_id, source_id, ACIM_TRACE_KIND_COUNTER,
                           ACIM_TRACE_FLAG_NONE, value);
}

static inline bool acim_trace_clock_sync(AcimTraceBuffer *buffer, uint64_t cycle,
                                         uint16_t source_id, int64_t host_cookie) {
    return acim_trace_emit(buffer, cycle, 0u, source_id, ACIM_TRACE_KIND_CLOCK_SYNC,
                           ACIM_TRACE_FLAG_NONE, host_cookie);
}

#ifdef __cplusplus
}
#endif

#endif
