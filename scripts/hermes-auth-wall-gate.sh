#!/usr/bin/env bash
# hermes-auth-wall-gate.sh — Hermes pre_llm_call hook.
#
# WHY THIS FILE EXISTS (2026-09-30): the first version of this gate was
# registered in ~/.config/devin/config.json. Hermes does not read that file —
# it reads ~/.hermes/config.yaml. So the gate never fired once. Same class of
# bug as the one documented in 06-self-learning (a Stop hook that exists in
# Devin and not in Hermes). Registered here instead.
#
# PURPOSE: when the user is about to send browser/credentialed web work to a
# delegated or remote agent, inject the pre-dispatch checklist as context.
# pre_llm_call cannot BLOCK (it injects), so this is a nudge, not a wall.
# For a hard wall use the script-side gate at
# ~/Projects/metabolical-ko/team-gate.sh, which refuses to exec.
#
# Fail-open: any error -> exit 0 (silence).
set -uo pipefail

PAYLOAD=$(cat -)

LAST_USER=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(0)
msgs = p.get("messages") or p.get("extra", {}).get("messages") or []
text = ""
for m in reversed(msgs):
    if m.get("role") == "user":
        c = m.get("content")
        if isinstance(c, str):
            text = c
        elif isinstance(c, list):
            text = " ".join(x.get("text","") for x in c if isinstance(x, dict))
        break
if not text:
    text = p.get("extra", {}).get("user_message") or p.get("prompt") or ""
print(text[:4000])' 2>/dev/null)

[ -z "$LAST_USER" ] && exit 0

lower=$(printf '%s' "$LAST_USER" | tr '[:upper:]' '[:lower:]')

# Trigger matcher is shared with the Devin-side gate — one source of truth.
# They had already drifted once (2026-10-01); do not re-inline the patterns.
. /home/acho/.agents/skills/browser-login-gate/auth-wall-matcher.sh

auth_wall_fires "$LAST_USER" || exit 0

python3 - <<'PYEOF'
import json
ctx = (
 "AUTH-WALL GATE (browser-login-gate) — check BEFORE dispatching this.\n"
 "This request sends credentialed web work to a delegated/remote agent.\n\n"
 "1. CLASSIFY the wall. Sign-in vs permissions are different fixes.\n"
 "   Slack missing_scope / invalid_auth = PERMISSIONS -> app manifest, not a\n"
 "   credential. 401/403 or a Sign in form = SIGN-IN -> credential path.\n"
 "2. PROBE THE REMOTE FIRST. A remote agent (Aside) has its own cookies.\n"
 "   The local browser vault does NOT apply to it. Check whether Aside\n"
 "   already holds a signed-in session before assuming it is blocked.\n"
 "3. LOCAL VAULT IS EMPTY HERE. ~/.hermes/vault/ has only .vault.lock — no\n"
 "   vault.json.enc. 1Password is locked. browser_vault_list returns nothing.\n"
 "   From this Telegram session: list/fill work, save/unlock/code do NOT.\n"
 "   Do not treat an empty vault as a blocker; go to step 2.\n"
 "4. NEVER type a password with fill_input, never accept one in chat, never\n"
 "   guess credentials.\n\n"
 "Full checklist: ~/.hermes/skills/browser-login-gate/SKILL.md"
)
print(json.dumps({"context": ctx}))
PYEOF

exit 0
