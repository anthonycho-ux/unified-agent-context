#!/usr/bin/env python3
"""Room change detection: OpenCV pre-filter -> small VLM -> structured JSON.

One code path, two runtimes:

    VLM_BACKEND=mlx     macOS / Apple Silicon   (mlx-vlm, 4-bit, unified memory)
    VLM_BACKEND=ollama  Linux / CPU x86        (GGUF Q4_K_M via Ollama)

Cascade (cheapest first):

    1. SSIM/diff pre-filter    ~2 ms    -> skip the VLM entirely if <2% changed
    2. SmolVLM 500M (gate)     opt-in   -> one-word yes/no before paying for a 3B call
    3. Qwen2.5-VL 3B           ~5 s     -> fills the 6-key contract (see note)

Note on model choice (measured, CPU-only x86, see docs/room-change-detection.md):
SmolVLM 500M and Moondream 2B do not follow a 6-key JSON schema through Ollama —
they emit plausible-looking but invented keys. They stay available as
VLM_MODEL_TRIAGE / VLM_MODEL_DESCRIBE overrides, but the describer defaults to
Qwen2.5-VL 3B, which is the smallest model here that actually grounds its answer.

Output contract (what an agent consumes):

    {"changed": bool,
     "summary": str,
     "objects_added": [str],
     "objects_removed": [str],
     "objects_moved": [str],
     "location": str}

Diagnostics live under "_meta" and can be dropped with --no-meta.

CLI:
    python -m agent_context.detect before.jpg after.jpg
    python -m agent_context.detect before.jpg after.jpg --detail --backend ollama
    python -m agent_context.detect --self-test          # offline, no models needed
    python -m agent_context.detect --self-test --live    # also exercise the real backend
"""

from __future__ import annotations

import argparse
import ast
import base64
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

DEFAULT_THRESHOLD = 0.02          # >2% of the frame structurally changed -> candidate
DEFAULT_MAX_SIDE = 640           # measured: same JSON as 768 at ~35% less latency
DEFAULT_TIMEOUT = 180.0
SSIM_WIN = 11
SSIM_C1 = 0.01 ** 2
SSIM_C2 = 0.03 ** 2
# A local SSIM below this counts as "this patch of the frame changed".
# 0.5 sits between sensor noise (~0.9) and a real object swap (~0.1).
CHANGE_SSIM_CUTOFF = 0.5

# role -> model id per runtime. Override any of these with VLM_MODEL_<ROLE>.
MODELS: dict[str, dict[str, str]] = {
    # Measured on a CPU-only x86 box (see docs/room-change-detection.md):
    # SmolVLM 500M and Moondream 2B cannot fill the 6-key contract; Qwen2.5-VL 3B
    # can. They stay available as opt-in roles via VLM_MODEL_TRIAGE / VLM_MODEL_DESCRIBE.
    "ollama": {
        "triage": "smolvlm:500m",
        "describe": "qwen2.5vl:3b",
        "detail": "qwen2.5vl:3b",
    },
    "mlx": {
        "triage": "mlx-community/SmolVLM-500M-Instruct-4bit",
        "describe": "mlx-community/Qwen2.5-VL-3B-Instruct-4bit",
        "detail": "mlx-community/Qwen2.5-VL-3B-Instruct-4bit",
    },
}

# The gate is a cost lever, not a quality lever: it only pays off when the triage
# model is much cheaper than the describer (MLX, ~0.5 s vs ~5 s). On CPU it costs
# more than it saves, so it is off unless asked for.
GATE_PROMPT = (
    "Image 1 is BEFORE, Image 2 is AFTER. Did a physical object appear, disappear or "
    "move? Ignore lighting, shadows and people. Answer with one word: yes or no."
)

SYSTEM_PROMPT = (
    "You are a room change detector. You compare two photographs of the same room "
    "taken at different times and report what physically changed. Ignore lighting, "
    "shadows, white balance, exposure, camera noise, and the pose of any person. "
    "Only report durable physical changes to objects or their arrangement. "
    "Return only a JSON object, no prose, no markdown."
)

USER_PROMPT = """Image 1 is BEFORE. Image 2 is AFTER. Compare them.

Answer with one JSON object in this shape, filled in with what you actually see:
{{"changed": true, "summary": "", "objects_added": [], "objects_removed": [], "objects_moved": [], "location": ""}}

Rules:
- "changed" is true only if a physical object appeared, disappeared or moved.
- "summary" is one sentence, max 25 words, in your own words.
- "objects_added" / "objects_removed" / "objects_moved" list object names, [] if none.
- "location" is where in the frame, like "desk, upper-left".
- Ignore lighting, shadows, exposure and people's poses.

Pre-filter hint (may be wrong, verify visually): {hint}
If nothing changed physically, set "changed": false and leave every list empty."""

RETRY_PROMPT = (
    "Your previous reply was not valid JSON. Reply again with ONLY the JSON object, "
    "no markdown fences, no commentary. Keys: changed, summary, objects_added, "
    "objects_removed, objects_moved, location."
)


class BackendError(RuntimeError):
    """Raised when the chosen VLM runtime is missing or misbehaving."""


# --------------------------------------------------------------------------- #
# Image I/O + diff pre-filter
# --------------------------------------------------------------------------- #


