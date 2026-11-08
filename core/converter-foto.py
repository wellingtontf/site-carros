#!/usr/bin/env python3
# Converte UMA foto para webp nas larguras pedidas (conversor padrão de core/fotos.js; precisa do Pillow).
#   python3 core/converter-foto.py <entrada> <saida-sem-extensao> 400,800,1600
#   → <saida>-400.webp, <saida>-800.webp, <saida>-1600.webp (nunca amplia: foto pequena fica no tamanho dela)
# Dá para trocar por outro conversor (cwebp, ImageMagick, sharp...) em config/fotos.json → "converter".
import sys
from PIL import Image, ImageOps

entrada, saida, larguras = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
im = Image.open(entrada)
im = ImageOps.exif_transpose(im).convert('RGB')  # foto de celular "deitada" fica em pé; PNG com transparência vira RGB
for w in larguras:
    c = im if im.width <= w else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    c.save(f'{saida}-{w}.webp', 'WEBP', quality=80, method=4)
