#!/usr/bin/env python3
"""Render the UAC promo video (terminal aesthetic, three beats) to mp4 + gif.

Deliverables: uac-promo.mp4 (1280x720, 12fps) and uac-promo.gif (640w, README-embeddable).
Pure PIL/numpy/imageio — no external services. Deterministic output.
"""
import os
import numpy as np
import imageio.v2 as imageio
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FPS = 12
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

BG = (13, 15, 20)
TERM_BG = (22, 25, 33)
TERM_BORDER = (45, 50, 62)
BAR = (32, 36, 46)
FG = (210, 214, 222)
DIM = (120, 126, 140)
GREEN = (80, 250, 123)
CYAN = (102, 217, 239)
YELLOW = (241, 250, 140)
RED = (255, 85, 85)
ACCENT = (189, 147, 249)

def font(size, bold=False):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", size, index=1 if bold else 0)
    except Exception:
        return ImageFont.load_default()

F_MONO = font(22)
F_MONO_B = font(22, bold=True)
F_TITLE = font(15)
F_OVERLAY = font(34, bold=True)
F_END = font(40, bold=True)
F_END_S = font(24)

LINE_H = 32
PAD_X, PAD_Y = 36, 56
TERM_RECT = (40, 60, W - 40, H - 100)

def draw_terminal(lines, title, overlay=None, cursor=True):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = TERM_RECT
    d.rounded_rectangle(TERM_RECT, radius=12, fill=TERM_BG, outline=TERM_BORDER, width=2)
    d.rounded_rectangle((x0, y0, x1, y0 + 36), radius=12, fill=BAR)
    d.rectangle((x0, y0 + 18, x1, y0 + 36), fill=BAR)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse((x0 + 16 + i * 24, y0 + 11, x0 + 30 + i * 24, y0 + 25), fill=c)
    tw = d.textlength(title, font=F_TITLE)
    d.text(((x0 + x1) / 2 - tw / 2, y0 + 10), title, font=F_TITLE, fill=DIM)
    ty = y0 + PAD_Y
    for text, color, bold in lines[-16:]:
        d.text((x0 + PAD_X, ty), text, font=F_MONO_B if bold else F_MONO, fill=color)
        ty += LINE_H
    if cursor:
        d.rectangle((x0 + PAD_X, ty + 4, x0 + PAD_X + 13, ty + 26), fill=FG)
    if overlay:
        ow = d.textlength(overlay, font=F_OVERLAY)
        oy = H - 74
        d.rectangle((0, oy - 12, W, oy + 46), fill=(0, 0, 0))
        d.text((W / 2 - ow / 2, oy), overlay, font=F_OVERLAY, fill=YELLOW)
    return img

def end_card(t_frac):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    a = min(1.0, t_frac * 2)
    col = tuple(int(c * a) for c in (255, 255, 255))
    col2 = tuple(int(c * a) for c in ACCENT)
    l1 = "Unified Agent Context"
    l2 = "Your AI team finally shares a memory."
    l3 = "github.com/anthonycho-ux/unified-agent-context"
    d.text((W/2 - d.textlength(l1, font=F_END)/2, 260), l1, font=F_END, fill=col)
    d.text((W/2 - d.textlength(l2, font=F_END_S)/2, 340), l2, font=F_END_S, fill=col)
    d.text((W/2 - d.textlength(l3, font=F_END_S)/2, 420), l3, font=F_END_S, fill=col2)
    return img

frames = []

def hold(img, sec):
    frames.extend([img] * int(sec * FPS))

def type_line(lines, title, prefix, text, color=FG, bold=False, overlay=None, cps=18):
    """Animate typing `text` after `prefix`; mutates and returns lines."""
    step = max(1, round(cps / FPS))
    shown = ""
    i = 0
    while i < len(text):
        i = min(len(text), i + step)
        shown = text[:i]
        frames.append(draw_terminal(lines + [(prefix + shown, color, bold)], title, overlay))
    lines.append((prefix + text, color, bold))
    return lines

