#!/usr/bin/env python3
"""Teste de migração: importa o estoque público da Trokey para o formato da plataforma.

- Lê https://www.trokey.com.br/api/public/vehicles (lista) e /vehicles/<id> (detalhe: opcionais e telefone da loja).
- Grava sites-config/trokey.com.br/estoque.json (o único JSON de carros do site; cada carro diz a sua "loja").
- Atualiza "lojas" de sites-config/trokey.com.br/site.json (uma loja por franqueado, com WhatsApp quando a API informa).
- Baixa as fotos e grava no padrão do S3 da plataforma: <pasta>/carros/<id>/<n>-<400|800|1600>.webp
  (por padrão em s3-local/, que faz o papel do bucket; em produção seria um `aws s3 sync s3-local/ s3://bucket/`).

Uso: python3 ferramentas/importar-trokey.py [--fotos-dir s3-local] [--sem-fotos]
Requer Pillow (PIL) com suporte a webp.
"""
import io, json, os, re, sys, unicodedata, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://www.trokey.com.br/api/public/vehicles'
TEAM = 'edd32414-9f46-4574-b147-bab7f5c5ee01'
UA = {'User-Agent': 'Mozilla/5.0 (importador site-carros)'}
SITE = os.path.join(ROOT, 'sites-config', 'trokey.com.br')
TAMANHOS = (400, 800, 1600)
MAX_FOTOS = 60

args = sys.argv[1:]
FOTOS_DIR = os.path.join(ROOT, args[args.index('--fotos-dir') + 1] if '--fotos-dir' in args else 's3-local')
SEM_FOTOS = '--sem-fotos' in args


def get(url, binario=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        dados = r.read()
    return dados if binario else json.loads(dados)


def slug(s):
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


SIGLAS = {'bmw': 'BMW', 'gwm': 'GWM', 'jac': 'JAC', 'ram': 'RAM', 'kia': 'Kia', 'byd': 'BYD', 'mini': 'MINI'}
def marca(s):
    s = (s or '').strip()
    return SIGLAS.get(s.lower()) or '-'.join(p[:1].upper() + p[1:].lower() for p in s.split('-'))

COMBUSTIVEL = {'flex': 'Flex', 'etanol_gasolina': 'Flex', 'diesel': 'Diesel', 'gasolina': 'Gasolina',
               'eletrico': 'Elétrico', 'etanol': 'Etanol', 'hibrido': 'Híbrido', 'gnv': 'GNV'}
CAMBIO = {'automatico': 'Automático', 'manual': 'Manual', 'cvt': 'Automático (CVT)', 'automatizado': 'Automatizado'}
CARROCERIA = {'suv_crossover': 'SUV', 'hatchback': 'Hatch', 'sedan': 'Sedã', 'pickup': 'Picape', 'picape': 'Picape',
              'motocicleta': 'Moto', 'moto': 'Moto', 'minivan': 'Minivan', 'van': 'Van', 'coupe': 'Cupê', 'conversivel': 'Conversível'}
NI = 'Não informado'


CACHE = os.path.join(ROOT, '.estado', 'fotos-origem')


def baixar(url):
    """Baixa a foto original (com cache local, para reexecuções rápidas). None se falhar."""
    arq = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9._-]', '_', url)[-150:])
    if os.path.exists(arq):
        return arq
    try:
        dados = get(url, binario=True)
        Image.open(io.BytesIO(dados)).verify()
    except Exception as e:
        print(f'  foto descartada: {url} ({e})')
        return None
    with open(arq, 'wb') as fh:
        fh.write(dados)
    return arq


def converter(origem, destino_base):
    """Grava as 3 larguras em webp."""
    im = Image.open(origem).convert('RGB')
    for w in TAMANHOS:
        c = im.copy()
        if c.width > w:
            c = c.resize((w, round(c.height * w / c.width)), Image.LANCZOS)
        c.save(f'{destino_base}-{w}.webp', 'WEBP', quality=78, method=4)