def _imread(path: str | Path) -> np.ndarray:
    """Read an image via imdecode so non-ASCII paths work on every platform."""
    p = Path(path).expanduser()
    if not p.exists():
        raise FileNotFoundError(f"image not found: {p}")
    buf = np.fromfile(str(p), dtype=np.uint8)
    if buf.size == 0:
        raise ValueError(f"empty image file: {p}")
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"not a decodable image: {p}")
    return img


def _fit(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    scale = max_side / float(max(h, w))
    if scale >= 1.0:
        return img
    return cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))),
                      interpolation=cv2.INTER_AREA)


def _gray_norm(img: np.ndarray, normalize: bool) -> np.ndarray:
    """Blurred grayscale in [0,1]. normalize=True removes global gain+offset.

    SSIM is already partly invariant to luminance/contrast shifts (C1/C2), but
    normalising first keeps a lamp switching on from dominating the change mask.
    """
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.GaussianBlur(g, (3, 3), 0).astype(np.float32) / 255.0
    if not normalize:
        return g
    mu = float(g.mean())
    sd = float(g.std())
    if sd < 1e-6:
        return g - mu + 0.5
    # Map to [0,1] with the bulk centred at 0.5; a uniform lighting change
    # (offset and/or gain) collapses to the same image.
    return np.clip(0.5 + (g - mu) / (4.0 * sd), 0.0, 1.0)


def _ssim_map(a: np.ndarray, b: np.ndarray, win: int = SSIM_WIN) -> np.ndarray:
    """Per-pixel SSIM on [0,1] float arrays (Gaussian window, Wang constants)."""
    a64, b64 = a.astype(np.float64), b.astype(np.float64)
    sigma = 1.5
    mu_a = cv2.GaussianBlur(a64, (win, win), sigma)
    mu_b = cv2.GaussianBlur(b64, (win, win), sigma)
    mu_aa, mu_bb, mu_ab = mu_a * mu_a, mu_b * mu_b, mu_a * mu_b
    var_a = cv2.GaussianBlur(a64 * a64, (win, win), sigma) - mu_aa
    var_b = cv2.GaussianBlur(b64 * b64, (win, win), sigma) - mu_bb
    cov_ab = cv2.GaussianBlur(a64 * b64, (win, win), sigma) - mu_ab
    num = (2 * mu_ab + SSIM_C1) * (2 * cov_ab + SSIM_C2)
    den = (mu_aa + mu_bb + SSIM_C1) * (var_a + var_b + SSIM_C2)
    return num / den


def _ssim(a: np.ndarray, b: np.ndarray, win: int = SSIM_WIN) -> float:
    """Global mean SSIM. Reported for diagnostics; not the decision metric."""
    return float(np.mean(_ssim_map(a, b, win)))


_GRID = ("upper-left", "top", "upper-right",
         "left", "center", "right",
         "lower-left", "bottom", "lower-right")


def _region_name(x: int, y: int, w: int, h: int) -> str:
    col = 0 if x < w / 3 else (1 if x < 2 * w / 3 else 2)
    row = 0 if y < h / 3 else (1 if y < 2 * h / 3 else 2)
    return _GRID[row * 3 + col]


@dataclass
class DiffResult:
    changed: bool
    ssim: float                        # global mean SSIM (diagnostic)
    score: float                       # fraction of frame that structurally changed
    threshold: float
    bbox: tuple[int, int, int, int] | None = None   # x, y, w, h in working size
    region: str = ""
    method: str = "ssim-map"
    width: int = 0
    height: int = 0
    normalized: bool = True
    notes: list[str] = field(default_factory=list)

    @property
    def hint(self) -> str:
        if not self.changed:
            return f"no significant change ({self.score * 100:.1f}% of frame <= {self.threshold * 100:.0f}%)"
        bits = [f"{self.score * 100:.1f}% of the frame changed "
                f"(threshold {self.threshold * 100:.0f}%)"]
        if self.region:
            bits.append(f"change concentrated in {self.region}")
        return "; ".join(bits)

    def as_dict(self) -> dict[str, Any]:
        d = {
            "changed": self.changed,
            "score": round(self.score, 5),
            "ssim": round(self.ssim, 5),
            "threshold": self.threshold,
            "bbox": list(self.bbox) if self.bbox else None,
            "region": self.region,
            "size": [self.width, self.height],
            "normalized": self.normalized,
            "method": self.method,
        }
        if self.notes:
            d["notes"] = self.notes
        return d


