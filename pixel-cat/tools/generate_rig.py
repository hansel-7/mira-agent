"""Build a layered animation rig from assets/mira_still.png (frame 5 = open eyes).

Outputs:
  assets/mira_base.png  - 80x80 base sprite (open eyes, no pupils)
  assets/mira_rig.png   - patch atlas: ear/tail/whisker variants + blink
  assets/rig-meta.json  - region destinations + atlas coords + eye geometry

Regions (all movement in 2px steps - the art is a 40x40 design at 2x):
  earL/earR : 3 variants (tip leans out / base / leans in)
  tail      : 3 variants (tip raised / base / drooped)
  whiskL/R  : 3 variants (long / base / short), both bars per side
  blink     : 1 variant (discs blacked + white lid)

Run from the pixel-cat folder: python tools/generate_rig.py
"""
import json
from PIL import Image

WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)

sheet = Image.open("assets/mira_still.png").convert("RGBA")
base = sheet.crop((5 * 80, 0, 6 * 80, 80))
base.save("assets/mira_base.png")


def clear_rect(img, x0, y0, x1, y1):
    blk = Image.new("RGBA", (x1 - x0, y1 - y0), CLEAR)
    img.paste(blk, (x0, y0))


# ---------- ears: shift tip rows (abs y2-5) horizontally ----------
def ear_variants(bx0):
    bbox = (bx0, 0, bx0 + 20, 10)
    out = []
    for dx in (-2, 0, 2):
        img = base.crop(bbox).copy()
        tip = base.crop(bbox).crop((0, 2, 20, 6))
        clear_rect(img, 0, 2, 20, 6)
        img.paste(tip, (dx, 2), tip)
        out.append(img)
    return bbox, out


# ---------- tail: shift outer columns (abs x72-79) vertically ----------
def tail_variants():
    bbox = (64, 50, 80, 76)
    out = []
    for dy in (-2, 0, 2):
        img = base.crop(bbox).copy()
        cols = base.crop(bbox).crop((8, 0, 16, 26))
        clear_rect(img, 8, 0, 16, 26)
        img.paste(cols, (8, dy), cols)
        out.append(img)
    return bbox, out


# ---------- whiskers: parametric redraw at 3 lengths ----------
# left bars: rows abs 26-31 and 34-39, outer end (cap) at x6, body at x14+
# right bars: rows same, white starts x66 (dynamic), caps at x70-71 / x72-73
def whisk_left_variants():
    bbox = (4, 26, 20, 40)
    out = []
    for off in (-2, 0, 2):  # long, base, short
        img = base.crop(bbox).copy()
        px = img.load()
        for R in (0, 8):  # bar rows relative to bbox
            xe = 6 + off - 4  # cap start, relative (abs 6+off)
            for y in range(R, R + 6):
                for x in range(0, 10):
                    px[x, y] = CLEAR
            for y in (R, R + 1, R + 4, R + 5):
                for x in range(xe, 10):
                    px[x, y] = WHITE
            for y in (R + 2, R + 3):
                px[xe, y] = WHITE
                px[xe + 1, y] = WHITE
                for x in range(xe + 2, 10):
                    px[x, y] = BLACK
        out.append(img)
    return bbox, out


def whisk_right_variants():
    bbox = (60, 26, 76, 40)
    out = []
    for off in (2, 0, -2):  # long, base, short (mirrored sign)
        img = base.crop(bbox).copy()
        px = img.load()
        for R, xe0 in ((0, 71), (8, 71)):  # cap end abs
            xe = xe0 + off - 60  # relative
            for y in range(R, R + 6):
                for x in range(6, 16):
                    px[x, y] = CLEAR
            for y in (R, R + 1, R + 4, R + 5):
                for x in range(6, xe + 1):
                    px[x, y] = WHITE
            for y in (R + 2, R + 3):
                for x in range(6, xe - 1):
                    px[x, y] = BLACK
                px[xe - 1, y] = WHITE
                px[xe, y] = WHITE
        out.append(img)
    return bbox, out


