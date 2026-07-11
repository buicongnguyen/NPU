#pragma once

#if defined(ACIM_TRACY_ENABLED)
#include <tracy/Tracy.hpp>

#define ACIM_PROFILE_ZONE(name_literal) ZoneScopedN(name_literal)
#define ACIM_PROFILE_FRAME(name_literal) FrameMarkNamed(name_literal)
#define ACIM_PROFILE_PLOT(name_literal, value) TracyPlot(name_literal, static_cast<double>(value))
#define ACIM_PROFILE_MESSAGE(message_literal) TracyMessageL(message_literal)
#else
#define ACIM_PROFILE_ZONE(name_literal) static_cast<void>(0)
#define ACIM_PROFILE_FRAME(name_literal) static_cast<void>(0)
#define ACIM_PROFILE_PLOT(name_literal, value) static_cast<void>(0)
#define ACIM_PROFILE_MESSAGE(message_literal) static_cast<void>(0)
#endif