# ---------- BEAT 1: THE PAIN ----------
t1 = "claude — session 1 — tuesday"
L = [("$ claude", DIM, False), ("", FG, False)]
hold(draw_terminal(L, t1), 0.8)
L = type_line(L, t1, "you> ", "I prefer English READMEs, default language.", FG)
hold(draw_terminal(L, t1), 0.4)
L.append(("claude> Got it — English by default.", GREEN, False))
hold(draw_terminal(L, t1), 1.2)
L.append(("", FG, False)); L.append(("[session ended]", DIM, False))
hold(draw_terminal(L, t1, cursor=False), 1.0)

t2 = "codex — session 2 — wednesday morning"
L = [("$ codex", DIM, False), ("", FG, False),
     ("codex> What language should the README be?", CYAN, False)]
hold(draw_terminal(L, t2), 1.2)
L = type_line(L, t2, "you> ", "...English. Like I said yesterday.", FG)
hold(draw_terminal(L, t2), 1.0)

t3 = "third agent — session 3 — wednesday night"
L = [("$ hermes", DIM, False), ("", FG, False),
     ("hermes> Quick question — README language?", CYAN, False)]
hold(draw_terminal(L, t3), 1.0)
L = type_line(L, t3, "you> ", "ENGLISH", RED, True, overlay="Every new AI chat starts with amnesia.", cps=8)
hold(draw_terminal(L, t3, overlay="Every new AI chat starts with amnesia."), 2.2)

# ---------- BEAT 2: THE TURN ----------
t4 = "unified-agent-context"
L = [("", FG, False)]
L = type_line(L, t4, "$ ", 'node scripts/record-fact.mjs --type preference \\', FG)
L = type_line(L, t4, "    ", '"English READMEs by default"', FG)
hold(draw_terminal(L, t4), 0.5)
L.append(("RECORDED 4acf2de8f2884fe9 global", GREEN, True))
hold(draw_terminal(L, t4, overlay="Tell any agent. Once."), 2.4)

# ---------- BEAT 3: THE PAYOFF ----------
t5 = "any agent — next session"
L = [("$ codex", DIM, False), ("", FG, False),
     ("[shared context injected: 1 global preference]", ACCENT, False)]
hold(draw_terminal(L, t5), 1.2)
L.append(("codex> Using your English-default README", GREEN, False))
L.append(("codex> preference. Starting the draft.", GREEN, False))
hold(draw_terminal(L, t5), 1.6)
hold(draw_terminal(L, t5, overlay="Your AI team finally shares a memory."), 2.4)

# ---------- END CARD ----------
n_end = int(3.5 * FPS)
for i in range(n_end):
    frames.append(end_card(i / max(1, n_end - 1)))

# ---------- WRITE MP4 ----------
mp4 = os.path.join(OUT_DIR, "uac-promo.mp4")
w = imageio.get_writer(mp4, fps=FPS, codec="libx264", quality=8,
                       pixelformat="yuv420p", macro_block_size=16)
for f in frames:
    w.append_data(np.asarray(f))
w.close()

# ---------- WRITE GIF (640w, 6fps, README-embeddable) ----------
gif = os.path.join(OUT_DIR, "uac-promo.gif")
small = [f.resize((640, 360), Image.LANCZOS).quantize(colors=128, dither=Image.NONE)
         for f in frames[::2]]
small[0].save(gif, save_all=True, append_images=small[1:],
              duration=int(1000 / 6), loop=0, optimize=True)

dur = len(frames) / FPS
print(f"DELIVERED: {mp4} ({os.path.getsize(mp4)//1024}KB), "
      f"{gif} ({os.path.getsize(gif)//1024//1024}.{os.path.getsize(gif)//1024%1024//103}MB), "
      f"{dur:.1f}s, {len(frames)} frames")
