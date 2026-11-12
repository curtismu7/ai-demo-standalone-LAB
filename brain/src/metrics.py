# Copied from AI-DEMO2 langchain_agent/src/metrics.py (MIT; see docs/PROVENANCE.md)
# and reduced to in-process counters (no OpenTelemetry / Prometheus in this lab).
"""Minimal metrics for the brain sidecar: counters only, exposed on /health."""

import time

_START = time.time()

class _Counter:
    def __init__(self):
        self.n = 0

    def add(self, _amount=1, **_kwargs):
        self.n += 1

class _Histogram:
    def __init__(self):
        self.observations = []

    def record(self, value, **_kwargs):
        self.observations.append(value)

run_duration = _Histogram()
run_errors = _Counter()

def snapshot():
    n = len(run_duration.observations)
    return {
        "runs": n,
        "run_errors": run_errors.n,
        "run_latency_avg_s": round(sum(run_duration.observations) / n, 2) if n else None,
        "uptime_s": round(time.time() - _START, 1),
    }
