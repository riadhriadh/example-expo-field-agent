#!/usr/bin/env python3
"""Génère les images de la bulle flottante.

Quatre PNG de 96 px (24 dp en xxxhdpi), blancs sur fond transparent, parce que la
bulle les pose sur une pastille dont la couleur porte déjà l'état :

    bubble-wheel.png      volant    — `bubble.icon`, et l'attente
    bubble-arrow.png      flèche    — en route vers le client
    bubble-pin.png        épingle   — sur place
    bubble-passenger.png  client    — course en cours

Les fichiers sont versionnés ; ce script existe pour pouvoir les régler.

    python3 assets/make-bubble-icons.py
"""

import math
import struct
import zlib
from pathlib import Path

SIZE = 96
SUPERSAMPLE = 4  # sans ça les bords crénelés se voient à 24 dp
HERE = Path(__file__).parent


def png(path: Path, alpha) -> None:
    """Écrit un PNG RGBA blanc dont l'opacité vient de `alpha(x, y) -> 0..1`."""
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filtre « none »
        for x in range(SIZE):
            raw += bytes((255, 255, 255, round(255 * alpha(x, y))))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8 bits, RGBA
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def antialiased(shape):
    """Moyenne SUPERSAMPLE² échantillons par pixel : le bord devient une pente, pas un escalier."""

    def alpha(px: int, py: int) -> float:
        hits = 0
        for sy in range(SUPERSAMPLE):
            for sx in range(SUPERSAMPLE):
                u = (px + (sx + 0.5) / SUPERSAMPLE) / SIZE
                v = (py + (sy + 0.5) / SUPERSAMPLE) / SIZE
                if shape(u, v):
                    hits += 1
        return hits / (SUPERSAMPLE * SUPERSAMPLE)

    return alpha


def distance(ux, uy, cx, cy):
    return math.hypot(ux - cx, uy - cy)


def segment(ux, uy, ax, ay, bx, by, width):
    """Distance point-segment : sert aux rayons du volant et à la hampe de la flèche."""
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((ux - ax) * dx + (uy - ay) * dy) / length))
    return math.hypot(ux - (ax + t * dx), uy - (ay + t * dy)) <= width


def wheel(u, v):
    d = distance(u, v, 0.5, 0.5)
    if 0.30 <= d <= 0.42:  # la jante
        return True
    if d <= 0.11:  # le moyeu
        return True
    for angle in (90, 210, 330):  # trois rayons
        rad = math.radians(angle)
        if segment(u, v, 0.5, 0.5, 0.5 + 0.36 * math.cos(rad), 0.5 - 0.36 * math.sin(rad), 0.045):
            return True
    return False


def arrow(u, v):
    # Pointe : un triangle isocèle, base en haut.
    if 0.16 <= v <= 0.46:
        half = 0.34 * (v - 0.16) / 0.30
        if abs(u - 0.5) <= half:
            return True
    return 0.42 <= v <= 0.84 and abs(u - 0.5) <= 0.10  # la hampe


def pin(u, v):
    if distance(u, v, 0.5, 0.38) <= 0.26:  # la tête
        return distance(u, v, 0.5, 0.38) >= 0.10  # évidée au centre
    # La pointe, un triangle qui descend vers le bas.
    if 0.56 <= v <= 0.86:
        half = 0.22 * (0.86 - v) / 0.30
        return abs(u - 0.5) <= half
    return False


def passenger(u, v):
    if distance(u, v, 0.5, 0.30) <= 0.17:  # la tête
        return True
    # Les épaules : une demi-couronne.
    d = distance(u, v, 0.5, 0.86)
    return 0.30 <= d <= 0.44 and v >= 0.54


ICONS = {
    "bubble-wheel.png": wheel,
    "bubble-arrow.png": arrow,
    "bubble-pin.png": pin,
    "bubble-passenger.png": passenger,
}


def main() -> None:
    for name, shape in ICONS.items():
        path = HERE / name
        png(path, antialiased(shape))
        print(f"{name} : {SIZE}x{SIZE}, {path.stat().st_size} octets")


if __name__ == "__main__":
    main()
