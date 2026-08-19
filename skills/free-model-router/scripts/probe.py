#!/usr/bin/env python3
"""Probe candidate model routes for liveness before routing work to them.

Usage:
    probe.py                      # probe all routes in references/pool.yaml
    probe.py <route-id> ...       # probe only named routes

Exits 0 if every probed route is alive (or none requested), 1 otherwise.
Reads auth keys ONLY from the environment / secret store — never from files.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "probe.py requires PyYAML. Install it with: pip install pyyaml\n"
    )
    sys.exit(2)

POOL = Path(__file__).resolve().parent.parent / "references" / "pool.yaml"

# Probe strategies per route. Each returns (alive: bool, detail: str).
def _probe_letta_agent(route: dict) -> tuple[bool, str]:
    """Best-effort: run a 1-token letta prompt via the pinned agent."""
    target = route.get("target", "")
    agent_id = target.split()[-1] if target else ""
    if not agent_id.startswith("agent-"):
        return False, "no agent id in target"
    cmd = ["letta", "-p", "ping", "--agent", agent_id]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"run failed: {exc}"
    if r.returncode == 0 and "401" not in (r.stdout + r.stderr):
        return True, "letta agent responded"
    return False, (r.stderr or r.stdout or "no output")[:300]


def _probe_opencode(route: dict) -> tuple[bool, str]:
    """Probe an opencode provider slot via `opencode models <provider>` and,
    for key-less free slots, a real 1-token call.

    Listing a model only proves the slot exists in opencode's catalog — a
    route is truly usable only when `opencode run` answers. We do the live
    call for slots marked `byok: false` (key-less); BYOK slots can't be
    verified without a key, so listing is the best we can do here.
    """
    model = route.get("model", "")
    provider = route.get("provider", model.split("/")[0] if "/" in model else "")
    cmd = ["opencode", "models"]
    if provider:
        cmd.append(provider)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"opencode unavailable: {exc}"
    if r.returncode != 0 or model not in r.stdout:
        return False, (r.stderr or r.stdout or "no output")[:300]

    if route.get("byok"):
        return True, f"opencode lists {model} (BYOK — live call needs a key)"
    try:
        call = subprocess.run(
            ["opencode", "run", "--model", model, "Reply with exactly: PONG"],
            capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"opencode run failed: {exc}"
    if call.returncode == 0 and "PONG" in (call.stdout or ""):
        return True, f"opencode run -> PONG ({model})"
    return False, (call.stderr or call.stdout or "no output")[:300]


def _probe_openai_compatible(route: dict) -> tuple[bool, str]:
    """Probe an OpenAI-compatible endpoint with a trivial chat completion.

    Requires env vars named in the route's auth (or an OPENAI_API_KEY-style
    var) — a probe without a key can only report the endpoint is configured.
    """
    base = os.environ.get(route.get("env_base", ""))
    if not base:
        return False, f"no base url env var ({route.get('env_base', '?')})"
    model = route.get("model", "")
    key = os.environ.get(route.get("env_key", "OPENAI_API_KEY"), "")
    if not key:
        return False, "no api key env var; cannot probe"
    payload = json.dumps({
        "model": model, "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
    })
    cmd = ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
           "-H", "Content-Type: application/json",
           "-H", f"Authorization: Bearer {key}",
           "-d", payload, f"{base.rstrip('/')}/chat/completions"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"curl failed: {exc}"
    return r.stdout.strip() == "200", f"http {r.stdout.strip()}"


PROBERS = {
    "letta": _probe_letta_agent,
    "opencode": _probe_opencode,
    "openai-compatible": _probe_openai_compatible,
}


def main() -> int:
    pool = yaml.safe_load(POOL.read_text(encoding="utf-8"))
    wanted = set(sys.argv[1:])
    failed = False
    for route in pool.get("routes", []):
        rid = route.get("id", "?")
        if wanted and rid not in wanted:
            continue
        kind = route.get("type", "openai-compatible")
        prober = PROBERS.get(kind, _probe_openai_compatible)
        alive, detail = prober(route)
        flag = "OK " if alive else "FAIL"
        print(f"[{flag}] {rid}: {detail}")
        if not alive:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
