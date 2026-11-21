import math, os, struct, zlib

SIZE = 81
SS = 3  # supersample
COLORS = {"normal": (154, 160, 166), "active": (255, 107, 53)}

def dist_seg(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

def arc_points(cx, cy, r, a0, a1, steps=40):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps))) for i in range(steps + 1)]

def dist_poly(px, py, pts):
    return min(dist_seg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) for i in range(len(pts) - 1))

def dist_circle(px, py, cx, cy, r):
    return abs(math.hypot(px - cx, py - cy) - r)

def round_rect_path(x1, y1, x2, y2, r):
    pts = []
    pts += arc_points(x2 - r, y1 + r, r, -90, 0, 12)
    pts += arc_points(x2 - r, y2 - r, r, 0, 90, 12)
    pts += arc_points(x1 + r, y2 - r, r, 90, 180, 12)
    pts += arc_points(x1 + r, y1 + r, r, 180, 270, 12)
    pts.append(pts[0])
    return pts

W = 5.6  # stroke width

def icon_shapes(name):
    if name == "home":
        roof = [(14, 42), (40.5, 17), (67, 42)]
        body = [(20, 37), (20, 66), (61, 66), (61, 37)]
        door = [(34, 66), (34, 50), (47, 50), (47, 66)]
        return [("poly", roof), ("poly", body), ("poly", door)]
    if name == "community":
        bubble = round_rect_path(13, 18, 68, 54, 13)
        tail = [(27, 54), (24, 67), (40, 54)]
        line1 = [(26, 31), (55, 31)]
        line2 = [(26, 42), (45, 42)]
        return [("poly", bubble), ("poly", tail), ("poly", line1), ("poly", line2)]
    if name == "publish":
        box = round_rect_path(13, 13, 68, 68, 18)
        plus1 = [(40.5, 27), (40.5, 54)]
        plus2 = [(27, 40.5), (54, 40.5)]
        return [("poly", box), ("poly", plus1), ("poly", plus2)]
    if name == "message":
        bell = arc_points(40.5, 44, 15, 180, 360, 44)
        left = [(25.5, 44), (25.5, 53)]
        right = [(55.5, 44), (55.5, 53)]
        base = [(19, 55), (62, 55)]
        clapper = [(40.5, 63), (40.5, 63)]
        return [("poly", bell), ("poly", left), ("poly", right), ("poly", base),
                ("circle", (40.5, 62, 2.6))]
    if name == "mine":
        head = ("circle", (40.5, 29, 11))
        shoulder = arc_points(40.5, 70, 22, 200, 340, 40)
        return [head, ("poly", shoulder)]
    raise ValueError(name)

def render(name, rgb):
    shapes = icon_shapes(name)
    rows = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            acc = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    best = 1e9
                    for kind, data in shapes:
                        if kind == "poly":
                            best = min(best, dist_poly(px, py, data))
                        else:
                            best = min(best, dist_circle(px, py, data[0], data[1], data[2]))
                    d = best - W / 2
                    if d <= 0:
                        acc += 1.0
                    elif d < 0.9:
                        acc += 1.0 - d / 0.9
            row.extend([rgb[0], rgb[1], rgb[2], int(round(255 * acc / (SS * SS)))])
        rows.append(row)
    return rows

def write_png(path, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(out, exist_ok=True)
for name in ["home", "community", "publish", "message", "mine"]:
    for suffix, key in [("", "normal"), ("-active", "active")]:
        write_png(os.path.join(out, name + suffix + ".png"), render(name, COLORS[key]))
print("icons done:", sorted(os.listdir(out)))
