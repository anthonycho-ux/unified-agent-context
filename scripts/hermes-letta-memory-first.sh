#!/usr/bin/env bash
# unified-agent-context: hermes pre_llm_call hook — internal-memory-first router.
# When the latest user message signals an external lookup (search, find, latest,
# docs, lookup...), grep the local Letta MemFS archive + hermes memories and
# inject the top internal hits (with excerpts + agent-relative MemFS paths) so
# Hermes consults internal memory BEFORE reaching for external references.
# Fail-open: any error -> exit 0.
set -uo pipefail

export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"

PAYLOAD=$(cat -)

# Extract the last user message text.
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
print(text[:4000])')

[ -z "$LAST_USER" ] && exit 0

# External-lookup intent gate. If the prompt does not look like it wants
# outside information, stay silent.
if ! printf '%s' "$LAST_USER" | grep -qiE 'search|look ?up|find out|latest|recent|news|docs|documentation|reference|what is|how do|error|recipe|tutorial|github|online|web'; then
  exit 0
fi

MEMFS="/home/acho/.letta/lc-local-backend/memfs"
MEMDIRS=(
  "$MEMFS/agent-local-366f17fa-2e2e-4c89-89b9-4bef26119fdf/memory"
  "$MEMFS/agent-local-0ac84875-02e2-45f9-8626-0b728517a1c0/memory"
  "$HOME/.hermes/memories"
  "$HOME/wiki"
)

# Pick up to 4 meaningful keywords (>=4 chars, not stopwords).
KW=$(printf '%s' "$LAST_USER" | python3 -c 'import sys,re
STOP=set("""search look find latest recent news docs documentation reference what
is how do error recipe tutorial github online web the a an of for to in on
me my you your please tell about with this that from have has been were was
are and or but not can could would should""".split())
words=re.findall(r"[A-Za-z0-9_.-]{4,}", sys.stdin.read().lower())
seen=[]
for w in words:
    w=w.strip(".-_")
    if w and w not in STOP and w not in seen:
        seen.append(w)
print(" ".join(seen[:4]))')

[ -z "$KW" ] && exit 0

# Collect hits as "file<TAB>keyword" pairs (each file tagged with the first
# keyword that matched it) so we can pull a matching excerpt later.
HITS=""
for kw in $KW; do
  for d in "${MEMDIRS[@]}"; do
    [ -d "$d" ] || continue
    out=$(grep -rIil --include='*.md' --include='*.txt' --include='*.csv' \
          -m1 "$kw" "$d" 2>/dev/null | head -3)
    while IFS= read -r f; do
      [ -n "$f" ] && HITS="$HITS$f	$kw
"
    done <<< "$out"
  done
done

HITS=$(printf '%s' "$HITS" | sort -u -t$'\t' -k1,1 | head -8)
[ -z "$HITS" ] && exit 0

MEMFS="$MEMFS" HITS="$HITS" python3 - "$KW" <<'PYEOF'
import json, os, sys, re

kw = sys.argv[1]
memfs = os.environ["MEMFS"]
hits = [l.split("\t") for l in os.environ["HITS"].splitlines() if "\t" in l]

lines = []
for path, hit_kw in hits[:6]:
    # Agent-relative MemFS path when the file lives in an agent's memory tree.
    rel = path
    owner = "local"
    m = re.match(re.escape(memfs) + r"/(agent-[^/]+)/memory/(.*)", path)
    if m:
        owner, rel = m.group(1), m.group(2)
    elif path.startswith(os.path.expanduser("~/wiki")):
        owner = "wiki"
    elif "/.hermes/" in path:
        owner = "hermes"

    excerpt = ""
    try:
        with open(path, errors="replace") as fh:
            for line in fh:
                if hit_kw in line.lower():
                    excerpt = line.strip()[:200]
                    break
    except OSError:
        pass

    entry = f"- [{owner}] {rel}"
    if owner.startswith("agent-"):
        entry += f"  (agent-local MemFS path for {owner})"
    if excerpt:
        entry += f"\n  > {excerpt}"
    lines.append(entry)

ctx = (
    "INTERNAL MEMORY FIRST (hook: letta-memory-first)\n"
    f"The user's request matched internal-memory keywords: {kw}.\n"
    "Internal memory already has relevant material — answer from it when "
    "sufficient; only go external/web for what is genuinely missing.\n"
    "Paths are shown relative to their owning store; a Letta agent must read "
    "files via its OWN MemFS-relative path (e.g. archive/...), never another "
    "agent's absolute path.\n" + "\n".join(lines)
)
print(json.dumps({"context": ctx}))
PYEOF
