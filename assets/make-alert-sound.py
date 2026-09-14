#!/usr/bin/env python3
"""Génère assets/alerte.wav, la sonnerie d'offre.

Le fichier est versionné : ce script existe pour pouvoir le régler, pas pour être
lancé au build. Le natif le joue **en boucle** sur le flux d'alarme, donc le clip
commence et finit sur du silence — sinon la couture s'entend à chaque tour.

    python3 assets/make-alert-sound.py
"""

import array
import math
import wave
from pathlib import Path

RATE = 44100
BEEP_MS = 180
GAP_MS = 220
TONES = (1046.5, 784.0, 1046.5, 784.0)  # do6 / sol5 alternés : ça perce le bruit de la route
LEVEL = 0.55  # marge conservée : le volume d'alarme est déjà poussé au maximum par le plugin
FADE_MS = 8  # sans ces fondus, chaque bip claque

OUT = Path(__file__).with_name("alerte.wav")


def beep(frequency: float) -> array.array:
    samples = array.array("h")
    total = int(RATE * BEEP_MS / 1000)
    fade = int(RATE * FADE_MS / 1000)
    for n in range(total):
        t = n / RATE
        # La deuxième harmonique, discrète, rend le bip moins « bip de test ».
        wave_value = math.sin(2 * math.pi * frequency * t) + 0.3 * math.sin(4 * math.pi * frequency * t)
        envelope = min(1.0, n / fade, (total - n) / fade)
        samples.append(int(max(-1.0, min(1.0, wave_value / 1.3)) * envelope * LEVEL * 32767))
    return samples


def main() -> None:
    silence = array.array("h", [0] * int(RATE * GAP_MS / 1000))
    frames = array.array("h")
    for frequency in TONES:
        frames.extend(beep(frequency))
        frames.extend(silence)

    with wave.open(str(OUT), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames.tobytes())

    print(f"{OUT.name} : {len(frames) / RATE:.2f} s, {OUT.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