def compare_frames(
    before: str | Path,
    after: str | Path,
    *,
    threshold: float = DEFAULT_THRESHOLD,
    max_side: int = DEFAULT_MAX_SIDE,
    normalize: bool = True,
    mask_out: str | Path | None = None,
) -> DiffResult:
    """SSIM-map pre-filter. Never loads a model, never touches the net.

    score = fraction of the frame whose *local* SSIM fell below CHANGE_SSIM_CUTOFF.
    That is a literal "% of the room that changed", so the 2% default threshold
    means what it says. A global mean SSIM would smear a small object over the
    whole frame and miss it (a 70x80 box is only 1.8% of a 640x480 frame).
    """
    img_a = _fit(_imread(before), max_side)
    img_b = _fit(_imread(after), max_side)
    notes: list[str] = []

    if img_a.shape[:2] != img_b.shape[:2]:
        h, w = img_a.shape[:2]
        notes.append(f"resized AFTER {img_b.shape[1]}x{img_b.shape[0]} -> {w}x{h}")
        img_b = cv2.resize(img_b, (w, h), interpolation=cv2.INTER_AREA)
    h, w = img_a.shape[:2]

    ga = _gray_norm(img_a, normalize)
    gb = _gray_norm(img_b, normalize)

    smap = _ssim_map(ga, gb)
    ssim = float(smap.mean())

    # Decision metric on the raw map: no morphology, so a real object cannot be
    # eroded away. Sensor noise sits at ssim ~0.9, far above the 0.5 cutoff.
    raw_mask = (smap < CHANGE_SSIM_CUTOFF).astype(np.uint8) * 255
    score = float(np.count_nonzero(raw_mask)) / float(h * w)

    # Cleaned mask, only for the bounding box / region hint.
    k = max(3, int(round(min(h, w) * 0.01)))
    k += 1 - (k % 2)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(raw_mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    bbox = None
    region = ""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = 0.0005 * h * w
    boxes = [cv2.boundingRect(c) for c in contours
             if cv2.contourArea(c) >= min_area]
    if boxes:
        x0 = min(b[0] for b in boxes)
        y0 = min(b[1] for b in boxes)
        x1 = max(b[0] + b[2] for b in boxes)
        y1 = max(b[1] + b[3] for b in boxes)
        bbox = (x0, y0, x1 - x0, y1 - y0)
        region = _region_name(x0 + (x1 - x0) // 2, y0 + (y1 - y0) // 2, w, h)

    if mask_out:
        out = Path(mask_out).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out), mask)

    return DiffResult(
        changed=bool(score > threshold),
        ssim=ssim,
        score=score,
        threshold=threshold,
        bbox=bbox,
        region=region,
        width=w,
        height=h,
        normalized=normalize,
        notes=notes,
    )


# --------------------------------------------------------------------------- #
# VLM clients — one interface, two runtimes
# --------------------------------------------------------------------------- #


@dataclass
class VLMResult:
    text: str
    model: str
    backend: str
    role: str
    latency_ms: int
    raw: dict[str, Any] = field(default_factory=dict)


class VLMClient:
    """Minimal contract: N images + prompt -> text. Implementations differ only here."""

    backend = "base"

    def __init__(self, model: str, *, timeout: float = DEFAULT_TIMEOUT, **opts: Any) -> None:
        self.model = model
        self.timeout = timeout
        self.opts = opts

    def describe(
        self,
        images: Sequence[str | Path],
        prompt: str,
        *,
        system: str = SYSTEM_PROMPT,
        max_tokens: int = 320,
        role: str = "describe",
        fmt: bool = True,
    ) -> VLMResult:
        raise NotImplementedError

    def health(self) -> tuple[bool, str]:
        return True, "ok"

    # -- shared helpers ---------------------------------------------------- #

    @staticmethod
    def _b64(path: str | Path) -> str:
        return base64.b64encode(Path(path).expanduser().read_bytes()).decode("ascii")


class OllamaClient(VLMClient):
    """Linux/CPU path: POST /api/chat with base64 images, format=json."""

    backend = "ollama"

    def __init__(self, model: str, *, host: str | None = None, **opts: Any) -> None:
        super().__init__(model, **opts)
        self.host = (host or os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
        if not self.host.startswith("http"):
            self.host = "http://" + self.host

    def describe(self, images, prompt, *, system=SYSTEM_PROMPT, max_tokens=320,
                 role="describe", fmt=True):
        import requests

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt,
                 "images": [self._b64(p) for p in images]},
            ],
            "stream": False,
            "keep_alive": os.environ.get("VLM_KEEP_ALIVE", "30m"),
            "options": {
                "temperature": 0.0,
                "top_p": 0.1,
                "num_predict": max_tokens,
                "num_ctx": int(os.environ.get("VLM_NUM_CTX", "8192")),
            },
        }
        if fmt:
            payload["format"] = "json"
        t0 = time.perf_counter()
        try:
            r = requests.post(f"{self.host}/api/chat", json=payload, timeout=self.timeout)
            if r.status_code == 400 and "format" in r.text.lower():
                # Some vision models reject structured-output mode; the parser
                # repairs the JSON anyway, so retry without it.
                payload.pop("format", None)
                r = requests.post(f"{self.host}/api/chat", json=payload, timeout=self.timeout)
        except Exception as exc:  # requests raises many types
            raise BackendError(
                f"ollama unreachable at {self.host} ({exc}). "
                "Start it with `ollama serve`, or set VLM_BACKEND=mlx on macOS."
            ) from exc
        if r.status_code == 404:
            raise BackendError(
                f"model '{self.model}' not found in ollama. "
                f"Pull it: ollama pull {self.model}"
            )
        if r.status_code >= 400:
            raise BackendError(f"ollama {r.status_code}: {r.text[:400]}")

        data = r.json()
        text = (data.get("message") or {}).get("content", "")
        return VLMResult(
            text=text,
            model=self.model,
            backend=self.backend,
            role=role,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            raw={k: data.get(k) for k in
                 ("model", "done", "done_reason", "total_duration", "eval_count")},
        )

    def health(self) -> tuple[bool, str]:
        import requests
        try:
            r = requests.get(f"{self.host}/api/tags", timeout=5)
            r.raise_for_status()
        except Exception as exc:
            return False, f"ollama unreachable at {self.host}: {exc}"
        names = [m.get("name", "") for m in r.json().get("models", [])]
        if names and not any(n.split(":")[0] == self.model.split(":")[0] for n in names):
            return False, f"model '{self.model}' not pulled. Available: {', '.join(names[:8])}"
        return True, f"ollama ok ({len(names)} models)"


