"""Core logic for the devin-bridge Hermes plugin.

Relays chat turns to a local Devin CLI (`devin --print`) and keeps one Devin
session bound per Hermes chat thread, so a Telegram/Discord/CLI conversation maps
onto a single continuous Devin conversation.
"""

import json
import os
import re
import subprocess
import threading
import time

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
DEFAULTS = {
    "workspace": "~/devin-chat",
    "devin_bin": "devin",
    "permission_mode": "normal",
    "model": "",
    "timeout": 900,
}


def hermes_home():
    return os.path.expanduser(os.environ.get("HERMES_HOME", "~/.hermes"))


def state_path():
    return os.path.join(hermes_home(), "devin-bridge", "threads.json")


def strip_ansi(text):
    return ANSI_RE.sub("", text).replace("\r", "")


class ThreadStore:
    """Thread key -> {session_id, workspace, continue_mode, updated_at}, persisted as JSON."""

    def __init__(self, path=None):
        self.path = path or state_path()
        self._lock = threading.Lock()

    def _read(self):
        try:
            with open(self.path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def get(self, key):
        return self._read().get(key, {})

    def set(self, key, **fields):
        with self._lock:
            data = self._read()
            entry = data.get(key, {})
            entry.update(fields)
            entry["updated_at"] = time.time()
            data[key] = entry
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2)
            os.replace(tmp, self.path)
            return entry

    def clear(self, key):
        with self._lock:
            data = self._read()
            removed = data.pop(key, None)
            if removed is not None:
                with open(self.path, "w", encoding="utf-8") as handle:
                    json.dump(data, handle, indent=2)
            return removed


def pick_latest_session(listing):
    """Pick the most recently touched session from `devin list --format json` output.

    Field names are read defensively: the CLI's JSON shape is not part of its documented
    contract, so any id-ish and time-ish key is accepted.
    """
    if isinstance(listing, dict):
        listing = listing.get("sessions", [])
    if not isinstance(listing, list):
        return None
    best, best_ts = None, None
    for entry in listing:
        if not isinstance(entry, dict):
            continue
        sid = next(
            (entry[k] for k in ("session_id", "id", "sessionId", "uuid") if isinstance(entry.get(k), str)),
            None,
        )
        if not sid:
            continue
        ts = next(
            (entry[k] for k in ("updated_at", "last_updated", "modified_at", "created_at", "timestamp")
             if entry.get(k) is not None),
            None,
        )
        key = str(ts) if ts is not None else ""
        if best is None or key > best_ts:
            best, best_ts = sid, key
    return best


def build_argv(config, prompt, session_id=None, continue_mode=False):
    argv = [config["devin_bin"], "--print", prompt, "--respect-workspace-trust", "false"]
    if session_id:
        argv += ["--resume", session_id]
    elif continue_mode:
        argv.append("--continue")
    if config.get("permission_mode"):
        argv += ["--permission-mode", config["permission_mode"]]
    if config.get("model"):
        argv += ["--model", config["model"]]
    return argv


class DevinBridge:
    def __init__(self, config_getter, store=None, runner=None):
        self._config_getter = config_getter
        self.store = store or ThreadStore()
        self._run = runner or self._run_subprocess
        self._locks = {}
        self._locks_guard = threading.Lock()

    def config(self, overrides=None):
        config = dict(DEFAULTS)
        try:
            config.update({k: v for k, v in (self._config_getter() or {}).items() if v not in (None, "")})
        except Exception:
            pass
        config.update({k: v for k, v in (overrides or {}).items() if v})
        config["workspace"] = os.path.expanduser(str(config["workspace"]))
        config["timeout"] = int(config["timeout"])
        return config

    def _lock_for(self, key):
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def _run_subprocess(self, argv, cwd, timeout):
        completed = subprocess.run(
            argv, cwd=cwd, timeout=timeout, capture_output=True, text=True, stdin=subprocess.DEVNULL
        )
        return completed.returncode, completed.stdout, completed.stderr

    def _discover_session(self, config):
        try:
            code, out, _ = self._run(
                [config["devin_bin"], "list", "--format", "json"], config["workspace"], 60
            )
        except Exception:
            return None
        if code != 0:
            return None
        try:
            return pick_latest_session(json.loads(strip_ansi(out) or "[]"))
        except ValueError:
            return None

    def ask(self, thread_key, prompt, new_session=False, workspace=None):
        prompt = (prompt or "").strip()
        if not prompt:
            return {"error": "empty prompt"}
        config = self.config({"workspace": workspace})
        if not os.path.isdir(config["workspace"]):
            return {"error": f"workspace does not exist: {config['workspace']}"}

        with self._lock_for(thread_key):
            entry = {} if new_session else self.store.get(thread_key)
            if new_session:
                self.store.clear(thread_key)
            bound = entry.get("session_id")
            if bound and entry.get("workspace") not in (None, config["workspace"]):
                bound = None
            argv = build_argv(
                config, prompt, session_id=bound, continue_mode=bool(entry.get("continue_mode")) and not bound
            )
            try:
                code, out, err = self._run(argv, config["workspace"], config["timeout"])
            except subprocess.TimeoutExpired:
                return {"error": f"devin did not answer within {config['timeout']}s"}
            except FileNotFoundError:
                return {"error": f"devin binary not found: {config['devin_bin']}"}
            except Exception as exc:  # never raise into the agent loop
                return {"error": f"devin invocation failed: {exc}"}

            reply = strip_ansi(out).strip()
            if code != 0:
                return {"error": (strip_ansi(err).strip() or reply or f"devin exited {code}")[:2000]}

            session_id = bound or self._discover_session(config)
            self.store.set(
                thread_key,
                session_id=session_id,
                workspace=config["workspace"],
                continue_mode=session_id is None,
            )
            return {
                "reply": reply,
                "session_id": session_id,
                "workspace": config["workspace"],
                "new_session": bound is None,
            }

    def status(self, thread_key):
        entry = self.store.get(thread_key)
        config = self.config()
        return {
            "bound": bool(entry.get("session_id") or entry.get("continue_mode")),
            "session_id": entry.get("session_id"),
            "workspace": entry.get("workspace") or config["workspace"],
            "devin_bin": config["devin_bin"],
            "permission_mode": config["permission_mode"],
        }

    def reset(self, thread_key):
        removed = self.store.clear(thread_key)
        return {"reset": removed is not None}
