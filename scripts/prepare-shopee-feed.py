"""Seleciona até 100 produtos do CSV e associa links gerados no painel.
Uso: python scripts/prepare-shopee-feed.py catalogo.csv links.json saida.json
links.json: {"44227632883": "https://s.shopee.com.br/6AlS6msWUl"}
A saída é uma prévia (dryRun=true), sem publicação automática.
"""
import csv
import json
import sys
from pathlib import Path


def prepare(feed, links):
    if not isinstance(links, dict) or not 1 <= len(links) <= 100:
        raise ValueError('Informe de 1 a 100 IDs e links no arquivo links.json.')
    csv.field_size_limit(10_000_000)
    found = {}
    with open(feed, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        required = {'itemid', 'title', 'price', 'sale_price', 'image_link', 'product_link'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('CSV sem as colunas necessárias.')
        for row in reader:
            item_id = row['itemid']
            if item_id in links:
                if item_id in found:
                    raise ValueError(f'Produto duplicado no CSV: {item_id}')
                found[item_id] = {**row, 'affiliateUrl': links[item_id]}
    missing = set(links) - set(found)
    if missing:
        raise ValueError(f'IDs ausentes no CSV: {sorted(missing)}')
    return {'dryRun': True, 'items': [found[item_id] for item_id in links]}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    try:
        links = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8-sig'))
        output = prepare(sys.argv[1], links)
        Path(sys.argv[3]).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"Prévia preparada: {len(output['items'])} produtos. Nenhum envio ao servidor.")
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