def main():
    lista = get(f'{API}?team_id={TEAM}&limit=100')['vehicles']
    print(f'{len(lista)} veículos na API')
    with ThreadPoolExecutor(8) as ex:
        detalhes = list(ex.map(lambda v: get(f"{API}/{v['id']}?team_id={TEAM}")['vehicle'], lista))

    estoques, lojas, tarefas = {}, {}, []
    for v, d in zip(lista, detalhes):
        t = d.get('team') or v['team']
        loja_id = slug(t['name'])
        if loja_id not in lojas:
            fone = re.sub(r'\D', '', t.get('phone') or t.get('mobile_phone') or '')
            lojas[loja_id] = {'nome': t['name'].title() if t['name'].isupper() else t['name'],
                              'cidade': t['city'].replace('Goiania', 'Goiânia'), 'uf': t['state'],
                              'endereco': f"{t['city'].replace('Goiania', 'Goiânia')} - {t['state']}",
                              **({'whatsapp': '55' + fone} if len(fone) in (10, 11) else {})}
            estoques[loja_id] = []
        cid = v['id'][:8].upper()
        fotos = [p['url'] for p in (v.get('listing_photos') or []) if p.get('url')] or ([v['thumbnail_url']] if v.get('thumbnail_url') else [])
        fotos = fotos[:MAX_FOTOS]
        modelo = (v.get('model') or '').strip()
        partes_versao = [d.get('engine'), CARROCERIA.get(v.get('body_type') or '', None)]
        versao = ' '.join(p for p in partes_versao if p) or modelo
        ano = v.get('year_model') or v.get('year_manufacture')
        desc = (d.get('listing_description') or '').strip() or \
            f"{marca(v['make'])} {modelo} {ano}, {v.get('mileage') or 0:,} km.".replace(',', '.')
        extras = [r for r, k in (('Manual do proprietário', 'has_manual'), ('Chave reserva', 'has_spare_key'), ('Blindado', 'is_armored')) if d.get(k)]
        opcionais = list(dict.fromkeys((d.get('features') or []) + extras))
        estoques[loja_id].append({
            'id': cid, 'marca': marca(v['make']), 'modelo': modelo, 'versao': versao,
            'ano': ano, 'preco': v['price'], 'km': v.get('mileage') or 0,
            'cor': (v.get('color') or NI).strip().capitalize(),
            'cambio': CAMBIO.get(v.get('transmission') or '', NI),
            'combustivel': COMBUSTIVEL.get(v.get('fuel_type') or '', NI),
            'fotos': len(fotos), 'opcionais': opcionais, 'descricao': desc, 'loja': loja_id,
        })
        tarefas.append((estoques[loja_id][-1], fotos))

    for lid, carros in estoques.items():
        print(f'  {lid}: {len(carros)} carros · {lojas[lid]["cidade"]}/{lojas[lid]["uf"]} · whatsapp {lojas[lid].get("whatsapp", "(do site)")}')

    arq_site = os.path.join(SITE, 'site.json')
    site = json.load(open(arq_site))
    site['lojas'] = {l: lojas[l] for l in sorted(lojas, key=lambda l: -len(estoques[l]))}
    with open(arq_site, 'w') as f:
        f.write(json.dumps(site, ensure_ascii=False, indent=2) + '\n')

    if SEM_FOTOS:
        print('fotos não processadas (--sem-fotos): os carros ficam com o número de fotos da API')
    else:
        import shutil
        os.makedirs(CACHE, exist_ok=True)
        urls = [u for _, fotos in tarefas for u in fotos]
        print(f'baixando {len(urls)} fotos ...')
        with ThreadPoolExecutor(8) as ex:
            origem = dict(zip(urls, ex.map(baixar, urls)))
        jobs = []
        for carro, fotos in tarefas:
            boas = [origem[u] for u in fotos if origem[u]]
            carro['fotos'] = len(boas)  # renumera: só as que baixaram
            pasta = os.path.join(FOTOS_DIR, 'carros', carro['id'])
            shutil.rmtree(pasta, ignore_errors=True)
            os.makedirs(pasta, exist_ok=True)
            jobs += [(arq, os.path.join(pasta, str(n))) for n, arq in enumerate(boas, 1)]
        print(f'convertendo {len(jobs)} fotos para {FOTOS_DIR} ...')
        with ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda j: converter(*j), jobs))
        sem = [c['id'] for c, _ in tarefas if not c['fotos']]
        print(f'fotos ok: {len(jobs)}/{len(urls)}' + (f' · sem foto: {", ".join(sem)}' if sem else ''))

    carros = [c for lid in site['lojas'] for c in estoques[lid]]
    with open(os.path.join(SITE, 'estoque.json'), 'w') as f:
        json.dump({'atualizado': max(v.get('published_at') or '' for v in lista), 'carros': carros}, f, ensure_ascii=False, indent=1)
    print(f'sites-config/trokey.com.br/estoque.json: {len(carros)} carros')

if __name__ == '__main__':
    main()
