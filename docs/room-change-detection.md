# Room change detection (`agent_context.detect`)

Answers "what changed in this room?" from a before/after pair, locally, and returns
JSON an agent can act on.

```
camera frame ──► SSIM-map pre-filter ──► [yes/no gate] ──► Qwen2.5-VL 3B ──► JSON
                 ~2 ms, no model          opt-in, 500M     fills the contract
                 skip if <2% changed      cost lever only
```

## Install

```bash
uv venv .venv-vlm --python 3.11
uv pip install --python .venv-vlm/bin/python -r requirements-vlm.txt   # Linux/CPU
uv pip install --python .venv-vlm/bin/python -r requirements-mlx.txt   # + MacBook Air
```

Linux runtime: Ollama plus one vision model (`qwen2.5vl:3b`).
Mac runtime: `mlx-vlm`, which pulls the 4-bit mlx-community weights on first use.

```bash
export VLM_BACKEND=ollama      # or mlx; auto-detects when unset
```

## Use

```bash
python -m agent_context.detect before.jpg after.jpg --pretty
python -m agent_context.detect before.jpg after.jpg --detail --mask-out mask.png
python -m agent_context.detect before.jpg after.jpg --no-meta   # agent-facing only
python -m agent_context.detect --camera 0 --interval 5         # live loop, JSONL
python -m agent_context.detect --camera clip.mp4 --once        # offline replay
```

```python
from agent_context import detect_change

out = detect_change("before.jpg", "after.jpg")   # VLM_BACKEND picks the runtime
if out["changed"]:
    print(out["summary"], out["objects_added"], out["location"])
```

Output contract — always exactly these keys:

```json
{"changed": true,
 "summary": "An orange object has been added to the right side of the frame.",
 "objects_added": ["orange"],
 "objects_removed": [],
 "objects_moved": [],
 "location": "right"}
```

`_meta` (dropped with `--no-meta`) carries the pre-filter score, per-call latency,
which stages ran, and `parse_failed` / `needs_review` flags.

## How the 2% gate works

`score` is the fraction of the frame whose **local** SSIM fell below 0.5 — literally
"percent of the room that changed". A global mean SSIM smears a small object across
the whole frame (a 79×89 box is only 2.3% of 640×480 and moves global SSIM by 1.7%),
so the decision is made per-pixel-window, not on the frame average.

Measured on the synthetic fixtures (`--self-test`):

| pair | score | verdict | wall clock |
|---|---|---|---|
| identical + sensor noise | 0.0% | skip | 183 ms |
| exposure ×0.72 +8 | 0.0% | skip | ~180 ms |
| blown highlights ×1.35 +22 | 0.4% | skip | 196 ms |
| object added (2.3% of frame) | 2.3% | describe | 5.3 s |
| chair moved | 3.9% | describe | 4.9 s |

The pre-filter is tuned for **recall**: a false positive costs one VLM call, a false
negative loses the event. Precision comes from the VLM, which is told to ignore
lighting.

## Model assignment (measured, CPU-only 16-core x86, Ollama 0.40.10)

This is the part that did not survive contact with reality, so it is written down:

| model | what it actually does | verdict |
|---|---|---|
| SmolVLM 500M | given two images, replies with a generic single-image caption ("The image shows a table with two columns"). With `format=json` it invents a schema (`{"title": ...}`) instead of answering. | unusable as a gate or describer |
| Moondream 1.8B | captions plausibly but loosely ("urn of water with a red and black boat"), and with `format=json` emits a colour-histogram object | unusable for the contract |
| Qwen2.5-VL 3B | correct, grounded JSON on every fixture | **default describer** |

Consequences baked into the code:

- `describe` defaults to `qwen2.5vl:3b`; `moondream:1.8b` and `smolvlm:500m` remain
  one env var away (`VLM_MODEL_DESCRIBE`, `VLM_MODEL_TRIAGE`).
- The 500M yes/no gate is **off on CPU** (`VLM_GATE=auto` → on only for MLX). It
  costs ~1.6 s and, measured here, returns a caption instead of yes/no — so the
  pipeline fails open to the describer, which is exactly what a 14.5 s vs 5.3 s
  run shows. On MLX, where the 500M is ~10× cheaper than the 3B, the gate earns
  its place; that path is untested here.
- `format: "json"` is only sent for models expected to fill the schema. Forcing it
  on a model that cannot follow instructions produces syntactically valid garbage,
  which is worse than prose because it parses.

## Latency on this box

| stage | warm | cold (model load) |
|---|---|---|
| pre-filter | ~2 ms | ~180 ms including decode |
| Qwen2.5-VL 3B @ 640 px | 4.9–5.3 s | 56–74 s |

`max_side=640` was chosen by measurement: 768 px gives the same JSON at ~35% more
latency, 512 px starts dropping `objects_moved`. `keep_alive` defaults to 30 min so
a 24/7 watcher does not pay the load cost on every event.

## Test loop

```bash
./scripts/room-change-dev.sh          # 27 unittests + offline self-test (no models)
./scripts/room-change-dev.sh live     # + one real inference on the configured backend
./scripts/room-change-dev.sh watch    # rerun on save
./scripts/room-change-dev.sh pair a.jpg b.jpg --detail
```

`--self-test` synthesises fixtures (identical / lighting / added / moved), checks the
pre-filter, the JSON repair path, the cascade with a mock client, and backend health.
It needs no models and no network.

## Known limits

- **Blown highlights** destroy texture; ~0.4% residual survives normalisation. Under
  the 2% budget, but a harsh flash plus a real change is worth a lower `--threshold`.
- **The fixtures are geometric**, not photographs. They prove the plumbing and the
  pre-filter; they do not prove accuracy on a real room. Next step is a real
  before/after pair from the MacBook camera.
- **mlx-vlm's `generate()` signature drifts between releases**; `MLXClient` tries the
  documented forms newest-first and raises a clear `BackendError` if all fail.
- **`objects_moved` is the weakest field**: Qwen returns `[]` at 512 px and only
  fills it at 640 px or above, and "moved" is inferred from two stills, so a
  removed-and-replaced object can read as a move.
