"""Edge-only eye-hole vignettes: the centre stays clear; only the screen edges
darken, following the outer contour of each mask's eye holes.

Input: assets/holes/<mask>.png (front view of the mask, white mask on black,
rendered orthographically). Output: assets/vignette_<mask>.png (1600x900 RGBA).

    python prototype/tools/make_vignettes.py
"""
import numpy as np, pathlib
from PIL import Image, ImageFilter
from collections import deque
W, H = 1600, 900
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets'
CFG = {  # name: (height of clear area as fraction of screen, max darkness, gold tint)
    'don': (0.86, 0.85, None),
    'anna': (0.92, 0.86, (78, 58, 20)),
    'servant': (0.80, 0.90, None),
}
def holes_of(name):
    im = np.array(Image.open(ROOT / 'assets' / 'holes' / f'{name}.png').convert('L').resize((512, 512)))
    dark = im < 128
    h, w = dark.shape
    outside = np.zeros_like(dark); q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if dark[y, x] and not outside[y, x]: outside[y, x] = True; q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if dark[y, x] and not outside[y, x]: outside[y, x] = True; q.append((y, x))
    while q:
        a, b = q.popleft()
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            u, v = a + da, b + db
            if 0 <= u < h and 0 <= v < w and dark[u, v] and not outside[u, v]:
                outside[u, v] = True; q.append((u, v))
    return dark & ~outside
for name, (hk, amax, tint) in CFG.items():
    holes = holes_of(name)
    # merge the two eyes into one shape: fill each row between its outermost hole pixels
    merged = np.zeros_like(holes)
    for y in range(holes.shape[0]):
        xs = np.nonzero(holes[y])[0]
        if len(xs) > 1: merged[y, xs.min():xs.max() + 1] = True
    ys, xs = np.nonzero(merged)
    crop = Image.fromarray((merged * 255).astype(np.uint8)).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    shape = crop.resize((int(W * 1.06), int(H * hk)), Image.LANCZOS)
    canvas = Image.new('L', (W, H), 0)
    canvas.paste(shape, ((W - shape.width) // 2, (H - shape.height) // 2))
    soft = np.array(canvas.filter(ImageFilter.GaussianBlur(55))).astype(np.float32) / 255.0
    alpha = np.clip((1.0 - soft) * 1.25 - 0.05, 0, 1) ** 1.4 * amax
    if name == 'anna':  # her right eye sits in crumpled gold: a little darker on the right
        alpha = np.clip(alpha * (1 + 0.22 * np.linspace(0, 1, W)[None, :] ** 2), 0, 1)
    rgb = np.zeros((H, W, 3), np.float32); rgb[:] = (10, 8, 7)
    if tint:
        g = 0.55 * np.linspace(0, 1, W)[None, :, None] ** 3
        rgb = rgb * (1 - g) + np.array(tint, np.float32)[None, None, :] * g
    Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA').save(OUT / f'vignette_{name}.png', optimize=True)
    print(name, 'max alpha at centre', round(float(alpha[H // 2, W // 2]), 3))
