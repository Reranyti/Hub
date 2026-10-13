"""Рисует иконку приложения (assets/icon.ico): тёмная плитка с лаймовым знаком, как в логотипе."""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
BG, ACCENT, INK = (14, 14, 18, 255), (200, 245, 66, 255), (17, 20, 10, 255)


def draw() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=230, fill=BG)
    # тонкая рамка
    d.rounded_rectangle((14, 14, SIZE - 15, SIZE - 15), radius=218, outline=(255, 255, 255, 26), width=6)
    # лаймовый квадрат со срезанным углом
    a, b = 250, SIZE - 250
    cut = 190
    d.polygon([(a, a), (b - cut, a), (b, a + cut), (b, b), (a, b)], fill=ACCENT)
    # «окно» внутри знака
    c, e = 400, SIZE - 400
    d.rectangle((c, c, e, e), fill=BG)
    d.rectangle((c + 70, c + 70, e - 70, e - 70), fill=ACCENT)
    return img


if __name__ == "__main__":
    out = Path(__file__).with_name("icon.ico")
    draw().save(out, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
    draw().resize((256, 256), Image.LANCZOS).save(out.with_name("icon_preview.png"))
    print("saved", out)
