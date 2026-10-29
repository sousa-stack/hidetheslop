"""Draws the toolbar icon (an AI sparkle with a no-entry slash) as PNGs. Stdlib only."""
import math
import struct
import sys
import zlib
from pathlib import Path

ORANGE = (194, 65, 12)
SPARKLE = (120, 113, 108)
SS = 4  # supersampling per axis


def coverage(x, y):
    """Return (r, g, b, a) for a point in [-1, 1]^2."""
    d = math.hypot(x, y)
    ring = 0.80 <= d <= 0.98
    # slash from top-left to bottom-right, inside the ring
    slash = abs(x - y) / math.sqrt(2) <= 0.11 and d <= 0.85
    if ring or slash:
        return (*ORANGE, 255)
    # four-pointed sparkle: |x|^p + |y|^p <= r^p with p < 1
    p, r = 0.55, 0.62
    if abs(x) ** p + abs(y) ** p <= r ** p:
        return (*SPARKLE, 255)
    return (0, 0, 0, 0)


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = ((px + (sx + 0.5) / SS) / size) * 2 - 1
                    y = ((py + (sy + 0.5) / SS) / size) * 2 - 1
                    r, g, b, a = coverage(x, y)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            n = SS * SS
            alpha = acc[3] / n
            if alpha:
                row += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(alpha)])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(kind, data):
        c = kind + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        (out / f"icon-{s}.png").write_bytes(render(s))