_MLX_CACHE: dict[str, Any] = {}


class MLXClient(VLMClient):
    """macOS/Apple Silicon path: mlx-vlm. Weights stay resident across calls."""

    backend = "mlx"

    def _load(self):
        if self.model in _MLX_CACHE:
            return _MLX_CACHE[self.model]
        try:
            import mlx_vlm
            from mlx_vlm import load
        except ImportError as exc:
            raise BackendError(
                "mlx-vlm not installed. On Apple Silicon: `uv pip install mlx-vlm`. "
                "On Linux use VLM_BACKEND=ollama."
            ) from exc
        model, processor = load(self.model)
        _MLX_CACHE[self.model] = (mlx_vlm, model, processor)
        return _MLX_CACHE[self.model]

    def describe(self, images, prompt, *, system=SYSTEM_PROMPT, max_tokens=320,
                 role="describe", fmt=True):
        mlx_vlm, model, processor = self._load()
        img_paths = [str(Path(p).expanduser()) for p in images]
        full_prompt = f"{system}\n\n{prompt}"

        t0 = time.perf_counter()
        # mlx-vlm's generate() signature has drifted across releases; try the
        # documented forms newest-first and surface the last error clearly.
        attempts = (
            dict(prompt=full_prompt, image=img_paths, max_tokens=max_tokens,
                 temperature=0.0, verbose=False),
            dict(prompt=full_prompt, image=img_paths, max_tokens=max_tokens,
                 temp=0.0, verbose=False),
            dict(prompt=full_prompt, image=img_paths[0], max_tokens=max_tokens,
                 temperature=0.0, verbose=False),
        )
        last: Exception | None = None
        for kwargs in attempts:
            try:
                out = mlx_vlm.generate(model, processor, **kwargs)
                text = out if isinstance(out, str) else getattr(out, "text", str(out))
                return VLMResult(
                    text=text,
                    model=self.model,
                    backend=self.backend,
                    role=role,
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    raw={"attempt": list(kwargs.keys())},
                )
            except TypeError as exc:      # signature mismatch -> next form
                last = exc
            except Exception as exc:      # real failure -> stop
                raise BackendError(f"mlx-vlm generate failed: {exc}") from exc
        raise BackendError(
            f"mlx-vlm generate() rejected every known signature: {last}"
        )

    def health(self) -> tuple[bool, str]:
        try:
            import mlx_vlm  # noqa: F401
        except ImportError:
            return False, "mlx-vlm not installed (Apple Silicon only)"
        return True, f"mlx-vlm ok (model loads lazily: {self.model})"


class MockClient(VLMClient):
    """Deterministic stand-in so the whole pipeline is testable offline."""

    backend = "mock"

    def __init__(self, model: str = "mock", *, changed: bool = True,
                 summary: str | None = None, broken_json: bool = False,
                 no_change: bool = False, **opts: Any) -> None:
        super().__init__(model, **opts)
        self._changed = changed
        self._summary = summary or ("A chair moved and a mug appeared on the desk."
                                    if changed else "Nothing physical changed.")
        self._broken = broken_json
        self._no_change = no_change

    def describe(self, images, prompt, *, system=SYSTEM_PROMPT, max_tokens=320,
                 role="describe", fmt=True):
        if not fmt:
            # The yes/no gate path.
            text = "no" if self._no_change else "yes"
        elif self._broken:
            text = "Sure! It looks like something moved."
        else:
            payload = {
                "changed": self._changed,
                "summary": self._summary,
                "objects_added": ["mug"] if self._changed else [],
                "objects_removed": [],
                "objects_moved": ["chair"] if self._changed else [],
                "location": "desk, center-left" if self._changed else "",
            }
            text = json.dumps(payload)
        return VLMResult(text=text, model=self.model, backend=self.backend,
                         role=role, latency_ms=1, raw={"mock": True})


def resolve_backend(backend: str | None = None) -> str:
    if backend:
        return backend
    env = os.environ.get("VLM_BACKEND", "").strip().lower()
    if env:
        return env
    # Auto: Apple Silicon with mlx-vlm installed -> mlx, else ollama.
    if sys.platform == "darwin":
        try:
            import mlx_vlm  # noqa: F401
            return "mlx"
        except ImportError:
            pass
    return "ollama"


def _gate_default() -> bool:
    """VLM_GATE=auto|on|off. Auto: on for MLX (500M is ~10x cheaper than the 3B),
    off for CPU where the gate costs more than the call it might save."""
    v = os.environ.get("VLM_GATE", "auto").strip().lower()
    if v in ("1", "on", "true", "yes"):
        return True
    if v in ("0", "off", "false", "no"):
        return False
    return resolve_backend(None) == "mlx"


def get_client(
    backend: str | None = None,
    role: str = "describe",
    *,
    model: str | None = None,
    **kwargs: Any,
) -> VLMClient:
    """Factory: one env var selects the runtime, role selects the model."""
    b = resolve_backend(backend)
    if b == "mock":
        return MockClient(model or "mock", **kwargs)
    if b not in MODELS:
        raise BackendError(f"unknown VLM_BACKEND '{b}' (use mlx | ollama | mock)")
    chosen = model or os.environ.get(f"VLM_MODEL_{role.upper()}") or MODELS[b][role]
    cls = {"ollama": OllamaClient, "mlx": MLXClient}[b]
    return cls(chosen, **kwargs)


