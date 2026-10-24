"""agent_context — local-only perception helpers for the UAC agent fleet.

Currently: room change detection (before/after frame -> structured JSON).
"""

__all__ = [
    "DiffResult",
    "VLMResult",
    "compare_frames",
    "detect_change",
    "get_client",
    "parse_json_object",
]

__version__ = "0.1.0"


def __getattr__(name: str):
    """Lazy re-export so `python -m agent_context.detect` does not double-import."""
    if name in __all__:
        from . import detect

        return getattr(detect, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