# ---------- blink: discs blacked out + white lid line ----------
def blink_variant():
    bbox = (24, 18, 54, 32)
    img = base.crop(bbox).copy()
    px = img.load()
    w, h = img.size
    seen, blobs = set(), []
    for sy in range(h):
        for sx in range(w):
            if (sx, sy) in seen or px[sx, sy] != WHITE:
                continue
            stack, blob = [(sx, sy)], []
            while stack:
                x, y = stack.pop()
                if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
                    continue
                seen.add((x, y))
                if px[x, y] != WHITE:
                    continue
                blob.append((x, y))
                stack += [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]
            if len(blob) > 10:
                blobs.append(blob)
    assert len(blobs) == 2, f"expected 2 eye discs, got {len(blobs)}"
    for blob in blobs:
        ly = max(p[1] for p in blob)
        for (x, y) in blob:
            px[x, y] = WHITE if y >= ly - 1 else BLACK
    return bbox, [img]



# ---------- mouth: closed / small open / wide-open (the あ meme) ----------
def mouth_variants():
    bbox = (32, 31, 48, 43)  # clean black area under the eyes
    def ring(img, x0, y0, w, h):
        px = img.load()
        for x in range(x0, x0 + w):
            for y in range(y0, y0 + h):
                corner = (x < x0+2 or x >= x0+w-2) and (y < y0+2 or y >= y0+h-2)
                if not corner:
                    px[x, y] = WHITE
        for x in range(x0+2, x0+w-2):
            for y in range(y0+2, y0+h-2):
                px[x, y] = BLACK
    closed = base.crop(bbox).copy()
    small = base.crop(bbox).copy()
    ring(small, 4, 3, 8, 6)
    wide = base.crop(bbox).copy()
    ring(wide, 2, 1, 12, 10)
    return bbox, [closed, small, wide]

# ---------- assemble atlas ----------
regions = {}
patches = []
for name, (bbox, variants) in {
    "earL": ear_variants(18),
    "earR": ear_variants(42),
    "tail": tail_variants(),
    "whiskL": whisk_left_variants(),
    "whiskR": whisk_right_variants(),
    "mouth": mouth_variants(),
    "blink": blink_variant(),
}.items():
    sxs = []
    for v in variants:
        sxs.append(sum(p.width for p in patches))
        patches.append(v)
    regions[name] = {
        "x": bbox[0], "y": bbox[1],
        "w": bbox[2] - bbox[0], "h": bbox[3] - bbox[1],
        "sx": sxs,
        "neutral": 0 if name in ("mouth", "blink") else 1,
    }

atlas = Image.new("RGBA", (sum(p.width for p in patches), max(p.height for p in patches)), CLEAR)
x = 0
for p in patches:
    atlas.paste(p, (x, 0))
    x += p.width
atlas.save("assets/mira_rig.png")

# ---------- sanity: composing all base variants must equal the base ----------
recon = base.copy()
for name, r in regions.items():
    if name == "blink":
        continue
    i = r["sx"][r["neutral"]]
    patch = atlas.crop((i, 0, i + r["w"], r["h"]))
    clear_rect(recon, r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
    recon.paste(patch, (r["x"], r["y"]))
bp, rp = base.load(), recon.load()
bad = [(x, y) for x in range(80) for y in range(80) if bp[x, y] != rp[x, y]]
if bad:
    print("MISMATCH:", len(bad), sorted(bad)[:20])
diff = len(bad)
assert diff == 0, f"base reconstruction differs: {diff} px"

meta = {
    "leanSplit": 46,
    "eyes": {
        "left":  {"pupil": {"x": 28, "y": 22, "w": 6, "h": 6}},
        "right": {"pupil": {"x": 44, "y": 22, "w": 6, "h": 6}},
    },
    "pupilTravel": 2,
    "regions": regions,
}
json.dump(meta, open("assets/rig-meta.json", "w"), indent=2)
print("rig OK - reconstruction diff:", diff)