# --------------------------------------------------------------------------- #
# JSON parsing / normalisation
# --------------------------------------------------------------------------- #

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S | re.I)


def _balanced_object(text: str) -> str | None:
    """Extract the first balanced {...} block, respecting strings/escapes."""
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        start = text.find("{", start + 1)
    return None


def _coerce_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        v = [p for p in re.split(r"[,;\n]", v) if p.strip()]
    if not isinstance(v, (list, tuple, set)):
        v = [v]
    out: list[str] = []
    seen: set[str] = set()
    for item in v:
        s = str(item).strip().strip("-•* ").strip()
        if not s or s.lower() in {"none", "n/a", "nothing", "null", "[]"}:
            continue
        key = s.lower()
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _coerce_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in {"true", "yes", "y", "1", "changed"}
    return False


def parse_json_object(text: str) -> dict[str, Any] | None:
    """Tolerant parse: fences, prose around the object, trailing commas, py literals."""
    if not text:
        return None
    candidates: list[str] = []
    m = _FENCE.search(text)
    if m:
        candidates.append(m.group(1))
    candidates.append(text)
    balanced = _balanced_object(text)
    if balanced:
        candidates.append(balanced)

    for cand in candidates:
        cand = cand.strip()
        for attempt in (cand,
                        re.sub(r",\s*([}\]])", r"\1", cand)):
            try:
                obj = json.loads(attempt)
                if isinstance(obj, dict):
                    return obj
            except json.JSONDecodeError:
                pass
            try:
                obj = ast.literal_eval(attempt)
                if isinstance(obj, dict):
                    return obj
            except (ValueError, SyntaxError):
                pass
    return None


def normalize_result(obj: dict[str, Any]) -> dict[str, Any]:
    """Force the agent-facing schema; keep unknown keys out of the contract."""
    return {
        "changed": _coerce_bool(obj.get("changed")),
        "summary": " ".join(str(obj.get("summary") or "").split())[:400],
        "objects_added": _coerce_list(obj.get("objects_added")),
        "objects_removed": _coerce_list(obj.get("objects_removed")),
        "objects_moved": _coerce_list(obj.get("objects_moved")),
        "location": str(obj.get("location") or "").strip()[:200],
    }


def empty_result(summary: str) -> dict[str, Any]:
    return {"changed": False, "summary": summary, "objects_added": [],
            "objects_removed": [], "objects_moved": [], "location": ""}


_ECHO_MARKERS = (
    "one sentence", "25 words", "object that appeared", "object that disappeared",
    "object that changed position", "where in the frame", "desk, upper-left",
    "your answer", "this wording", "of the frame changed", "change concentrated",
)


def _looks_like_echo(obj: dict[str, Any]) -> bool:
    """Small models sometimes regurgitate the prompt's field descriptions."""
    blob = json.dumps(obj, ensure_ascii=False).lower()
    return any(m in blob for m in _ECHO_MARKERS)


def _usable(obj: dict[str, Any]) -> bool:
    """Reject prompt echoes and empty-but-claimed-change answers."""
    if _looks_like_echo(obj):
        return False
    if _coerce_bool(obj.get("changed")) and not str(obj.get("summary") or "").strip():
        return False
    return True


def _ask(client: VLMClient, images, prompt, *, role: str, system: str,
         max_tokens: int) -> tuple[dict[str, Any] | None, VLMResult, bool]:
    """One VLM call + parse, with a single strict retry.

    Returns (normalised_obj_or_None, result, parsed). None means the model would
    not produce usable JSON twice; the caller must decide, never invent structure.
    """
    res = client.describe(images, prompt, system=system, max_tokens=max_tokens, role=role)
    obj = parse_json_object(res.text)
    if obj is not None and _usable(obj):
        return normalize_result(obj), res, True

    res2 = client.describe(images, f"{prompt}\n\n{RETRY_PROMPT}", system=system,
                           max_tokens=max_tokens, role=role)
    obj2 = parse_json_object(res2.text)
    if obj2 is not None and _usable(obj2):
        return normalize_result(obj2), res2, True
    return None, res2, False


# --------------------------------------------------------------------------- #
# Cascade
# --------------------------------------------------------------------------- #


CONTRACT_KEYS = ("changed", "summary", "objects_added", "objects_removed",
                 "objects_moved", "location")


def _contract(result: dict[str, Any], meta: dict[str, Any],
              include_meta: bool) -> dict[str, Any]:
    """Emit exactly the documented keys — nothing internal leaks to the agent."""
    out: dict[str, Any] = {
        "changed": bool(result.get("changed")),
        "summary": " ".join(str(result.get("summary") or "").split())[:400],
        "objects_added": _coerce_list(result.get("objects_added")),
        "objects_removed": _coerce_list(result.get("objects_removed")),
        "objects_moved": _coerce_list(result.get("objects_moved")),
        "location": str(result.get("location") or "").strip()[:200],
    }
    if include_meta:
        out["_meta"] = meta
    return out


