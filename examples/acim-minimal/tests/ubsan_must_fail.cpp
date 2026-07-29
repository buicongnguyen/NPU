#include <limits>

int main() {
    volatile int maximum = std::numeric_limits<int>::max();
    const int overflow = maximum + 1;
    return overflow == std::numeric_limits<int>::min() ? 0 : 1;
}
