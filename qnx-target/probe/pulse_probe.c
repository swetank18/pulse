/*
 * pulse-probe: Phase 0 "hello world" for PULSE on QNX 8.0.
 *
 * Proves, on QEMU and Raspberry Pi 5, the four QNX mechanisms pulse-core is built on:
 *   1. SCHED_FIFO priority for the measuring thread  (pthread_setschedparam)
 *   2. a periodic POSIX timer that delivers a pulse   (timer_create + SIGEV_PULSE_INIT)
 *   3. blocking on a private channel for that pulse   (ChannelCreate + MsgReceivePulse)
 *   4. cycle-accurate timestamps                      (ClockCycles + SYSPAGE qtime)
 *
 * It measures the interval between consecutive wake-ups and prints min / avg / max and the
 * worst deviation from the requested period. No JSON output: that is pulse-core's job.
 *
 * Usage: pulse-probe [period_us=1000] [wakeups=5000] [priority=50]
 * Priorities above 63 need root (or the PROCMGR_AID_PRIORITY ability).
 */
#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/neutrino.h>
#include <sys/siginfo.h>
#include <sys/syspage.h>

#define PULSE_CODE_TICK (_PULSE_CODE_MINAVAIL + 0)

static long arg_or(int argc, char **argv, int i, long fallback)
{
    return (argc > i) ? strtol(argv[i], NULL, 10) : fallback;
}

static struct timespec us_to_timespec(long us)
{
    struct timespec ts = { .tv_sec = us / 1000000L, .tv_nsec = (us % 1000000L) * 1000L };
    return ts;
}

int main(int argc, char **argv)
{
    const long period_us = arg_or(argc, argv, 1, 1000);
    const long wakeups   = arg_or(argc, argv, 2, 5000);
    const int  priority  = (int)arg_or(argc, argv, 3, 50);

    if (period_us <= 0 || wakeups <= 0) {
        fprintf(stderr, "usage: %s [period_us>0] [wakeups>0] [priority]\n", argv[0]);
        return 2;
    }

    /* 1. Real-time priority for this thread. */
    struct sched_param sp = { .sched_priority = priority };
    int rc = pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
    if (rc != EOK) {
        fprintf(stderr, "pthread_setschedparam(SCHED_FIFO, %d): %s\n", priority, strerror(rc));
        return 1;
    }

    /* 3. Private channel plus a side-channel connection the timer can send pulses on. */
    int chid = ChannelCreate(0);
    if (chid == -1) { perror("ChannelCreate"); return 1; }
    int coid = ConnectAttach(0, 0, chid, _NTO_SIDE_CHANNEL, 0);
    if (coid == -1) { perror("ConnectAttach"); return 1; }

    /* 2. Periodic timer that delivers a pulse at our priority. */
    struct sigevent ev;
    SIGEV_PULSE_INIT(&ev, coid, priority, PULSE_CODE_TICK, 0);
    timer_t timer_id;
    if (timer_create(CLOCK_MONOTONIC, &ev, &timer_id) == -1) { perror("timer_create"); return 1; }

    struct _clockperiod tick;
    if (ClockPeriod(CLOCK_MONOTONIC, NULL, &tick, 0) == -1) { perror("ClockPeriod"); return 1; }

    /* 4. Cycle counter rate from the system page. */
    const uint64_t cps = SYSPAGE_ENTRY(qtime)->cycles_per_sec;
    printf("pulse-probe: period=%ld us wakeups=%ld prio=%d tick=%lu ns cycles/s=%" PRIu64 "\n",
           period_us, wakeups, priority, (unsigned long)tick.nsec, cps);

    struct itimerspec its = { .it_value = us_to_timespec(period_us), .it_interval = us_to_timespec(period_us) };
    if (timer_settime(timer_id, 0, &its, NULL) == -1) { perror("timer_settime"); return 1; }

    uint64_t prev = 0, min_c = UINT64_MAX, max_c = 0, sum_c = 0;
    long measured = 0;
    while (measured < wakeups) {
        struct _pulse pulse;
        if (MsgReceivePulse(chid, &pulse, sizeof pulse, NULL) == -1) {
            if (errno == EINTR) continue;
            perror("MsgReceivePulse");
            return 1;
        }
        if (pulse.code != PULSE_CODE_TICK) continue;

        const uint64_t now = ClockCycles();
        if (prev != 0) {
            const uint64_t d = now - prev;
            if (d < min_c) min_c = d;
            if (d > max_c) max_c = d;
            sum_c += d;
            measured++;
        }
        prev = now;
    }
    timer_delete(timer_id);

    const double us_per_cycle = 1e6 / (double)cps;
    const double min_us = (double)min_c * us_per_cycle;
    const double max_us = (double)max_c * us_per_cycle;
    const double avg_us = (double)sum_c / (double)measured * us_per_cycle;
    const double worst_dev = (max_us - period_us) > (period_us - min_us) ? (max_us - period_us) : (period_us - min_us);

    printf("intervals: n=%ld min=%.1f us avg=%.1f us max=%.1f us worst deviation=%.1f us\n",
           measured, min_us, avg_us, max_us, worst_dev);
    printf("pulse-probe: OK\n");
    return 0;
}