def _yes_no(text: str) -> bool | None:
    """Read a one-word yes/no answer. None means the model did not answer."""
    t = (text or "").strip().lower()
    if not t:
        return None
    head = re.split(r"[^a-z]+", t)[0]
    if head in ("yes", "y", "true"):
        return True
    if head in ("no", "n", "false"):
        return False
    # "There is no change", "nothing changed"
    if re.search(r"\b(no|nothing)\b.{0,12}\b(change|different|moved|appeared)\b", t):
        return False
    return None


def _gate(client: VLMClient, images) -> tuple[bool | None, VLMResult]:
    res = client.describe(images, GATE_PROMPT, system=SYSTEM_PROMPT,
                          max_tokens=6, role="triage", fmt=False)
    return _yes_no(res.text), res


def detect_change(
    before: str | Path,
    after: str | Path,
    *,
    backend: str | None = None,
    threshold: float = DEFAULT_THRESHOLD,
    detail: bool = False,
    gate: bool | None = None,
    normalize: bool = True,
    max_side: int = DEFAULT_MAX_SIDE,
    include_meta: bool = True,
    mask_out: str | Path | None = None,
    client_factory=get_client,
) -> dict[str, Any]:
    """Full pipeline. Returns the agent contract, plus _meta unless disabled."""
    t_start = time.perf_counter()
    diff = compare_frames(before, after, threshold=threshold,
                          normalize=normalize, max_side=max_side, mask_out=mask_out)
    meta: dict[str, Any] = {"prefilter": diff.as_dict(), "calls": [], "cascade": []}

    if not diff.changed:
        meta["cascade"] = ["prefilter:skip"]
        meta["verdict_source"] = "prefilter"
        meta["elapsed_ms"] = int((time.perf_counter() - t_start) * 1000)
        return _contract(
            empty_result(f"No significant change ({diff.score * 100:.1f}% of frame, "
                         f"threshold {threshold * 100:.0f}%)."),
            meta, include_meta)

    images = [str(Path(before).expanduser()), str(Path(after).expanduser())]
    prompt = USER_PROMPT.format(hint=diff.hint)
    use_gate = _gate_default() if gate is None else gate
    result: dict[str, Any] | None = None
    verdict_source = "prefilter"

    try:
        # --- optional pass 0: cheap yes/no gate --------------------------- #
        if use_gate:
            g, g_res = _gate(client_factory(backend, role="triage"), images)
            meta["calls"].append({"role": "triage", "model": g_res.model,
                                  "backend": g_res.backend,
                                  "latency_ms": g_res.latency_ms,
                                  "answer": g})
            meta["cascade"].append("gate")
            if g is False:
                # The pre-filter only saw transient motion (a person, a curtain).
                meta["verdict_source"] = "gate"
                meta["elapsed_ms"] = int((time.perf_counter() - t_start) * 1000)
                return _contract(
                    empty_result(f"Pre-filter saw {diff.score * 100:.1f}% of the frame "
                                 f"change, but the triage model found no durable change."),
                    meta, include_meta)

        # --- pass 1: describe (the model that can fill the contract) ------ #
        role = "detail" if detail else "describe"
        desc, desc_res, desc_ok = _ask(
            client_factory(backend, role=role), images, prompt, role=role,
            system=SYSTEM_PROMPT, max_tokens=420 if detail else 320)
        meta["calls"].append({"role": role, "model": desc_res.model,
                              "backend": desc_res.backend,
                              "latency_ms": desc_res.latency_ms, "parsed": desc_ok})
        meta["cascade"].append(role)

        if desc is None:
            # The model failed twice. The pre-filter is the only evidence left,
            # so it wins — never silently downgrade to "nothing changed".
            meta["parse_failed"] = True
            result = empty_result(_prose(desc_res.text))
            result["changed"] = True
            verdict_source = "prefilter"
        else:
            result = desc
            verdict_source = role
            if not desc["changed"] and diff.score > 2 * threshold:
                meta["needs_review"] = True   # confident diff vs. VLM disagreement

    except BackendError as exc:
        meta["error"] = str(exc)
        meta["verdict_source"] = "prefilter-only"
        meta["elapsed_ms"] = int((time.perf_counter() - t_start) * 1000)
        degraded = empty_result(f"VLM unavailable: {exc}")
        degraded["changed"] = True        # the pre-filter saw something; say so
        return _contract(degraded, meta, include_meta)

    meta["verdict_source"] = verdict_source
    meta["elapsed_ms"] = int((time.perf_counter() - t_start) * 1000)
    assert result is not None
    return _contract(result, meta, include_meta)


def _prose(text: str) -> str:
    return " ".join((text or "").split())[:400]


