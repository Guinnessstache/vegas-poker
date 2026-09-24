# Generates Steam achievement icons (64x64: unlocked + locked) as casino chips.
#   python tools/make-achievement-icons.py   ->  steam/achievements/*.jpg
import math, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

OUT = os.path.join(os.path.dirname(__file__), '..', 'steam', 'achievements')   # upload these to Steamworks
GAME = os.path.join(os.path.dirname(__file__), '..', 'public', 'img', 'ach')      # shown in-game (128px)
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
FONT_SYMBOLS = '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf'  # GNU FreeSerif Bold: has the swords, crown and star glyphs

def font_for(text, preferred):
    # Use the preferred font unless it lacks one of the characters.
    try:
        from fontTools.ttLib import TTFont
        for f in (preferred, FONT_SYMBOLS):
            cmap = TTFont(f, lazy=True).getBestCmap()
            if all(ord(ch) in cmap for ch in text if not ch.isspace()):
                return f
    except Exception:
        pass
    return preferred

TIERS = {  # chip body, edge stripes
    'red':   ((150, 24, 32), (245, 235, 220)),
    'green': ((22, 110, 60), (245, 235, 220)),
    'blue':  ((28, 70, 150), (245, 235, 220)),
    'black': ((22, 20, 22), (232, 192, 96)),
}
ICONS = [
    ('FIRST_HAND', '♠', 'red'), ('FIRST_WIN', '$', 'red'), ('SHOWDOWN_WIN', '⚔', 'red'),
    ('NERVES_OF_STEEL', '!', 'green'), ('ALL_IN_WIN', 'ALL\nIN', 'green'), ('BIG_POT', '$$', 'green'),
    ('DOUBLE_UP', '×2', 'green'), ('COMEBACK', '↑', 'green'), ('QUADS', '4×', 'blue'),
    ('STRAIGHT_FLUSH', 'SF', 'black'), ('ROYAL_FLUSH', '♔', 'black'), ('THE_HAMMER', '7-2', 'black'),
    ('KNOCKOUT', 'KO', 'blue'), ('KNOCKOUT_10', '10', 'blue'), ('SHARK_HUNTER', '★', 'black'),
    ('LAST_ONE_STANDING', '#1', 'black'), ('FRIENDLY_GAME', '♥', 'red'), ('SAY_CHEESE', '◉', 'red'),
    ('HANDS_100', '100', 'blue'), ('HANDS_1000', '1K', 'black'),
]

def chip(symbol, tier, S=512):
    body, stripe = TIERS[tier]
    img = Image.new('RGB', (S, S), (18, 10, 6))
    bg = ImageDraw.Draw(img)
    for r in range(S // 2, 0, -4):  # warm vignette background
        t = r / (S / 2)
        bg.ellipse([S/2 - r*1.45, S/2 - r*1.45, S/2 + r*1.45, S/2 + r*1.45], fill=(int(60 - 42*t), int(34 - 24*t), int(18 - 12*t)))
    d = ImageDraw.Draw(img)
    c, R = S / 2, S * 0.46
    d.ellipse([c - R + 6, c - R + 12, c + R + 6, c + R + 12], fill=(8, 4, 2))  # shadow
    d.ellipse([c - R, c - R, c + R, c + R], fill=body)
    for k in range(8):  # edge stripes
        a0 = k * 45 - 9
        d.pieslice([c - R, c - R, c + R, c + R], a0, a0 + 18, fill=stripe)
    Ri = R * 0.78
    d.ellipse([c - Ri, c - Ri, c + Ri, c + Ri], fill=body)
    d.ellipse([c - Ri, c - Ri, c + Ri, c + Ri], outline=stripe, width=int(S * 0.012))
    Rc = R * 0.62
    face = tuple(min(255, int(v * 1.12)) for v in body)
    d.ellipse([c - Rc, c - Rc, c + Rc, c + Rc], fill=face, outline=(232, 192, 96), width=int(S * 0.018))
    lines = symbol.split('\n')
    longest = max(len(l) for l in lines)
    size = int(S * (0.42 if longest <= 1 else 0.32 if longest == 2 else 0.22) / (1 if len(lines) == 1 else 1.55))
    text = '\n'.join(lines)
    font = ImageFont.truetype(font_for(text, FONT_SERIF if longest <= 1 else FONT_BOLD), size)
    bbox = d.multiline_textbbox((0, 0), text, font=font, align='center', spacing=int(size * 0.05))
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pos = (c - w / 2 - bbox[0], c - h / 2 - bbox[1])
    d.multiline_text((pos[0] + 5, pos[1] + 7), text, font=font, fill=(0, 0, 0), align='center', spacing=int(size * 0.05))
    d.multiline_text(pos, text, font=font, fill=(250, 220, 130), align='center', spacing=int(size * 0.05))
    # soft highlight
    hl = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hl).ellipse([c - R * 0.9, c - R * 0.95, c + R * 0.3, c - R * 0.1], fill=38)
    hl = hl.filter(ImageFilter.GaussianBlur(S * 0.04))
    img = Image.composite(Image.new('RGB', (S, S), (255, 255, 255)), img, hl)
    return img

def locked(img):
    g = ImageOps.grayscale(img).point(lambda v: int(v * 0.55))
    return ImageOps.colorize(g, (10, 10, 12), (150, 150, 158))

os.makedirs(OUT, exist_ok=True)
os.makedirs(GAME, exist_ok=True)
sheet = Image.new('RGB', (10 * 136, 4 * 136), (30, 20, 12))
for i, (aid, sym, tier) in enumerate(ICONS):
    big = chip(sym, tier)
    on = big.resize((64, 64), Image.LANCZOS)
    off = locked(big).resize((64, 64), Image.LANCZOS)
    on.save(os.path.join(OUT, f'{aid}.jpg'), quality=95)
    off.save(os.path.join(OUT, f'{aid}_locked.jpg'), quality=95)
    big.resize((128, 128), Image.LANCZOS).save(os.path.join(GAME, f'{aid}.jpg'), quality=88)
    locked(big).resize((128, 128), Image.LANCZOS).save(os.path.join(GAME, f'{aid}_locked.jpg'), quality=88)
    x, y = (i % 10) * 136, (i // 10) * 2 * 136
    sheet.paste(big.resize((128, 128), Image.LANCZOS), (x + 4, y + 4))
    sheet.paste(locked(big).resize((128, 128), Image.LANCZOS), (x + 4, y + 136 + 4))
sheet.save(os.path.join(OUT, '_preview.png'))
print('wrote', len(ICONS) * 2, 'icons to', os.path.abspath(OUT))
