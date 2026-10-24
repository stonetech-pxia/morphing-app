"""生成新手引导的示例旅行照片（D-149）：程序画的风景，带手机拍照的 EXIF 和 GPS 定位，
这样「去掉定位」有东西可去。用法：python3 scripts/make-guide-photos.py"""
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'apps/mobile/assets/guide'
W, H = 4032, 3024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(img, top, bottom, horizon):
    d = ImageDraw.Draw(img)
    for y in range(horizon):
        d.line([(0, y), (W, y)], fill=lerp(top, bottom, y / horizon))


def ridge(img, color, base, amp, seed, rough=0.5):
    rnd = random.Random(seed)
    pts, y, step = [], base, 48
    for x in range(0, W + step, step):
        y += rnd.uniform(-amp, amp) * rough
        y = max(base - amp * 3, min(base + amp, y))
        pts.append((x, y))
    ImageDraw.Draw(img).polygon(pts + [(W, H), (0, H)], fill=color)


def grain(img, strength=24):
    """一点噪点，看起来更像照片，文件也更接近手机拍的大小。"""
    noise = Image.effect_noise((W, H), strength)
    return Image.blend(img, Image.merge('RGB', (noise, noise, noise)), 0.05)


def beach():
    img = Image.new('RGB', (W, H))
    hz = int(H * 0.55)
    sky(img, (52, 84, 160), (250, 170, 120), hz)
    d = ImageDraw.Draw(img)
    d.ellipse([W * 0.62, hz - 520, W * 0.62 + 420, hz - 100], fill=(255, 214, 150))
    for y in range(hz, H):
        t = (y - hz) / (H - hz)
        d.line([(0, y), (W, y)], fill=lerp((60, 110, 170), (20, 60, 110), t))
    ridge(img, (232, 205, 160), int(H * 0.8), 40, 3, 0.3)
    return img


def mountains():
    img = Image.new('RGB', (W, H))
    sky(img, (90, 150, 220), (205, 228, 245), int(H * 0.7))
    ridge(img, (150, 170, 200), int(H * 0.45), 160, 7)
    ridge(img, (90, 115, 150), int(H * 0.58), 140, 11)
    ridge(img, (60, 110, 70), int(H * 0.75), 90, 13)
    ridge(img, (40, 80, 50), int(H * 0.88), 50, 17)
    return img


def city():
    img = Image.new('RGB', (W, H))
    hz = int(H * 0.7)
    sky(img, (30, 30, 80), (240, 120, 90), hz)
    d = ImageDraw.Draw(img)
    rnd = random.Random(5)
    x = 0
    while x < W:
        w = rnd.randint(120, 320)
        h = rnd.randint(300, 1300)
        d.rectangle([x, hz - h, x + w, H], fill=(25, 25, 40))
        for wy in range(hz - h + 40, H, 70):
            for wx in range(x + 20, x + w - 30, 55):
                if rnd.random() < 0.35:
                    d.rectangle([wx, wy, wx + 22, wy + 30], fill=(255, 210, 120))
        x += w + rnd.randint(10, 40)
    return img


def gps(lat, lon):
    def dms(v):
        v = abs(v)
        d = int(v)
        m = int((v - d) * 60)
        s = round(((v - d) * 60 - m) * 60, 2)
        return (float(d), float(m), s)

    return {1: 'N' if lat >= 0 else 'S', 2: dms(lat), 3: 'E' if lon >= 0 else 'W', 4: dms(lon)}


SCENES = [
    ('trip-1.jpg', beach, (36.4618, 25.3753), '2026:07:14 19:42:10'),
    ('trip-2.jpg', mountains, (46.5577, 7.9812), '2026:07:17 11:05:33'),
    ('trip-3.jpg', city, (35.0116, 135.7681), '2026:07:21 18:20:51'),
]

OUT.mkdir(parents=True, exist_ok=True)
for name, draw, (lat, lon), when in SCENES:
    img = draw().filter(ImageFilter.GaussianBlur(1.2))
    img = grain(img)
    exif = Image.Exif()
    exif[0x010F] = 'Apple'
    exif[0x0110] = 'iPhone 16'
    exif[0x0132] = when
    exif.get_ifd(0x8769)[0x9003] = when
    exif.get_ifd(0x8825).update(gps(lat, lon))
    img.save(OUT / name, 'JPEG', quality=85, exif=exif)
    print(name, (OUT / name).stat().st_size // 1024, 'KB')