def iter_camera_changes(
    source: str | int | Path,
    *,
    interval: float = 5.0,
    threshold: float = DEFAULT_THRESHOLD,
    backend: str | None = None,
    detail: bool = False,
    once: bool = False,
    max_frames: int | None = None,
    include_meta: bool = False,
):
    """Live loop: sample a camera (or a video file) and yield change events.

    Keeps only the previous frame on disk, so a 24/7 run does not fill the disk.
    Yields the same contract dict as detect_change(), one per detected change.
    """
    import tempfile

    if isinstance(source, int):
        src, is_stream = source, True
    elif isinstance(source, str) and source.isdigit():
        src, is_stream = int(source), True
    else:
        src, is_stream = str(source), False
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise BackendError(f"cannot open video source: {source}")

    tmp = Path(tempfile.mkdtemp(prefix="roomdiff-live-"))
    prev_path: Path | None = None
    idx = 0
    seen = 0
    try:
        while max_frames is None or seen < max_frames:
            ok, frame = cap.read()
            if not ok:
                break                       # end of file, or camera unplugged
            seen += 1
            idx += 1
            cur_path = tmp / f"f{idx:06d}.jpg"
            cv2.imwrite(str(cur_path), frame)

            if prev_path is not None:
                out = detect_change(prev_path, cur_path, backend=backend,
                                    threshold=threshold, detail=detail,
                                    include_meta=include_meta)
                if out["changed"]:
                    yield out
                    if once:
                        break
                prev_path.unlink(missing_ok=True)
            prev_path = cur_path

            if is_stream:
                time.sleep(interval)
    finally:
        cap.release()
        for p in tmp.glob("*.jpg"):
            p.unlink(missing_ok=True)
        try:
            tmp.rmdir()
        except OSError:
            pass


