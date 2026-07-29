# ACiM Device Trace ABI

`device_trace.h` defines transfer ABI version 2. The ABI is intended for a firmware
producer and host consumer that may be built by different compilers.

## Wire representation

- Every integer is an unsigned or two's-complement fixed-width integer from
  `<stdint.h>`.
- All multibyte fields are little-endian. `byte_order` must contain
  `ACIM_TRACE_BYTE_ORDER_LITTLE_ENDIAN`; consumers must reject unknown values.
- The inline producer writes native C structs and therefore supports little-endian
  targets only. `acim_trace_buffer_init` rejects a big-endian target before writing
  a header.
- The batch header is 56 bytes and each record is 32 bytes. Compile-time assertions
  cover the record field offsets used by the wire format.
- Transfer the header followed by exactly `record_count` records. Reject a batch when
  its ABI version, byte order, header size, record size, or record count is invalid.
- `AcimTraceBuffer` is a pointer-bearing producer helper and is never transferred.
  Producers must not transmit uninitialized padding or the helper descriptor.

ABI version 2 assigns the header word at byte offset 28 to `byte_order`. Version 1
reserved that word as zero. This is intentionally a versioned, detectable change.

## Ownership and publication

Use two or more complete header/record slots and a separate naturally aligned
32-bit ownership word per slot. The ownership word is transport control state, not
part of the trace payload:

1. The host publishes `DEVICE_OWNED` with a release store after clearing or rearming
   a slot.
2. Firmware observes `DEVICE_OWNED` with an acquire load, writes records, then writes
   the final header counters.
3. Firmware publishes `HOST_OWNED` with a release store only after all payload writes
   are complete.
4. The host observes `HOST_OWNED` with an acquire load before reading the header or
   records. It validates and consumes the batch before returning the slot.

Use the platform's inter-core or device/host cache maintenance and DMA barriers in
addition to language-level atomics. `volatile` is not an ownership protocol. Never
write and drain the same slot concurrently.

## Clock epochs and sequence numbers

`clock_epoch` changes whenever the device clock resets, wraps, changes frequency, or
loses continuity. Correlation samples from different epochs must never be fitted
together. Within one batch, cycles are non-decreasing and record sequences are
strictly increasing. A producer rejects and counts a record whose cycle moves
backwards; equal-cycle records are allowed for events observed in the same cycle.
Sequence wrap is allowed only across a new capture or explicitly documented stream
reset. `dropped_records` saturates at `UINT32_MAX`.

Host clock fitting keeps the absolute host-time anchor as `uint64_t` and fits only
small offsets, so nanosecond deltas remain stable beyond `2^53`. Use
`device_cycle_to_host_timestamp_ns` for a checked integer timestamp;
`device_cycle_to_host_ns` is a floating-point convenience and cannot represent every
integer nanosecond at very large absolute times. The checked path splits a full-width
cycle delta into exactly representable limbs and retains the floating-point product
residual, including on MSVC where `long double` has the precision of `double`.

## Compatibility

Readers must dispatch on `abi_version` and reject newer formats unless they implement
them. Event IDs are versioned independently by `event_dictionary_version`. Unknown
event IDs may be preserved as opaque records when the enclosing ABI is understood.
