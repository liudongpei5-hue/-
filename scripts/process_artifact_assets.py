from pathlib import Path
from collections import deque
from PIL import Image, ImageFilter

SOURCE = Path(r"C:\Users\lenovo\Desktop\第二页图文资产")
TARGET = Path(r"C:\Users\lenovo\Documents\卢夫人墓网站\public\assets\artifacts\catalog")
TARGET.mkdir(parents=True, exist_ok=True)

FILES = {
    "泥质红陶模制镇墓兽（东）.png": "tomb-beast-east.png",
    "泥质红陶模制镇墓兽（西）.png": "tomb-beast-west.png",
    "泥质红陶骑马俑.png": "mounted-figurine.png",
    "高髻袒胸窄袖女骑俑.png": "female-mounted-figurine.png",
    "铜钵.png": "bronze-bowl.png",
    "银环.png": "silver-ring.png",
    "贝壳.png": "shell.png",
    "玻璃串珠.png": "glass-beads.png",
    "铜钱.png": "kaiyuan-coin.png",
    "墓志1.png": "epitaph-set.png",
    "墓志2.png": "epitaph-rubbing.png",
}


def extract_subject(source: Path, target: Path) -> None:
    image = Image.open(source).convert("RGBA")
    alpha = image.getchannel("A")
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((image.width - 1, 0)),
               alpha.getpixel((0, image.height - 1)), alpha.getpixel((image.width - 1, image.height - 1))]
    if min(corners) > 245:
        scale = 4
        small = image.convert("RGB").resize((max(1, image.width // scale), max(1, image.height // scale)), Image.Resampling.BILINEAR)
        w, h = small.size
        pixels = small.load()
        visited = bytearray(w * h)
        queue = deque()
        for x in range(w):
            queue.append((x, 0)); queue.append((x, h - 1))
        for y in range(h):
            queue.append((0, y)); queue.append((w - 1, y))
        while queue:
            x, y = queue.popleft()
            idx = y * w + x
            if visited[idx]:
                continue
            r, g, b = pixels[x, y]
            if min(r, g, b) < 188 or max(r, g, b) - min(r, g, b) > 34:
                continue
            visited[idx] = 1
            if x: queue.append((x - 1, y))
            if x + 1 < w: queue.append((x + 1, y))
            if y: queue.append((x, y - 1))
            if y + 1 < h: queue.append((x, y + 1))
        small_matte = Image.new("L", (w, h), 255)
        small_matte.putdata([0 if value else 255 for value in visited])
        matte = small_matte.resize(image.size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
        image.putalpha(matte)
    bbox = image.getchannel("A").point(lambda value: 255 if value > 7 else 0).getbbox()
    if bbox:
        padding = max(18, int(max(image.size) * .018))
        bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding),
                min(image.width, bbox[2] + padding), min(image.height, bbox[3] + padding))
        image = image.crop(bbox)
    image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
    image.save(target, optimize=True)


for source_name, target_name in FILES.items():
    extract_subject(SOURCE / source_name, TARGET / target_name)
    print(target_name)