def _merge(primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
    """Later, stronger models win on prose; object lists are unioned."""
    out = dict(primary)
    if not out.get("summary"):
        out["summary"] = secondary.get("summary", "")
    if not out.get("location"):
        out["location"] = secondary.get("location", "")
    for key in ("objects_added", "objects_removed", "objects_moved"):
        merged = _coerce_list(out.get(key)) + _coerce_list(secondary.get(key))
        out[key] = _coerce_list(merged)
    if not out.get("changed") and secondary.get("changed"):
        out["changed"] = True
    return out


# --------------------------------------------------------------------------- #
# Self-test loop (offline) — exercises filter + clients + cascade without models
# --------------------------------------------------------------------------- #


def _fixtures(tmp: Path) -> dict[str, tuple[Path, Path]]:
    """Synthesise deterministic before/after pairs on a plain desk scene."""
    rng = np.random.default_rng(7)
    h, w = 480, 640
    before = np.full((h, w, 3), 235, np.uint8)
    cv2.rectangle(before, (0, int(h * 0.72)), (w, h), (170, 160, 150), -1)   # floor
    cv2.rectangle(before, (60, 260), (300, 300), (90, 70, 55), -1)          # desk
    cv2.rectangle(before, (90, 200), (170, 260), (60, 60, 170), -1)         # chair back
    cv2.rectangle(before, (330, 230), (420, 260), (40, 40, 40), -1)         # monitor base
    before = cv2.GaussianBlur(before, (3, 3), 0)

    paths: dict[str, tuple[Path, Path]] = {}
    tmp.mkdir(parents=True, exist_ok=True)

    def save(name: str, img: np.ndarray) -> Path:
        p = tmp / f"{name}.png"
        cv2.imwrite(str(p), img)
        return p

    b = save("before", before)

    identical = before.copy()
    identical = np.clip(identical.astype(np.int16) +
                        rng.normal(0, 1.2, identical.shape).astype(np.int16),
                        0, 255).astype(np.uint8)
    paths["identical"] = (b, save("identical", identical))

    # Non-clipping exposure change: this is the case normalisation must absorb.
    soft = np.clip(before.astype(np.float32) * 0.72 + 8, 0, 255).astype(np.uint8)
    paths["lighting_soft"] = (b, save("lighting_soft", soft))

    # Blown highlights: texture is genuinely destroyed, so a small residual is
    # expected. It must still land under the 2% budget.
    blown = np.clip(before.astype(np.float32) * 1.35 + 22, 0, 255).astype(np.uint8)
    paths["lighting_blown"] = (b, save("lighting_blown", blown))

    added = before.copy()
    cv2.rectangle(added, (470, 150), (540, 230), (30, 120, 200), -1)        # new box
    paths["added"] = (b, save("added", added))

    moved = before.copy()
    cv2.rectangle(moved, (90, 200), (170, 260), (235, 235, 235), -1)
    cv2.rectangle(moved, (420, 190), (500, 250), (60, 60, 170), -1)         # chair moved
    paths["moved"] = (b, save("moved", moved))

    return paths


def self_test(live: bool = False, backend: str | None = None) -> int:
    """Offline pass/fail loop. --live also hits the configured real backend."""
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="roomdiff-"))
    fx = _fixtures(tmp)
    failures = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failures
        if not cond:
            failures += 1
        print(f"{'PASS' if cond else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")

    print(f"fixtures: {tmp}\n--- pre-filter ---")
    r_ident = compare_frames(*fx["identical"])
    check("identical frames are unchanged", not r_ident.changed,
          f"score={r_ident.score:.4f} ssim={r_ident.ssim:.4f}")
    check("identical score below 0.5%", r_ident.score < 0.005, f"score={r_ident.score:.4f}")

    r_soft = compare_frames(*fx["lighting_soft"])
    check("soft lighting shift is absorbed", not r_soft.changed,
          f"score={r_soft.score:.4f}")

    r_blown = compare_frames(*fx["lighting_blown"])
    check("blown-highlight shift stays under budget", not r_blown.changed,
          f"score={r_blown.score:.4f}")

    r_add = compare_frames(*fx["added"])
    check("added object is detected", r_add.changed,
          f"score={r_add.score:.4f} region={r_add.region}")
    check("added object localises right side", "right" in r_add.region, r_add.region)

    r_move = compare_frames(*fx["moved"])
    check("moved object is detected", r_move.changed, f"score={r_move.score:.4f}")

    r_force = compare_frames(*fx["identical"], threshold=-0.001)
    check("threshold=0 forces a candidate", r_force.changed)

    print("--- json parsing ---")
    check("plain json parses",
          (parse_json_object('{"changed": true, "summary": "x"}') or {}).get("changed") is True)
    check("fenced json parses",
          parse_json_object('```json\n{"changed": false}\n```') is not None)
    check("prose-wrapped json parses",
          parse_json_object('Sure! {"changed": true, "summary": "mug"} hope that helps')
          is not None)
    check("trailing comma repaired",
          parse_json_object('{"changed": true, "objects_added": ["mug",],}') is not None)
    check("garbage returns None", parse_json_object("no json here") is None)

    print("--- cascade (mock backend) ---")
    out = detect_change(*fx["added"], backend="mock", include_meta=True)
    check("schema keys present",
          set(out) >= {"changed", "summary", "objects_added", "objects_removed",
                       "objects_moved", "location"})
    check("mock cascade runs the describer",
          out["_meta"]["cascade"] == ["describe"], str(out["_meta"]["cascade"]))
    check("mock reports changed", out["changed"] is True)
    check("mock objects_moved non-empty", bool(out["objects_moved"]))

    gated = detect_change(*fx["added"], backend="mock", gate=True)
    check("gate on adds a triage call",
          gated["_meta"]["cascade"] == ["gate", "describe"], str(gated["_meta"]["cascade"]))

    out_ident = detect_change(*fx["identical"], backend="mock")
    check("prefilter short-circuits identical frames",
          out_ident["_meta"]["cascade"] == ["prefilter:skip"])
    check("prefilter short-circuit has no objects", out_ident["objects_added"] == [])

    broken = detect_change(*fx["added"], backend="mock",
                           client_factory=lambda b, role="describe", **kw: MockClient(broken_json=True))
    check("unparseable VLM output does not crash", isinstance(broken["summary"], str))
    check("unparseable output keeps prefilter verdict", broken["changed"] is True)

    print("--- backend availability ---")
    try:
        c = get_client(backend, role="describe")
        ok, msg = c.health()
        print(f"{'PASS' if ok else 'SKIP'}  {c.backend}/{c.model}: {msg}")
    except BackendError as exc:
        print(f"SKIP  backend unavailable: {exc}")

    if live:
        print("--- live end-to-end ---")
        try:
            out = detect_change(*fx["added"], backend=backend)
            print(json.dumps(out, indent=2)[:1200])
            check("live backend returned schema",
                  set(out) >= {"changed", "summary", "objects_added", "location"})
        except BackendError as exc:
            print(f"SKIP  live: {exc}")

    print(f"\n{'OK' if failures == 0 else 'FAILED'} — {failures} failure(s)")
    return 1 if failures else 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m agent_context.detect",
        description="Detect what changed in a room between two frames.")
    ap.add_argument("before", nargs="?", help="BEFORE image")
    ap.add_argument("after", nargs="?", help="AFTER image")
    ap.add_argument("--backend", choices=["mlx", "ollama", "mock"],
                    help="override VLM_BACKEND")
    ap.add_argument("--model", help="override the model for the final role")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                    help="SSIM change threshold (default 0.02 = 2%%)")
    ap.add_argument("--detail", action="store_true",
                    help="use the detail role (bigger token budget) for the description")
    ap.add_argument("--gate", choices=["auto", "on", "off"], default="auto",
                    help="cheap yes/no triage gate before describing (default auto)")
    ap.add_argument("--no-normalize", action="store_true",
                    help="disable illumination normalisation")
    ap.add_argument("--no-meta", action="store_true", help="drop _meta diagnostics")
    ap.add_argument("--max-side", type=int, default=DEFAULT_MAX_SIDE)
    ap.add_argument("--mask-out", help="write the change mask PNG here")
    ap.add_argument("--pretty", action="store_true", help="indent the JSON")
    ap.add_argument("--camera", help="live loop: camera index (0) or video file")
    ap.add_argument("--interval", type=float, default=5.0,
                    help="seconds between camera samples (default 5)")
    ap.add_argument("--once", action="store_true",
                    help="with --camera: exit after the first change event")
    ap.add_argument("--max-frames", type=int, default=None,
                    help="with --camera: stop after N frames")
    ap.add_argument("--self-test", action="store_true", help="run the offline test loop")
    ap.add_argument("--live", action="store_true", help="with --self-test: hit the real backend")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test(live=args.live, backend=args.backend)

    if args.camera is not None:
        events = 0
        try:
            for ev in iter_camera_changes(
                    args.camera, interval=args.interval, threshold=args.threshold,
                    backend=args.backend, detail=args.detail, once=args.once,
                    max_frames=args.max_frames, include_meta=not args.no_meta):
                events += 1
                print(json.dumps(ev, ensure_ascii=False), flush=True)
        except BackendError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(f"# {events} change event(s)", file=sys.stderr)
        return 0

    if not (args.before and args.after):
        ap.error("BEFORE and AFTER images are required (or use --self-test / --camera)")

    try:
        out = detect_change(
            args.before, args.after,
            backend=args.backend,
            threshold=args.threshold,
            detail=args.detail,
            gate=args.gate if args.gate != "auto" else None,
            normalize=not args.no_normalize,
            max_side=args.max_side,
            include_meta=not args.no_meta,
            mask_out=args.mask_out,
        )
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
