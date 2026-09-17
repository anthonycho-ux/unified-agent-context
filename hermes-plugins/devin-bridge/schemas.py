"""Tool schemas — what the Hermes model sees."""

DEVIN_ASK = {
    "name": "devin_ask",
    "description": (
        "Send a message to the local Devin CLI agent and return its reply. "
        "Devin runs on this machine with access to the configured workspace, so use it for "
        "coding work the user explicitly wants Devin to do: reading and editing a repo, running "
        "commands, investigating a codebase. The conversation is persistent — follow-up calls "
        "continue the same Devin session unless new_session is true. Turns can take minutes."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "Message to send to Devin, verbatim from the user when possible.",
            },
            "new_session": {
                "type": "boolean",
                "description": "Start a fresh Devin session instead of continuing the bound one.",
            },
            "workspace": {
                "type": "string",
                "description": "Absolute path Devin should run in. Defaults to the configured workspace.",
            },
        },
        "required": ["prompt"],
    },
}

DEVIN_STATUS = {
    "name": "devin_status",
    "description": "Report which Devin CLI session this chat thread is bound to, and the workspace it runs in.",
    "parameters": {"type": "object", "properties": {}},
}

DEVIN_RESET = {
    "name": "devin_reset",
    "description": "Unbind this chat thread from its Devin CLI session so the next message starts a fresh one.",
    "parameters": {"type": "object", "properties": {}},
}
