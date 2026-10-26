"""Generate the app icons (PNG + SVG) without any image libraries."""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "icons"
BLUE = (26, 115, 232)
WHITE = (255, 255, 255)
LIGHT = (210, 227, 252)


def rounded(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(u, v, maskable, mono):
    """u, v in [0, 1). Returns RGBA."""
    pad = 0.0 if maskable else 0.04
    if mono:
        bg = None
    elif maskable:
        bg = BLUE
    else:
        bg = BLUE if rounded(u, v, pad, pad, 1 - pad, 1 - pad, 0.22) else None
    s = 0.62 if maskable else 0.78  # page scale (maskable needs safe zone)
    o = (1 - s) / 2
    pu, pv = (u - o) / s, (v - o) / s
    color = bg
    if rounded(pu, pv, 0.08, 0.12, 0.92, 0.92, 0.1):
        color = WHITE
        if pv < 0.34:
            color = LIGHT if not mono else WHITE
        # rings
        for rx in (0.3, 0.7):
            if rounded(pu, pv, rx - 0.035, 0.04, rx + 0.035, 0.24, 0.035):
                color = (60, 64, 67) if not mono else WHITE
        # day grid
        for row in range(2):
            for col in range(3):
                gx = 0.2 + col * 0.22
                gy = 0.45 + row * 0.22
                if rounded(pu, pv, gx, gy, gx + 0.15, gy + 0.13, 0.03):
                    color = BLUE if not (row == 1 and col == 2) else (234, 67, 53)
                    if mono:
                        color = None
    elif rounded(pu, pv, 0.26, 0.04, 0.34, 0.24, 0.04) or rounded(pu, pv, 0.66, 0.04, 0.74, 0.24, 0.04):
        color = WHITE
    if color is None:
        return (0, 0, 0, 0)
    return (*color, 255)


def png(size, maskable=False, mono=False):
    ss = 3  # supersampling for smooth edges
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    p = pixel((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, maskable, mono)
                    a = p[3]
                    acc[0] += p[0] * a
                    acc[1] += p[1] * a
                    acc[2] += p[2] * a
                    acc[3] += a
            n = ss * ss
            alpha = acc[3] / n
            if acc[3]:
                row += bytes([int(acc[0] / acc[3]), int(acc[1] / acc[3]), int(acc[2] / acc[3]), int(alpha)])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="4" y="4" width="92" height="92" rx="22" fill="#1a73e8"/>
  <rect x="17.2" y="20.3" width="65.5" height="62.4" rx="7.8" fill="#fff"/>
  <path d="M17.2 28.1a7.8 7.8 0 0 1 7.8-7.8h50a7.8 7.8 0 0 1 7.8 7.8v8.4H17.2z" fill="#d2e3fc"/>
  <rect x="31.6" y="14" width="6" height="17" rx="3" fill="#3c4043"/>
  <rect x="62.4" y="14" width="6" height="17" rx="3" fill="#3c4043"/>
  <g fill="#1a73e8">
    <rect x="26.6" y="46.1" width="11.7" height="10.1" rx="2.3"/>
    <rect x="43.8" y="46.1" width="11.7" height="10.1" rx="2.3"/>
    <rect x="60.9" y="46.1" width="11.7" height="10.1" rx="2.3"/>
    <rect x="26.6" y="63.3" width="11.7" height="10.1" rx="2.3"/>
    <rect x="43.8" y="63.3" width="11.7" height="10.1" rx="2.3"/>
  </g>
  <rect x="60.9" y="63.3" width="11.7" height="10.1" rx="2.3" fill="#ea4335"/>
</svg>
"""

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon.svg").write_text(SVG, encoding="utf-8")
    (OUT / "icon-192.png").write_bytes(png(192))
    (OUT / "icon-512.png").write_bytes(png(512))
    (OUT / "icon-maskable-512.png").write_bytes(png(512, maskable=True))
    (OUT / "apple-touch-icon.png").write_bytes(png(180, maskable=True))
    (OUT / "badge-96.png").write_bytes(png(96, mono=True))
    print("icons written to", OUT)
