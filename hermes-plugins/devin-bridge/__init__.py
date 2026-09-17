"""devin-bridge — talk to a local Devin CLI agent from any Hermes surface."""

import json
import threading

from . import bridge, schemas

_current = {"key": "default", "platform": "cli"}
_current_lock = threading.Lock()


def _remember_thread(session_id=None, platform=None, **kwargs):
    """pre_llm_call observer: record the thread the agent is currently answering in.

    Tool handlers do not receive the Hermes session id, so the most recent turn's
    session is what binds a Devin conversation to this chat thread.
    """
    if session_id:
        with _current_lock:
            _current["key"] = f"{platform or 'cli'}:{session_id}"
            _current["platform"] = platform or "cli"
    return None


def _thread_key(kwargs):
    session_id = kwargs.get("session_id")
    if session_id:
        return f"{kwargs.get('platform') or 'cli'}:{session_id}"
    with _current_lock:
        return _current["key"]


def register(ctx):
    engine = bridge.DevinBridge(config_getter=ctx.get_config)

    def devin_ask(args, **kwargs):
        result = engine.ask(
            _thread_key(kwargs),
            args.get("prompt", ""),
            new_session=bool(args.get("new_session")),
            workspace=args.get("workspace"),
        )
        return json.dumps(result)

    def devin_status(args, **kwargs):
        return json.dumps(engine.status(_thread_key(kwargs)))

    def devin_reset(args, **kwargs):
        return json.dumps(engine.reset(_thread_key(kwargs)))

    ctx.register_tool(
        name="devin_ask", toolset="devin_bridge", schema=schemas.DEVIN_ASK, handler=devin_ask
    )
    ctx.register_tool(
        name="devin_status", toolset="devin_bridge", schema=schemas.DEVIN_STATUS, handler=devin_status
    )
    ctx.register_tool(
        name="devin_reset", toolset="devin_bridge", schema=schemas.DEVIN_RESET, handler=devin_reset
    )
    ctx.register_hook("pre_llm_call", _remember_thread)

    def _slash(raw_args):
        text = (raw_args or "").strip()
        key = _thread_key({})
        if text in ("", "help"):
            return "Usage: /devin <message> | /devin new <message> | /devin status | /devin reset"
        if text == "status":
            status = engine.status(key)
            target = status["session_id"] or ("most recent session" if status["bound"] else "none")
            return f"Devin session: {target}\nWorkspace: {status['workspace']}"
        if text == "reset":
            engine.reset(key)
            return "Unbound — the next /devin message starts a fresh Devin session."
        new_session = False
        if text.startswith("new"):
            new_session, text = True, text[3:].strip()
            if not text:
                engine.reset(key)
                return "Next /devin message starts a fresh Devin session."
        result = engine.ask(key, text, new_session=new_session)
        return result.get("reply") or f"Devin error: {result.get('error')}"

    ctx.register_command(
        "devin",
        handler=_slash,
        description="Relay a message to the local Devin CLI agent",
        args_hint="<message> | new <message> | status | reset",
    )
