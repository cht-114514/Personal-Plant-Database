#!/usr/bin/env python3
"""
Flora of China (FOC) PDF full-content import script.

Extracts family descriptions, genus descriptions, dichotomous keys,
species details (synonyms, descriptions, habitats, altitudes,
distributions), and infraspecific taxa from FOC PDF files.

Usage:
  python tools/import_foc.py "Eupteleaceae.pdf"                    # import single PDF
  python tools/import_foc.py /path/to/pdfs/                        # import all PDFs in dir
  python tools/import_foc.py --dry-run "Violaceae.pdf"             # parse only, no DB write
  python tools/import_foc.py --dry-run --verbose "Eupteleaceae.pdf"  # dump raw extracted text
  python tools/import_foc.py --update "Violaceae.pdf"              # overwrite existing records
"""

import os
import re
import sys
import json
import sqlite3
import argparse
from pathlib import Path

from pypdf import PdfReader

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / 'data' / 'botanical.db'
TAXONOMY_PATH = ROOT / 'data' / 'taxonomy-lookup.json'

DEFAULT_HIGHER = {
    'kingdom': '\u690d\u7269\u754c Plantae',
    'phylum':  '\u88ab\u5b50\u690d\u7269\u95e8 Angiospermae',
    'class':   '\u6728\u5170\u7eb2 Magnoliopsida',
}

# ---------------------------------------------------------------------------
# FAMILY_ORDER  --  maps Latin family name -> Chinese+Latin order string
# Covers all 312 families present in /Users/chen/Documents/foc\u6587\u732e/
# Families not listed here will trigger a warning but still be processed
# with order = 'Unknown'.
# ---------------------------------------------------------------------------
FAMILY_ORDER = {
    # A
    'Acanthaceae':        '\u5507\u5f62\u76ee Lamiales',
    'Aceraceae':          '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Acoraceae':          '\u83d6\u84b2\u76ee Acorales',
    'Actinidiaceae':      '\u6749\u6843\u8349\u76ee Ericales',
    'Adoxaceae':          '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Aizoaceae':          '\u77f3\u7af9\u76ee Caryophyllales',
    'Alangiaceae':        '\u5c71\u8331\u8438\u76ee Cornales',
    'Alismataceae':       '\u6cfd\u6cfb\u76ee Alismatales',
    'Amaranthaceae':      '\u77f3\u7af9\u76ee Caryophyllales',
    'Amaryllidaceae':     '\u5929\u95e8\u51ac\u76ee Asparagales',
    'Anacardiaceae':      '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Ancistrocladaceae':  '\u77f3\u7af9\u76ee Caryophyllales',
    'Annonaceae':         '\u6728\u5170\u76ee Magnoliales',
    'Apiaceae':           '\u4f1e\u5f62\u76ee Apiales',
    'Apocynaceae':        '\u9f99\u80c6\u76ee Gentianales',
    'Aponogetonaceae':    '\u6cfd\u6cfb\u76ee Alismatales',
    'Aquifoliaceae':      '\u51ac\u9752\u76ee Aquifoliales',
    'Araceae':            '\u6cfd\u6cfb\u76ee Alismatales',
    'Araliaceae':         '\u4f1e\u5f62\u76ee Apiales',
    'Araucariaceae':      '\u677e\u76ee Pinales',
    'Arecaceae':          '\u68d5\u6988\u76ee Arecales',
    'Aristolochiaceae':   '\u80e1\u6912\u76ee Piperales',
    'Asclepiadaceae':     '\u9f99\u80c6\u76ee Gentianales',
    'Aspleniaceae':       '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Asteraceae':         '\u83ca\u76ee Asterales',
    'Athyriaceae':        '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Aucubaceae':         '\u5c71\u8331\u8438\u76ee Cornales',
    # B
    'Balanophoraceae':    '\u6a80\u9999\u76ee Santalales',
    'Balsaminaceae':      '\u6749\u6843\u8349\u76ee Ericales',
    'Basellaceae':        '\u77f3\u7af9\u76ee Caryophyllales',
    'Begoniaceae':        '\u846b\u82a6\u76ee Cucurbitales',
    'Berberidaceae':      '\u6bdb\u830e\u76ee Ranunculales',
    'Betulaceae':         '\u58f3\u6597\u76ee Fagales',
    'Biebersteiniaceae':  '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Bignoniaceae':       '\u5507\u5f62\u76ee Lamiales',
    'Bixaceae':           '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Blechnaceae':        '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Bombacaceae':        '\u9526\u8475\u76ee Malvales',
    'Boraginaceae':       '\u7d2b\u8349\u76ee Boraginales',
    'Brassicaceae':       '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Bretschneideraceae': '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Bromeliaceae':       '\u79be\u672c\u76ee Poales',
    'Burmanniaceae':      '\u767e\u5408\u76ee Liliales',
    'Burseraceae':        '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Butomaceae':         '\u6cfd\u6cfb\u76ee Alismatales',
    'Buxaceae':           '\u9ec4\u6768\u76ee Buxales',
    # C
    'Cabombaceae':        '\u7766\u83b2\u76ee Nymphaeales',
    'Cactaceae':          '\u77f3\u7af9\u76ee Caryophyllales',
    'Callitrichaceae':    '\u5507\u5f62\u76ee Lamiales',
    'Calycanthaceae':     '\u6a1f\u76ee Laurales',
    'Campanulaceae':      '\u83ca\u76ee Asterales',
    'Cannabaceae':        '\u8534\u8587\u76ee Rosales',
    'Cannaceae':          '\u59dc\u76ee Zingiberales',
    'Capparaceae':        '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Caprifoliaceae':     '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Cardiopteridaceae':  '\u51ac\u9752\u76ee Aquifoliales',
    'Caricaceae':         '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Carlemanniaceae':    '\u5507\u5f62\u76ee Lamiales',
    'Caryophyllaceae':    '\u77f3\u7af9\u76ee Caryophyllales',
    'Casuarinaceae':      '\u58f3\u6597\u76ee Fagales',
    'Celastraceae':       '\u536b\u77db\u76ee Celastrales',
    'Centrolepidaceae':   '\u79be\u672c\u76ee Poales',
    'Cephalotaxaceae':    '\u677e\u76ee Pinales',
    'Ceratophyllaceae':   '\u91d1\u9c7c\u85fb\u76ee Ceratophyllales',
    'Cercidiphyllaceae':  '\u864e\u8033\u8349\u76ee Saxifragales',
    'Chenopodiaceae':     '\u77f3\u7af9\u76ee Caryophyllales',
    'Chloranthaceae':     '\u91d1\u7c9f\u5170\u76ee Chloranthales',
    'Cibotiaceae':        '\u684e\u5c9c\u5c9b\u76ee Cyatheales',
    'Circaeasteraceae':   '\u6bdb\u830e\u76ee Ranunculales',
    'Cistaceae':          '\u9526\u8475\u76ee Malvales',
    'Cleomaceae':         '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Clethraceae':        '\u6749\u6843\u8349\u76ee Ericales',
    'Clusiaceae':         '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Cneoraceae':         '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Combretaceae':       '\u6843\u91d1\u5a18\u76ee Myrtales',
    'Commelinaceae':      '\u9e28\u8dbe\u82b1\u76ee Commelinales',
    'Connaraceae':        '\u724d\u725b\u82b1\u76ee Oxalidales',
    'Convolvulaceae':     '\u8304\u76ee Solanales',
    'Coriariaceae':       '\u864e\u8033\u8349\u76ee Saxifragales',
    'Cornaceae':          '\u5c71\u8331\u8438\u76ee Cornales',
    'Corsiaceae':         '\u767e\u5408\u76ee Liliales',
    'Costaceae':          '\u59dc\u76ee Zingiberales',
    'Crassulaceae':       '\u864e\u8033\u8349\u76ee Saxifragales',
    'Crypteroniaceae':    '\u6843\u91d1\u5a18\u76ee Myrtales',
    'Cucurbitaceae':      '\u846b\u82a6\u76ee Cucurbitales',
    'Cupressaceae':       '\u677e\u76ee Pinales',
    'Cyatheaceae':        '\u684e\u5c9a\u5c9b\u76ee Cyatheales',
    'Cycadaceae':         '\u82cf\u94c1\u76ee Cycadales',
    'Cymodoceaceae':      '\u6cfd\u6cfb\u76ee Alismatales',
    'Cynomoriaceae':      '\u77f3\u7af9\u76ee Caryophyllales',
    'Cyperaceae':         '\u79be\u672c\u76ee Poales',
    'Cystopteridaceae':   '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    # D
    'Daphniphyllaceae':   '\u864e\u8033\u8349\u76ee Saxifragales',
    'Davalliaceae':       '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Dennstaedtiaceae':   '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Diapensiaceae':      '\u6749\u6843\u8349\u76ee Ericales',
    'Dichapetalaceae':    '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Diervillaceae':      '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Dilleniaceae':       '\u4e94\u6842\u76ee Dilleniales',
    'Dioscoreaceae':      '\u767e\u5408\u76ee Liliales',
    'Dipentodontaceae':   '\u5357\u9f20\u5230\u76ee Huerteales',
    'Diplaziopsidaceae':  '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Dipsacaceae':        '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Dipteridaceae':      '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Dipterocarpaceae':   '\u9526\u8475\u76ee Malvales',
    'Droseraceae':        '\u77f3\u7af9\u76ee Caryophyllales',
    'Dryopteridaceae':    '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    # E
    'Ebenaceae':          '\u6749\u6843\u8349\u76ee Ericales',
    'Elaeagnaceae':       '\u8534\u8587\u76ee Rosales',
    'Elaeocarpaceae':     '\u724d\u725b\u82b1\u76ee Oxalidales',
    'Elatinaceae':        '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Ephedraceae':        '\u9ebb\u9ec4\u76ee Ephedrales',
    'Equisetaceae':       '\u6728\u8d3c\u76ee Equisetales',
    'Ericaceae':          '\u6749\u6843\u8349\u76ee Ericales',
    'Eriocaulaceae':      '\u79be\u672c\u76ee Poales',
    'Erythroxylaceae':    '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Eucommiaceae':       '\u5c71\u8331\u8438\u76ee Cornales',
    'Euphorbiaceae':      '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Eupteleaceae':       '\u6bdb\u830e\u76ee Ranunculales',
    # F
    'Fabaceae':           '\u8c46\u76ee Fabales',
    'Fagaceae':           '\u58f3\u6597\u76ee Fagales',
    'Flacourtiaceae':     '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Flagellariaceae':    '\u79be\u672c\u76ee Poales',
    'Frankeniaceae':      '\u77f3\u7af9\u76ee Caryophyllales',
    # G
    'Gentianaceae':       '\u9f99\u80c6\u76ee Gentianales',
    'Geraniaceae':        '\u725b\u513b\u513f\u82d7\u76ee Geraniales',
    'Gesneriaceae':       '\u5507\u5f62\u76ee Lamiales',
    'Ginkgoaceae':        '\u94f6\u674f\u76ee Ginkgoales',
    'Gleicheniaceae':     '\u91cc\u767d\u76ee Gleicheniales',
    'Gnetaceae':          '\u4e70\u9ebb\u85e4\u76ee Gnetales',
    'Goodeniaceae':       '\u83ca\u76ee Asterales',
    # H
    'Haloragaceae':       '\u864e\u8033\u8349\u76ee Saxifragales',
    'Hamamelidaceae':     '\u864e\u8033\u8349\u76ee Saxifragales',
    'Helwingiaceae':      '\u51ac\u9752\u76ee Aquifoliales',
    'Hernandiaceae':      '\u6a1f\u76ee Laurales',
    'Hippocastanaceae':   '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Hippuridaceae':      '\u5507\u5f62\u76ee Lamiales',
    'Hydrocharitaceae':   '\u6cfd\u6cfb\u76ee Alismatales',
    'Hydrophyllaceae':    '\u7d2b\u8349\u76ee Boraginales',
    'Hymenophyllaceae':   '\u819c\u8568\u76ee Hymenophyllales',
    'Hypodematiaceae':    '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    # I
    'Icacinaceae':        '\u51ac\u9752\u76ee Aquifoliales',
    'Illiciaceae':        '\u516b\u89d2\u76ee Austrobaileyales',
    'Iridaceae':          '\u5929\u95e8\u51ac\u76ee Asparagales',
    'Isoetaceae':         '\u6c34\u97ed\u76ee Isoetales',
    # J
    'Juglandaceae':       '\u58f3\u6597\u76ee Fagales',
    'Juncaceae':          '\u79be\u672c\u76ee Poales',
    'Juncaginaceae':      '\u6cfd\u6cfb\u76ee Alismatales',
    # L
    'Lamiaceae':          '\u5507\u5f62\u76ee Lamiales',
    'Lardizabalaceae':    '\u6bdb\u830e\u76ee Ranunculales',
    'Lauraceae':          '\u6a1f\u76ee Laurales',
    'Lecythidaceae':      '\u6749\u6843\u8349\u76ee Ericales',
    'Leeaceae':           '\u8461\u8404\u76ee Vitales',
    'Lemnaceae':          '\u6cfd\u6cfb\u76ee Alismatales',
    'Lentibulariaceae':   '\u5507\u5f62\u76ee Lamiales',
    'Liliaceae':          '\u767e\u5408\u76ee Liliales',
    'Linaceae':           '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Lindsaeaceae':       '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Linnaeaceae':        '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Loganiaceae':        '\u9f99\u80c6\u76ee Gentianales',
    'Lomariopsidaceae':   '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Loranthaceae':       '\u6a80\u9999\u76ee Santalales',
    'Lowiaceae':          '\u59dc\u76ee Zingiberales',
    'Lycopodiaceae':      '\u77f3\u677e\u76ee Lycopodiales',
    'Lygodiaceae':        '\u7f57\u84d1\u76ee Schizaeales',
    'Lythraceae':         '\u6843\u91d1\u5a18\u76ee Myrtales',
    # M
    'Magnoliaceae':       '\u6728\u5170\u76ee Magnoliales',
    'Malpighiaceae':      '\u91d1\u864e\u5c3e\u76ee Malpighiales',
    'Malvaceae':          '\u9526\u8475\u76ee Malvales',
    'Marantaceae':        '\u59dc\u76ee Zingiberales',
    'Marattiaceae':       '\u5408\u56ca\u8568\u76ee Marattiales',
    'Marsileaceae':       '\u82f9\u76ee Salviniales',
    'Martyniaceae':       '\u5507\u5f62\u76ee Lamiales',
    'Mastixiaceae':       '\u5c71\u8331\u8438\u76ee Cornales',
    'Melastomataceae':    '\u6843\u91d1\u5a18\u76ee Myrtales',
    'Meliaceae':          '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Menispermaceae':     '\u6bdb\u830e\u76ee Ranunculales',
    'Menyanthaceae':      '\u83ca\u76ee Asterales',
    'Molluginaceae':      '\u77f3\u7af9\u76ee Caryophyllales',
    'Moraceae':           '\u8534\u8587\u76ee Rosales',
    'Morinaceae':         '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Moringaceae':        '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Musaceae':           '\u59dc\u76ee Zingiberales',
    'Myoporaceae':        '\u5507\u5f62\u76ee Lamiales',
    'Myricaceae':         '\u58f3\u6597\u76ee Fagales',
    'Myristicaceae':      '\u6728\u5170\u76ee Magnoliales',
    'Myrsinaceae':        '\u6749\u6843\u8349\u76ee Ericales',
    'Myrtaceae':          '\u6843\u91d1\u5a18\u76ee Myrtales',
    # N
    'Nelumbonaceae':      '\u5c71\u9f99\u773c\u76ee Proteales',
    'Nepenthaceae':       '\u77f3\u7af9\u76ee Caryophyllales',
    'Nephrolepidaceae':   '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Nitrariaceae':       '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Nyctaginaceae':      '\u77f3\u7af9\u76ee Caryophyllales',
    'Nymphaeaceae':       '\u7766\u83b2\u76ee Nymphaeales',
    'Nyssaceae':          '\u5c71\u8331\u8438\u76ee Cornales',
    # O
    'Ochnaceae':          '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Olacaceae':          '\u6a80\u9999\u76ee Santalales',
    'Oleaceae':           '\u5507\u5f62\u76ee Lamiales',
    'Oleandraceae':       '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Onagraceae':         '\u6843\u91d1\u5a18\u76ee Myrtales',
    'Onocleaceae':        '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Ophioglossaceae':    '\u74f6\u5c14\u5c0f\u8349\u76ee Ophioglossales',
    'Opiliaceae':         '\u6a80\u9999\u76ee Santalales',
    'Orchidaceae':        '\u5929\u95e8\u51ac\u76ee Asparagales',
    'Orobanchaceae':      '\u5507\u5f62\u76ee Lamiales',
    'Osmundaceae':        '\u7d2b\u8403\u76ee Osmundales',
    'Oxalidaceae':        '\u724d\u725b\u82b1\u76ee Oxalidales',
    # P
    'Paeoniaceae':        '\u864e\u8033\u8349\u76ee Saxifragales',
    'Pandaceae':          '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Pandanaceae':        '\u9732\u5146\u6811\u76ee Pandanales',
    'Papaveraceae':       '\u6bdb\u830e\u76ee Ranunculales',
    'Passifloraceae':     '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Pedaliaceae':        '\u5507\u5f62\u76ee Lamiales',
    'Peganaceae':         '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Pentaphragmataceae': '\u83ca\u76ee Asterales',
    'Pentaphylacaceae':   '\u6749\u6843\u8349\u76ee Ericales',
    'Philydraceae':       '\u9e28\u8dbe\u82b1\u76ee Commelinales',
    'Phrymaceae':         '\u5507\u5f62\u76ee Lamiales',
    'Phytolaccaceae':     '\u77f3\u7af9\u76ee Caryophyllales',
    'Pinaceae':           '\u677e\u76ee Pinales',
    'Piperaceae':         '\u80e1\u6912\u76ee Piperales',
    'Pittosporaceae':     '\u4f1e\u5f62\u76ee Apiales',
    'Plagiogyriaceae':    '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Plagiopteraceae':    '\u9526\u8475\u76ee Malvales',
    'Plantaginaceae':     '\u5507\u5f62\u76ee Lamiales',
    'Platanaceae':        '\u5c71\u9f99\u773c\u76ee Proteales',
    'Plumbaginaceae':     '\u77f3\u7af9\u76ee Caryophyllales',
    'Poaceae':            '\u79be\u672c\u76ee Poales',
    'Podocarpaceae':      '\u677e\u76ee Pinales',
    'Podostemaceae':      '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Polemoniaceae':      '\u6749\u6843\u8349\u76ee Ericales',
    'Polygalaceae':       '\u8c46\u76ee Fabales',
    'Polygonaceae':       '\u77f3\u7af9\u76ee Caryophyllales',
    'Polypodiaceae':      '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Pontederiaceae':     '\u9e28\u8dbe\u82b1\u76ee Commelinales',
    'Portulacaceae':      '\u77f3\u7af9\u76ee Caryophyllales',
    'Posidoniaceae':      '\u6cfd\u6cfb\u76ee Alismatales',
    'Potamogetonaceae':   '\u6cfd\u6cfb\u76ee Alismatales',
    'Primulaceae':        '\u6749\u6843\u8349\u76ee Ericales',
    'Proteaceae':         '\u5c71\u9f99\u773c\u76ee Proteales',
    'Psilotaceae':        '\u677e\u53f6\u8568\u76ee Psilotales',
    'Pteridaceae':        '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    # R
    'Rafflesiaceae':      '\u6a80\u9999\u76ee Santalales',
    'Ranunculaceae':      '\u6bdb\u830e\u76ee Ranunculales',
    'Resedaceae':         '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Restionaceae':       '\u79be\u672c\u76ee Poales',
    'Rhachidosoraceae':   '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Rhamnaceae':         '\u8534\u8587\u76ee Rosales',
    'Rhizophoraceae':     '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Rhoipteleaceae':     '\u58f3\u6597\u76ee Fagales',
    'Rosaceae':           '\u8534\u8587\u76ee Rosales',
    'Rubiaceae':          '\u9f99\u80c6\u76ee Gentianales',
    'Ruppiaceae':         '\u6cfd\u6cfb\u76ee Alismatales',
    'Rutaceae':           '\u65e0\u60a3\u5b50\u76ee Sapindales',
    # S
    'Sabiaceae':          '\u5c71\u9f99\u773c\u76ee Proteales',
    'Salicaceae':         '\u91d1\u4e1d\u6843\u76ee Malpighiales',
    'Salvadoraceae':      '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Salviniaceae':       '\u82f9\u76ee Salviniales',
    'Santalaceae':        '\u6a80\u9999\u76ee Santalales',
    'Sapindaceae':        '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Sapotaceae':         '\u6749\u6843\u8349\u76ee Ericales',
    'Saururaceae':        '\u80e1\u6912\u76ee Piperales',
    'Saxifragaceae':      '\u864e\u8033\u8349\u76ee Saxifragales',
    'Scheuchzeriaceae':   '\u6cfd\u6cfb\u76ee Alismatales',
    'Schisandraceae':     '\u516b\u89d2\u76ee Austrobaileyales',
    'Schizaeaceae':       '\u7f57\u84d1\u76ee Schizaeales',
    'Sciadopityaceae':    '\u677e\u76ee Pinales',
    'Scrophulariaceae':   '\u5507\u5f62\u76ee Lamiales',
    'Selaginellaceae':    '\u5377\u67cf\u76ee Selaginellales',
    'Simaroubaceae':      '\u65e0\u60a3\u5b50\u76ee Sapindales',
    'Sladeniaceae':       '\u6749\u6843\u8349\u76ee Ericales',
    'Solanaceae':         '\u8304\u76ee Solanales',
    'Sphenocleaceae':     '\u8304\u76ee Solanales',
    'Stachyuraceae':      '\u864e\u8033\u8349\u76ee Saxifragales',
    'Staphyleaceae':      '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Stemonaceae':        '\u9732\u5146\u6811\u76ee Pandanales',
    'Sterculiaceae':      '\u9526\u8475\u76ee Malvales',
    'Stylidiaceae':       '\u83ca\u76ee Asterales',
    'Styracaceae':        '\u6749\u6843\u8349\u76ee Ericales',
    'Surianaceae':        '\u8c46\u76ee Fabales',
    'Symplocaceae':       '\u6749\u6843\u8349\u76ee Ericales',
    # T
    'Taccaceae':          '\u8585\u82a8\u76ee Dioscoreales',
    'Tamaricaceae':       '\u77f3\u7af9\u76ee Caryophyllales',
    'Tapisciaceae':       '\u5357\u9f20\u5230\u76ee Huerteales',
    'Taxaceae':           '\u677e\u76ee Pinales',
    'Taxodiaceae':        '\u677e\u76ee Pinales',
    'Tectariaceae':       '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Tetracentraceae':    '\u9ec4\u6768\u76ee Buxales',
    'Tetramelaceae':      '\u846b\u82a6\u76ee Cucurbitales',
    'Theaceae':           '\u6749\u6843\u8349\u76ee Ericales',
    'Thelypteridaceae':   '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    'Thymelaeaceae':      '\u9526\u8475\u76ee Malvales',
    'Tiliaceae':          '\u9526\u8475\u76ee Malvales',
    'Toricelliaceae':     '\u4f1e\u5f62\u76ee Apiales',
    'Trapaceae':          '\u6843\u91d1\u5a18\u76ee Myrtales',
    'Triuridaceae':       '\u9732\u5146\u6811\u76ee Pandanales',
    'Trochodendraceae':   '\u6614\u7f8e\u82b1\u76ee Trochodendrales',
    'Tropaeolaceae':      '\u5341\u5b57\u82b1\u76ee Brassicales',
    'Typhaceae':          '\u79be\u672c\u76ee Poales',
    # U
    'Ulmaceae':           '\u8534\u8587\u76ee Rosales',
    'Urticaceae':         '\u8534\u8587\u76ee Rosales',
    # V
    'Valerianaceae':      '\u5ddd\u7eed\u65ad\u76ee Dipsacales',
    'Verbenaceae':        '\u5507\u5f62\u76ee Lamiales',
    'Violaceae':          '\u91d1\u864e\u5c3e\u76ee Malpighiales',
    'Viscaceae':          '\u6a80\u9999\u76ee Santalales',
    'Vitaceae':           '\u8461\u8404\u76ee Vitales',
    # W
    'Woodsiaceae':        '\u6c34\u9f99\u9aa8\u76ee Polypodiales',
    # X
    'Xyridaceae':         '\u79be\u672c\u76ee Poales',
    # Z
    'Zannichelliaceae':   '\u6cfd\u6cfb\u76ee Alismatales',
    'Zingiberaceae':      '\u59dc\u76ee Zingiberales',
    'Zosteraceae':        '\u6cfd\u6cfb\u76ee Alismatales',
    'Zygophyllaceae':     '\u65e0\u60a3\u5b50\u76ee Sapindales',
}


# ===================================================================
# PDF text extraction
# ===================================================================

def parse_family_from_filename(pdf_path):
    """Parse family names from filename: 'Violaceae xxx.pdf' -> ('Violaceae', 'xxx')"""
    stem = Path(pdf_path).stem
    m = re.match(r'([A-Za-z]+)\s+([\u4e00-\u9fff\u3400-\u4dbf]+)', stem)
    if m:
        return m.group(1), m.group(2)
    m2 = re.match(r'([A-Za-z]+)', stem)
    if m2:
        return m2.group(1), None
    return None, None


def extract_text(pdf_path):
    """Extract full text from PDF, joining all pages."""
    reader = PdfReader(pdf_path)
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return '\n'.join(pages)


def clean_text(text):
    """Clean up common PDF extraction artefacts."""
    # Remove page headers like "VIOLACEAE" repeated at page tops with page numbers
    text = re.sub(r'\n[A-Z]+ACEAE\s*\n\s*\d+\s*\n', '\n', text)
    # Remove standalone page numbers
    text = re.sub(r'\n\s*\d{1,3}\s*\n', '\n', text)
    # Normalise whitespace (but keep newlines)
    text = re.sub(r'[ \t]+', ' ', text)
    # Remove footnote markers (superscript numbers in text)
    text = re.sub(r'\n\s*\d+\s+(?:Herbarium|Institut|University|Missouri|Extensive)\b.*$',
                  '', text, flags=re.MULTILINE)
    return text.strip()


# ===================================================================
# Parsing helpers
# ===================================================================

def _find_chinese_name(text):
    """Extract Chinese name + pinyin from a line like: '\u9886\u6625\u6728\u5c5e  ling chun mu shu'"""
    m = re.search(r'([\u4e00-\u9fff\u3400-\u4dbf]{2,10})\s+([a-z][a-z ]+[a-z])', text)
    if m:
        return m.group(1), m.group(2).strip()
    # Chinese name without pinyin
    m2 = re.search(r'([\u4e00-\u9fff\u3400-\u4dbf]{2,10})', text)
    if m2:
        return m2.group(1), None
    return None, None


def _extract_synonyms(text_block):
    """
    Extract synonym names from a text block appearing after the species
    header and Chinese name, before the morphological description.
    Synonyms are indented lines with italic-style names: Genus epithet Author.
    """
    synonyms = []
    lines = text_block.strip().split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # A synonym line typically starts with a genus name and contains
        # an author reference. It may start with indentation.
        # Pattern: Genus epithet Author; or Genus epithet (Author) Author
        # Must contain at least one semicolon-separated name, or end with a period
        syn_pat = re.compile(
            r'^([A-Z][a-z]+\s+(?:(?:var|subsp|f|ssp)\.\s+)?[a-z][a-z-]+(?:\s+[A-Z].*?)?)(?:;\s*|$)'
        )
        # Check if the whole line looks like synonyms (one or more separated by ;)
        # Synonyms end with a period on the last line
        if re.match(r'^[A-Z][a-z]+\s+[a-z]', line):
            # Could be synonyms or start of description
            # Description lines are longer prose; synonym lines have author citations
            # Heuristic: if it contains semicolons or has pattern of Genus epithet Author
            if ';' in line or re.search(r'[A-Z]\.\s+[A-Z]', line):
                # Split by semicolons
                parts = re.split(r';\s*', line.rstrip('.'))
                for p in parts:
                    p = p.strip()
                    if p and re.match(r'^[A-Z][a-z]+\s+', p):
                        synonyms.append(p)
    return synonyms


def _extract_flowering_fruiting(text):
    """Extract flowering and fruiting info like 'Fl. Apr-May, fr. Jul-Aug.'"""
    # Month names used in FOC
    _months = (r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
               r'|spring|summer|autumn|winter|unknown)')
    # Full pattern: Fl. Month[-Month][, fr. Month[-Month]].
    pat = re.compile(
        r'Fl\.\s+' + _months + r'[\s\S]*?'
        r'(?:fr\.\s+' + _months + r'[^.]*\.)'
        r'|'
        r'Fl\.\s+' + _months + r'[^.]*\.',
        re.IGNORECASE
    )
    m = pat.search(text)
    if m:
        result = re.sub(r'\s+', ' ', m.group(0)).strip()
        return result
    return None


def _extract_chromosome(text):
    """Extract chromosome number like '2n = 28'."""
    m = re.search(r'2n\s*=\s*\d+\*?', text)
    if m:
        return m.group(0).strip()
    return None


def _extract_altitude(text):
    """Extract altitude range like '900-3600 m' or 'below 600 m' or 'ca. 1300 m'.
    Only matches altitude in habitat/distribution context (after semicolons or on
    dedicated distribution lines), not "2 m tall" in descriptions."""
    # Look specifically in habitat/distribution lines
    # These have patterns like: "Forests; 900-3600 m." or "below 600 m."
    # preceded by semicolons or at line starts after habitat descriptions
    patterns = [
        # Range with semicolon context: "; 900-3600 m"
        r';\s*(\d[\d,]*(?:\s*[-\u2013]\s*\d[\d,]*)?(?:\([-\u2013]?\d[\d,]*\))?\s*m)\b',
        # "below/above/ca." prefixed
        r'((?:below|above|ca\.)\s+\d[\d,]*\s*m)\b',
        # Range at line start or after bullet
        r'(?:^|\u25cf\s*.*?)\s+(\d{3}[\d,]*(?:\s*[-\u2013]\s*\d[\d,]*)?(?:\([-\u2013]?\d[\d,]*\))?\s*m)\b',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.MULTILINE)
        if m:
            return m.group(1).strip()
    return None


_PROVINCES = (
    r'Anhui|Beijing|Chongqing|Fujian|Gansu|Guangdong|Guangxi|Guizhou|Hainan|Hebei|'
    r'Heilongjiang|Henan|Hubei|Hunan|Jiangsu|Jiangxi|Jilin|Liaoning|Nei Mongol|'
    r'Ningxia|Qinghai|Shaanxi|Shandong|Shanghai|Shanxi|Sichuan|Taiwan|Tianjin|'
    r'Xinjiang|Xizang|Yunnan|Zhejiang|Hong Kong|Macao'
)

_HABITAT_LEAD = (
    r'Forests?|Thickets?|Grasslands?|Meadows?|Open|Shaded|Mountain|Alpine|Moist|'
    r'Rocky|Sandy|Lowland|Valleys?|Streamsides?|Dense|Evergreen|Variable|'
    r'Understories|Broad-leaved|Mixed|Rock|Limestone|Along|Slopes?|Wet|Sparse|'
    r'Disturbed|Damp|Humus|Humus-rich|Scrubby'
)


def _dehyphenate(s):
    """Fix PDF line-break hyphenation like 'Tai- wan' -> 'Taiwan'."""
    return re.sub(r'(\w)-\s+(\w)', r'\1\2', s)


def _trim_trailing_cruft(s):
    """Cut taxonomic commentary or next-entry headings that leak past the
    distribution info: e.g. '. 11. KUHLHASSELTIA', '. This species...'."""
    for pat in (
        r'\.\s+(?=\d+\.)',              # ". 11. ..." (next numbered entry)
        r'\.\s+(?=This\s|The\s|It\s)',  # ". This species..."
        r'\.\s+(?=[A-Z]{3,}\s)',         # ". KUHLHASSELTIA J. J. Smith"
    ):
        s = re.split(pat, s, maxsplit=1)[0]
    return s.strip()


def _extract_distribution(text):
    """
    Extract geographic distribution only (provinces/counties/countries).
    Strips any habitat terms and altitude that precede the location in
    FOC-style lines like: "● Forests; 100-400 m. Yunnan (Baoting)."
    """
    # Pattern 1: bullet line where geographic info follows "X m."
    # "● Forests; 100-400 m. Yunnan (Baoting)." -> "Yunnan (Baoting)"
    m = re.search(
        r'\u25cf\s*.*?\d+(?:[,\d]*\s*[-\u2013]\s*[\d,]+)?\s*m\.\s*(.+?)'
        r'(?:\n\n|\n[A-Z][a-z]{2,}|\Z)',
        text, re.DOTALL,
    )
    if m:
        result = re.sub(r'\s+', ' ', m.group(1)).strip()
        result = _dehyphenate(result).rstrip('.').strip()
        result = _trim_trailing_cruft(result)
        if result:
            return result

    # Pattern 2: bullet line starting directly with a geographic token
    # "● S Xizang [Bhutan, India]." (no habitat/altitude prefix)
    m = re.search(
        rf'\u25cf\s*((?:(?:S|N|E|W|SE|NE|SW|NW|C)\s+)?(?:{_PROVINCES}).+?)'
        r'(?:\n\n|\Z)',
        text, re.DOTALL,
    )
    if m:
        result = re.sub(r'\s+', ' ', m.group(1)).strip()
        result = _dehyphenate(result).rstrip('.').strip()
        result = _trim_trailing_cruft(result)
        if result:
            return result

    # Pattern 3: non-bullet line starting with a geographic token
    # "W Yunnan (Gaoligong Shan) [Myanmar]."
    m = re.search(
        rf'^\s*((?:(?:S|N|E|W|SE|NE|SW|NW|C)\s+)?(?:{_PROVINCES})[^.\n]*\.)',
        text, re.MULTILINE,
    )
    if m:
        result = re.sub(r'\s+', ' ', m.group(1)).strip()
        result = _dehyphenate(result)
        return result.rstrip('.').strip()

    # Pattern 4: non-bullet line with altitude prefix (habitat; altitude. geography.)
    # "Forests; 100-400 m. Yunnan." (no bullet)
    m = re.search(
        rf'(?:{_HABITAT_LEAD}).*?\d+(?:[,\d]*\s*[-\u2013]\s*[\d,]+)?\s*m\.\s*'
        rf'((?:(?:S|N|E|W|SE|NE|SW|NW|C)\s+)?(?:{_PROVINCES})[^.\n]*)\.',
        text, re.DOTALL,
    )
    if m:
        result = re.sub(r'\s+', ' ', m.group(1)).strip()
        return _dehyphenate(result)

    return None


def _extract_habitat(text):
    """Extract habitat description from distribution/habitat line."""
    # Habitat typically appears before the altitude, e.g.:
    # "Forests in valleys; 900-3600 m."
    # or: "Thickets, dense forests; below 600 m."
    m = re.search(
        r'(\u25cf\s*)?'
        r'((?:Forests?|Thickets?|Grasslands?|Open|Shaded|Mountain|Alpine|Moist|Rocky|Sandy|'
        r'Lowland|Valleys?|Streamsides?|Dense|Evergreen|Variable|Understories|Broad-leaved|'
        r'Mixed|Rock|Limestone|Along|Slopes?|Meadows?|Wet|Sparse|Disturbed)[^;.]*?)'
        r'(?:;\s*|\.\s*)',
        text
    )
    if m:
        return m.group(2).strip()
    return None


# ===================================================================
# Core parsing functions
# ===================================================================

def parse_family_description(text, family_latin):
    """
    Extract family description text between the family header (ALL CAPS + ACEAE)
    and the first key or genus entry.
    """
    # Find family header: ALL CAPS FAMILYNAME
    fam_upper = family_latin.upper()
    fam_pat = re.compile(
        re.escape(fam_upper) + r'\s*\n'
        r'([\s\S]*?)'
        r'(?='
        r'\d+[a-z]?\.\s+[A-Z]'  # key couplet or genus entry
        r'|Key\s+to\s+'          # "Key to genera" header
        r'|Key\s+\d+'            # "Key 1" style (Begoniaceae)
        r')',
        re.IGNORECASE
    )
    m = fam_pat.search(text)
    if m:
        desc = m.group(1).strip()
        # Remove Chinese name + pinyin line if it starts the block
        # Remove author line
        lines = desc.split('\n')
        clean_lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            clean_lines.append(line)
        return '\n'.join(clean_lines)
    return None


def parse_dichotomous_key(text_block):
    """
    Parse dichotomous key couplets from a text block.
    Returns both structured JSON and raw text.

    Input format:
      1a. Character state .................. Genus1
      1b. Alternative character ............ 2
      2a. More characters .................. Genus2
      2b. Different characters ............. Genus3

    Returns:
      (key_data: list[dict], key_text: str)
    """
    if not text_block:
        return [], ''

    key_text = text_block.strip()
    couplets = {}

    # Match key entries: number + letter + period + text + optional result
    # The result is either a genus/species name or a number (goto)
    # Patterns like:  "1a. text .... Genus"  or "1a. text .... 2"
    entry_pat = re.compile(
        r'^(\d+)([a-z])\.\s+'  # number + letter
        r'(.*?)$',             # text content
        re.MULTILINE
    )

    entries = []
    matches = list(entry_pat.finditer(text_block))

    for idx, m in enumerate(matches):
        num = int(m.group(1))
        label = m.group(2)
        # Collect all text until the next entry
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text_block)
        full_text = m.group(3) + ' ' + text_block[start:end]
        full_text = re.sub(r'\s+', ' ', full_text).strip()

        # Extract result: look for trailing genus/species or number reference
        # Dots/periods before the result name
        result_match = re.search(
            r'[.\u2026]+\s*(\d+)\s*$'   # goto number
            r'|[.\u2026]+\s*'
            r'(\d+\.\s+)?'              # optional species number prefix
            r'([A-Z][a-z]+(?:\s+[a-z]+)?)\s*$',  # genus or species name
            full_text
        )

        goto = None
        result = None
        lead_text = full_text

        if result_match:
            if result_match.group(1):
                goto = int(result_match.group(1))
            elif result_match.group(3):
                result = result_match.group(3).strip()
            lead_text = full_text[:result_match.start()].strip()
            # Clean trailing dots
            lead_text = re.sub(r'[.\u2026\s]+$', '', lead_text)

        lead = {'label': label, 'text': lead_text}
        if goto is not None:
            lead['goto'] = goto
        if result is not None:
            lead['result'] = result

        entries.append((num, lead))

    # Group by couplet number
    for num, lead in entries:
        if num not in couplets:
            couplets[num] = {'number': num, 'leads': []}
        couplets[num]['leads'].append(lead)

    key_data = sorted(couplets.values(), key=lambda c: c['number'])
    return key_data, key_text


def _find_key_blocks(text):
    """
    Find all key blocks in text. Returns list of (key_name, text_block).
    Handles both "Key to genera" and numbered "Key N" formats.
    """
    blocks = []

    # Pattern for named keys like "Key to genera" or "Keys to species"
    named_key_pat = re.compile(
        r'(Key\s+to\s+[a-z]+)\s*\n([\s\S]*?)(?=\n\d+\.\s+[A-Z][A-Z]+\s|\nKey\s+\d+|\Z)',
        re.IGNORECASE
    )
    for m in named_key_pat.finditer(text):
        blocks.append((m.group(1).strip(), m.group(2).strip()))

    # Pattern for numbered keys like "Key 1", "Key 2", etc.
    num_key_pat = re.compile(
        r'(Key\s+\d+)\s*\n([\s\S]*?)(?=\nKey\s+\d+|\n\d+\.\s+[A-Z][A-Z]+\s|\Z)',
        re.IGNORECASE
    )
    for m in num_key_pat.finditer(text):
        blocks.append((m.group(1).strip(), m.group(2).strip()))

    # Inline key within a genus (couplets right after genus description, before species)
    # This is the most common: key embedded right in genus text
    if not blocks:
        # Look for couplet patterns (1a. ... 1b. ...) in the text
        if re.search(r'^\d+[a-z]\.\s+', text, re.MULTILINE):
            # Find the start of couplets
            m = re.search(r'^(\d+[a-z]\.\s+[\s\S]*)', text, re.MULTILINE)
            if m:
                blocks.append(('Key to species', m.group(1).strip()))

    return blocks


def parse_genera(text):
    """Parse genus entries from full text. Returns list of genus dicts."""
    # Genus header: "N. GENUS Authority, Citation Year."
    # GENUS is all-caps, at least 2 letters, NOT ending in ACEAE/ALES
    pattern = re.compile(
        r'(\d+)\.\s+'
        r'([A-Z][A-Z]+)\s+'
        r'([A-Z][a-z\u00e9][^,\n]+)',
    )
    genera = []
    for m in pattern.finditer(text):
        name_upper = m.group(2)
        if name_upper.endswith('ACEAE') or name_upper.endswith('ALES'):
            continue
        genus = name_upper[0] + name_upper[1:].lower()
        genera.append({
            'number': int(m.group(1)),
            'genus': genus,
            'authority': m.group(3).strip().rstrip('.').strip(),
            'start_pos': m.start(),
        })
    return genera


def parse_genus_sections(text, genera):
    """
    Split text into per-genus sections.
    For each genus, extract description and key to species.
    Returns dict: genus_name -> {description, key_data, key_text}
    """
    sections = {}
    for i, g in enumerate(genera):
        start = g['start_pos']
        end = genera[i + 1]['start_pos'] if i + 1 < len(genera) else len(text)
        section_text = text[start:end]

        # Find genus Chinese name from the lines right after the header
        cn_name, pinyin = _find_chinese_name(section_text)

        # Extract description: text between the Chinese name line and the first
        # species entry or key entry
        desc = None
        # Skip the header line and Chinese name line
        lines = section_text.split('\n')
        desc_lines = []
        past_header = False
        past_chinese = False
        for line in lines:
            stripped = line.strip()
            if not past_header:
                if re.match(r'\d+\.\s+[A-Z][A-Z]+', stripped):
                    past_header = True
                continue
            if not past_chinese and re.search(r'[\u4e00-\u9fff]', stripped):
                past_chinese = True
                continue
            if past_chinese:
                # Stop at first species entry or key couplet
                if re.match(r'\d+[a-z]?\.\s+[A-Z][a-z]', stripped):
                    break
                if re.match(r'Key\s+', stripped, re.IGNORECASE):
                    break
                desc_lines.append(stripped)

        desc = '\n'.join(desc_lines).strip() if desc_lines else None

        # Find keys within this genus section
        key_blocks = _find_key_blocks(section_text)
        all_key_data = []
        all_key_text = []
        for key_name, key_block in key_blocks:
            kd, kt = parse_dichotomous_key(key_block)
            all_key_data.extend(kd)
            if kt:
                all_key_text.append(f'--- {key_name} ---\n{kt}')

        sections[g['genus']] = {
            'chinese_name': cn_name,
            'pinyin': pinyin,
            'description': desc,
            'key_data': all_key_data,
            'key_text': '\n\n'.join(all_key_text) if all_key_text else None,
        }

    return sections


def parse_species_entries(text, family_latin, known_genera):
    """
    Parse all species and infraspecific taxa from the full text.
    Returns a list of species dicts with full detail.
    """
    genus_set = {g['genus'] for g in known_genera}
    species_list = []
    seen = set()

    # -----------------------------------------------------------
    # Strategy: find all species/infraspecific entry headers.
    #
    # Species entry pattern:
    #   N. Genus epithet Authority, Citation. Year.
    #
    # Infraspecific pattern:
    #   Na. Genus epithet var./subsp./f. infraname Authority
    #   e.g. "6a. Begonia asperifolia var. asperifolia"
    #   e.g. "11b. Viola sacchalinensis var. alpicola P. Y. Fu ..."
    # -----------------------------------------------------------

    # Combined pattern for both species and infraspecific entries
    entry_pat = re.compile(
        r'^(\d+)([a-z]?)\.\s+'                              # number + optional letter
        r'([A-Z][a-z]+)\s+'                                  # genus
        r'((?:(?:subg|sect)\.\s+[A-Z][a-z]+\s+)?)'          # optional subgenus/section
        r'([a-z][a-z-]+)\s*'                                 # species epithet
        r'((?:(?:var|subsp|f|ssp)\.\s+[a-z][a-z-]+\s*)?)',   # optional infraspecific
        re.MULTILINE
    )

    entries = list(entry_pat.finditer(text))

    for idx, m in enumerate(entries):
        genus = m.group(3)
        if genus not in genus_set:
            continue

        number = m.group(1)
        letter = m.group(2)  # empty for species, 'a'/'b' etc for infraspecific
        epithet = m.group(5).strip()
        infra_part = m.group(6).strip()

        # Determine if this is an infraspecific taxon
        infraspecific_rank = None
        infraspecific_epithet = None
        if infra_part:
            im = re.match(r'(var|subsp|f|ssp)\.\s+([a-z][a-z-]+)', infra_part)
            if im:
                infraspecific_rank = im.group(1)
                if infraspecific_rank == 'ssp':
                    infraspecific_rank = 'subsp'
                infraspecific_epithet = im.group(2)

        # Build latin name
        if infraspecific_rank and infraspecific_epithet:
            latin_name = f'{genus} {epithet} {infraspecific_rank}. {infraspecific_epithet}'
        else:
            latin_name = f'{genus} {epithet}'

        # Skip duplicates
        if latin_name in seen:
            continue
        seen.add(latin_name)

        # Collect the full text block for this entry (until next entry)
        entry_start = m.start()
        if idx + 1 < len(entries):
            entry_end = entries[idx + 1].start()
        else:
            entry_end = len(text)
        block = text[entry_start:entry_end]

        # Parse detail from the block
        detail = parse_species_detail(block)
        if detail is None:
            continue

        # Skip key-like entries (no year, no description)
        # But be lenient for infraspecific taxa which may be brief
        if not detail.get('authority') and not letter:
            continue

        species_list.append({
            'latin_name': latin_name,
            'chinese_name': detail.get('chinese_name'),
            'genus': genus,
            'species_epithet': epithet,
            'authority': detail.get('authority', ''),
            'infraspecific_rank': infraspecific_rank,
            'infraspecific_epithet': infraspecific_epithet,
            'synonyms': detail.get('synonyms', []),
            'description': detail.get('description', ''),
            'description_habitat': detail.get('habitat', ''),
            'description_altitude': detail.get('altitude', ''),
            'description_distribution': detail.get('distribution', ''),
            'flowering_fruiting': detail.get('flowering_fruiting', ''),
            'chromosome': detail.get('chromosome', ''),
            'notes': detail.get('notes', ''),
            'entry_number': number,
            'entry_letter': letter,
        })

    # -----------------------------------------------------------
    # Set parent_id references: infraspecific -> parent species
    # -----------------------------------------------------------
    # Group by entry_number: entries with a letter belong to the
    # species with the same genus + epithet
    parent_map = {}
    for sp in species_list:
        if not sp['entry_letter']:
            key = (sp['genus'], sp['species_epithet'])
            parent_map[key] = sp['latin_name']

    for sp in species_list:
        if sp['infraspecific_rank']:
            key = (sp['genus'], sp['species_epithet'])
            sp['parent_latin_name'] = parent_map.get(key)
        else:
            sp['parent_latin_name'] = None

    return species_list


def parse_species_detail(text_block):
    """
    Extract all details from a single species/infraspecific text block.
    Returns dict with: authority, chinese_name, synonyms, description,
    habitat, altitude, distribution, flowering_fruiting, chromosome, notes
    """
    if not text_block or len(text_block) < 20:
        return None

    lines = text_block.split('\n')
    result = {}

    # --- Authority ---
    # First line(s) contain: N. Genus epithet Authority, Citation. Year.
    # Or for infraspecific: Na. Genus epithet var. xxx Authority, ...
    # Some entries (original varieties) have no authority at all.
    # Combine first few lines to find the year
    header_text = ''
    header_end_line = 0
    found_year = False
    for i, line in enumerate(lines[:6]):
        header_text += ' ' + line.strip()
        if re.search(r'\d{4}', header_text):
            header_end_line = i
            found_year = True
            break

    # If no year found, the header is just the first line
    if not found_year:
        header_text = lines[0].strip() if lines else ''
        header_end_line = 0

    # Extract authority: strip the numbered header prefix, genus, epithet, and
    # optional infraspecific parts, then take what remains before the citation.
    # Step 1: remove leading "N. Genus epithet [var./subsp./f. xxx]"
    stripped_header = re.sub(
        r'^\s*\d+[a-z]?\.\s+[A-Z][a-z]+\s+'             # number + genus
        r'(?:(?:subg|sect)\.\s+[A-Z][a-z]+\s+)?'          # optional subgenus
        r'[a-z][a-z-]+\s*'                                 # species epithet
        r'(?:(?:var|subsp|f|ssp)\.\s+[a-z][a-z-]+\s*)?',  # optional infraspecific
        '', header_text
    ).strip()

    # Step 2: authority is everything before the first ", UpperCase" (citation start)
    # Also stop at Chinese characters (which signal Chinese name, not authority)
    if stripped_header:
        # Trim at first Chinese character (start of Chinese name on same line)
        cn_pos = re.search(r'[\u4e00-\u9fff\u3400-\u4dbf]', stripped_header)
        if cn_pos:
            stripped_header = stripped_header[:cn_pos.start()].strip()

        if stripped_header:
            auth_m = re.match(r'(.+?)(?:,\s+[A-Z])', stripped_header)
            if auth_m:
                authority = re.sub(r'\s+', ' ', auth_m.group(1)).strip().rstrip(',').strip()
                result['authority'] = authority
            else:
                # Fallback: everything before the year
                year_m = re.search(r'\d{4}', stripped_header)
                if year_m:
                    authority = stripped_header[:year_m.start()].strip().rstrip(',.').strip()
                    if authority:
                        result['authority'] = re.sub(r'\s+', ' ', authority)

    # --- Chinese name ---
    # Usually on the line after the header, but can also be on the header line
    # itself (for original varieties without authority). Search header first,
    # then subsequent lines.
    cn_search_start = header_end_line + 1
    # Check header line(s) first for Chinese name
    cn_found = False
    for i in range(0, min(header_end_line + 1, len(lines))):
        cn, pinyin = _find_chinese_name(lines[i])
        if cn:
            result['chinese_name'] = cn
            cn_found = True
            break
    if not cn_found:
        for i in range(cn_search_start, min(cn_search_start + 3, len(lines))):
            cn, pinyin = _find_chinese_name(lines[i])
            if cn:
                result['chinese_name'] = cn
                break

    # --- Synonyms ---
    # Everything between the Chinese name line and the start of the
    # morphological description is synonym text. The morphological
    # description always starts with a botanical habit/form word.
    cn_line_idx = cn_search_start
    for i in range(cn_search_start, min(cn_search_start + 3, len(lines))):
        if re.search(r'[\u4e00-\u9fff]', lines[i]):
            cn_line_idx = i
            break

    # Description start pattern: lines beginning with botanical habit words
    _desc_start_pat = re.compile(
        r'^(?:Trees?|Shrubs?|Herbs?|Subshrubs?|Perennial|Annual|Biennial|'
        r'Plants?|Stems?|Leaves?|Blade|Rhizome|Roots?|Small|Erect|Prostrate|'
        r'Morphological|About|Two|Three|More|One|Deciduous|Evergreen|'
        r'Vines?|Climbers?|Lianas?|Epiphytes?|Bulbs?|Tubers?)\b'
    )

    syn_start = cn_line_idx + 1
    syn_lines = []
    desc_start_line = syn_start
    for i in range(syn_start, min(syn_start + 20, len(lines))):
        line = lines[i].strip()
        if not line:
            continue
        if _desc_start_pat.match(line):
            desc_start_line = i
            break
        syn_lines.append(line)
        desc_start_line = i + 1

    if syn_lines:
        syn_text = ' '.join(syn_lines)
        # Clean up hyphenated line breaks from PDF
        syn_text = re.sub(r'- ', '', syn_text)
        # Split by semicolons
        parts = re.split(r';\s*', syn_text.rstrip('.'))
        synonyms = [p.strip() for p in parts if p.strip()]
        result['synonyms'] = synonyms

    # --- Morphological description ---
    # Prose paragraphs from desc_start_line until Fl./distribution/habitat
    desc_parts = []
    extra_lines = []
    for i in range(desc_start_line, len(lines)):
        line = lines[i].strip()
        if not line:
            if desc_parts:
                # Check if we've reached the end section
                remaining = '\n'.join(lines[i:])
                if re.search(r'Fl\.\s+[A-Z]|^\u25cf|\d+[-\u2013]\d+\s*m\b|^(?:Forests?|Thickets?|Grasslands?)',
                             remaining[:200], re.MULTILINE):
                    break
            continue

        # Stop at distribution/habitat/flowering lines
        if re.match(r'\u25cf', line):
            extra_lines = lines[i:]
            break
        if re.match(r'Fl\.\s+[A-Z]', line):
            extra_lines = lines[i:]
            break

        # Check if this is a habitat/distribution line (starts with habitat keyword
        # and contains altitude)
        if (re.match(r'(?:Forests?|Thickets?|Grasslands?|Open|Shaded|Mountain|'
                     r'Alpine|Moist|Rocky|Sandy|Lowland|Variable|Along|Slopes?|'
                     r'Meadows?|Wet|Sparse)', line) and
                re.search(r'\d+\s*m\b', line)):
            extra_lines = lines[i:]
            break

        desc_parts.append(line)

    description = ' '.join(desc_parts).strip()
    # Clean up artifacts from PDF extraction
    description = re.sub(r'\s+', ' ', description)
    result['description'] = description

    # --- Flowering/fruiting, chromosome, habitat, altitude, distribution ---
    # Search the entire text block since these may appear in the description
    # paragraph itself (e.g. "...Seeds black, ovoid. Fl. Apr-May, fr. Jul-Aug. 2n = 28.")
    # or in subsequent lines.
    full_search_text = text_block
    tail_text = '\n'.join(extra_lines) if extra_lines else ''

    result['flowering_fruiting'] = (_extract_flowering_fruiting(full_search_text) or '')
    result['chromosome'] = (_extract_chromosome(full_search_text) or '')
    result['habitat'] = (_extract_habitat(tail_text) or
                         _extract_habitat(full_search_text) or '')
    result['altitude'] = (_extract_altitude(tail_text) or
                          _extract_altitude(full_search_text) or '')
    result['distribution'] = (_extract_distribution(tail_text) or
                              _extract_distribution(full_search_text) or '')

    # Strip flowering/fruiting and chromosome from description if present
    if result['flowering_fruiting'] and result['flowering_fruiting'] in description:
        description = description.replace(result['flowering_fruiting'], '').strip()
    chrom = result['chromosome']
    if chrom and chrom in description:
        description = description.replace(chrom, '').strip()
    # Clean trailing punctuation from description
    description = re.sub(r'[\s.]+$', '', description).strip()
    if description:
        description += '.'
    result['description'] = description

    # --- Notes ---
    # Text after distribution line, often editorial notes
    notes_parts = []
    past_dist = False
    for line in (extra_lines or []):
        line = line.strip()
        if past_dist:
            if line and not re.match(r'\d+[a-z]?\.\s+[A-Z]', line):
                notes_parts.append(line)
        elif re.search(r'\[.*?\]', line):
            past_dist = True

    if notes_parts:
        result['notes'] = ' '.join(notes_parts).strip()
        result['notes'] = re.sub(r'\s+', ' ', result['notes'])

    return result


def parse_foc_pdf(pdf_path, order_override=None, verbose=False):
    """
    Parse a single FOC PDF, returning all structured data.

    Returns:
        (family_info, family_desc, genera, genus_sections, species, key_data)
    """
    family_latin, family_chinese = parse_family_from_filename(pdf_path)
    if not family_latin:
        print(f'  [!] Cannot parse family name from: {pdf_path}')
        return None, None, [], {}, [], {}

    if family_chinese:
        family_display = f'{family_chinese} {family_latin}'
    else:
        family_display = family_latin

    order = order_override or FAMILY_ORDER.get(family_latin)
    if not order:
        print(f'  [!] Unknown order for {family_latin}, using "Unknown"')
        order = 'Unknown'

    family_info = {
        'latin': family_latin,
        'chinese': family_chinese,
        'display': family_display,
        'order': order,
    }

    raw_text = extract_text(pdf_path)
    text = clean_text(raw_text)

    if verbose:
        print(f'\n--- RAW TEXT (first 3000 chars) ---')
        print(text[:3000])
        print(f'--- END RAW TEXT ({len(text)} total chars) ---\n')

    # Family description
    family_desc = parse_family_description(text, family_latin)

    # Family-level key (key to genera)
    family_key_data = []
    family_key_text = ''
    fam_key_blocks = _find_key_blocks(text)
    # Only use key blocks found before the first genus
    genera = parse_genera(text)
    if genera and fam_key_blocks:
        first_genus_pos = genera[0]['start_pos']
        for kname, kblock in fam_key_blocks:
            # Check if this key block appears before the first genus
            kpos = text.find(kblock[:50])
            if kpos < first_genus_pos:
                kd, kt = parse_dichotomous_key(kblock)
                family_key_data = kd
                family_key_text = kt
                break

    # Genus sections
    genus_sections = parse_genus_sections(text, genera) if genera else {}

    # Species entries
    species = parse_species_entries(text, family_latin, genera)

    return (family_info, family_desc, genera, genus_sections, species,
            {'family_key_data': family_key_data,
             'family_key_text': family_key_text})


# ===================================================================
# Database operations
# ===================================================================

def init_db(conn):
    """Initialize database with all required tables and columns."""
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS plants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latin_name TEXT NOT NULL,
            chinese_name TEXT,
            genus TEXT,
            species_epithet TEXT,
            authority TEXT,
            kingdom TEXT DEFAULT '\u690d\u7269\u754c Plantae',
            phylum TEXT,
            class TEXT,
            "order" TEXT,
            family TEXT,
            description TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            parent_id INTEGER,
            infraspecific_rank TEXT,
            synonyms TEXT,
            description_habitat TEXT,
            description_distribution TEXT,
            description_altitude TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            ppbc_id TEXT,
            photographer TEXT,
            location TEXT,
            shot_date TEXT,
            admin_division TEXT,
            location_detail TEXT,
            is_primary INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS taxonomy_descriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            taxon_level TEXT NOT NULL,
            taxon_name TEXT NOT NULL,
            family TEXT,
            description TEXT,
            key_data TEXT,
            key_text TEXT,
            references_text TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_photos_plant_id ON photos(plant_id);
        CREATE INDEX IF NOT EXISTS idx_plants_genus ON plants(genus);
        CREATE INDEX IF NOT EXISTS idx_plants_family ON plants(family);
        CREATE INDEX IF NOT EXISTS idx_plants_latin ON plants(latin_name);
        CREATE INDEX IF NOT EXISTS idx_taxonomy_desc ON taxonomy_descriptions(taxon_name, taxon_level);
    ''')

    # Add V2 columns to plants if missing
    existing_cols = {row[1] for row in conn.execute('PRAGMA table_info(plants)').fetchall()}
    v2_cols = {
        'parent_id': 'INTEGER',
        'infraspecific_rank': 'TEXT',
        'synonyms': 'TEXT',
        'description_habitat': 'TEXT',
        'description_distribution': 'TEXT',
        'description_altitude': 'TEXT',
    }
    for col, coltype in v2_cols.items():
        if col not in existing_cols:
            conn.execute(f'ALTER TABLE plants ADD COLUMN {col} {coltype}')


def update_taxonomy_lookup(genera, family_info):
    """Update taxonomy-lookup.json with genus entries."""
    data = {}
    if TAXONOMY_PATH.exists():
        with open(TAXONOMY_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)

    updated = 0
    for g in genera:
        if g['genus'] not in data or g['genus'] == '_meta':
            data[g['genus']] = {
                **DEFAULT_HIGHER,
                'order': family_info['order'],
                'family': family_info['display'],
            }
            updated += 1

    with open(TAXONOMY_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return updated


def import_data(family_info, family_desc, genera, genus_sections, species,
                keys_info, update=False):
    """Write all parsed data to the database."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute('PRAGMA foreign_keys = ON')
    init_db(conn)

    taxonomy = {}
    if TAXONOMY_PATH.exists():
        with open(TAXONOMY_PATH, 'r', encoding='utf-8') as f:
            taxonomy = json.load(f)

    stats = {'new': 0, 'updated': 0, 'skipped': 0, 'desc_new': 0, 'desc_updated': 0}

    # --- Write taxonomy_descriptions for family ---
    if family_desc:
        existing = conn.execute(
            'SELECT id FROM taxonomy_descriptions WHERE taxon_level = ? AND taxon_name = ?',
            ('family', family_info['latin'])
        ).fetchone()

        fam_key_json = json.dumps(keys_info.get('family_key_data', []),
                                  ensure_ascii=False) if keys_info.get('family_key_data') else None
        fam_key_text = keys_info.get('family_key_text') or None

        if existing and update:
            conn.execute('''
                UPDATE taxonomy_descriptions SET
                    description = ?, key_data = ?, key_text = ?,
                    family = ?, updated_at = datetime('now')
                WHERE id = ?
            ''', (family_desc, fam_key_json, fam_key_text,
                  family_info['display'], existing[0]))
            stats['desc_updated'] += 1
        elif not existing:
            conn.execute('''
                INSERT INTO taxonomy_descriptions
                    (taxon_level, taxon_name, family, description, key_data, key_text)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', ('family', family_info['latin'], family_info['display'],
                  family_desc, fam_key_json, fam_key_text))
            stats['desc_new'] += 1

    # --- Write taxonomy_descriptions for each genus ---
    for genus_name, sec in genus_sections.items():
        existing = conn.execute(
            'SELECT id FROM taxonomy_descriptions WHERE taxon_level = ? AND taxon_name = ?',
            ('genus', genus_name)
        ).fetchone()

        key_json = json.dumps(sec['key_data'], ensure_ascii=False) if sec['key_data'] else None

        if existing and update:
            conn.execute('''
                UPDATE taxonomy_descriptions SET
                    description = ?, key_data = ?, key_text = ?,
                    family = ?, updated_at = datetime('now')
                WHERE id = ?
            ''', (sec['description'], key_json, sec.get('key_text'),
                  family_info['display'], existing[0]))
            stats['desc_updated'] += 1
        elif not existing:
            conn.execute('''
                INSERT INTO taxonomy_descriptions
                    (taxon_level, taxon_name, family, description, key_data, key_text)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', ('genus', genus_name, family_info['display'],
                  sec['description'], key_json, sec.get('key_text')))
            stats['desc_new'] += 1

    # --- Write species to plants table ---
    # First pass: insert/update all species to get IDs
    id_map = {}  # latin_name -> id

    for sp in species:
        existing = conn.execute(
            'SELECT id, description, description_habitat, description_distribution, '
            'description_altitude, synonyms FROM plants WHERE latin_name = ?',
            (sp['latin_name'],)
        ).fetchone()

        taxon = taxonomy.get(sp['genus'], {})
        synonyms_str = '; '.join(sp['synonyms']) if sp['synonyms'] else None

        if existing:
            if update:
                conn.execute('''
                    UPDATE plants SET
                        chinese_name = COALESCE(?, chinese_name),
                        genus = ?, species_epithet = ?,
                        authority = COALESCE(NULLIF(?, ''), authority),
                        kingdom = ?, phylum = ?, class = ?, "order" = ?, family = ?,
                        description = COALESCE(NULLIF(?, ''), description),
                        infraspecific_rank = ?,
                        synonyms = COALESCE(NULLIF(?, ''), synonyms),
                        description_habitat = COALESCE(NULLIF(?, ''), description_habitat),
                        description_distribution = COALESCE(NULLIF(?, ''), description_distribution),
                        description_altitude = COALESCE(NULLIF(?, ''), description_altitude),
                        notes = COALESCE(NULLIF(?, ''), notes),
                        updated_at = datetime('now')
                    WHERE id = ?
                ''', (
                    sp['chinese_name'],
                    sp['genus'], sp['species_epithet'],
                    sp['authority'],
                    taxon.get('kingdom', DEFAULT_HIGHER['kingdom']),
                    taxon.get('phylum', DEFAULT_HIGHER['phylum']),
                    taxon.get('class', DEFAULT_HIGHER['class']),
                    taxon.get('order', family_info['order']),
                    taxon.get('family', family_info['display']),
                    sp['description'],
                    sp['infraspecific_rank'],
                    synonyms_str,
                    sp['description_habitat'],
                    sp['description_distribution'],
                    sp['description_altitude'],
                    sp.get('notes', ''),
                    existing[0],
                ))
                id_map[sp['latin_name']] = existing[0]
                stats['updated'] += 1
            else:
                # Merge strategy: only fill empty fields
                updates = []
                params = []
                if not existing[1] and sp['description']:
                    updates.append('description = ?')
                    params.append(sp['description'])
                if not existing[2] and sp['description_habitat']:
                    updates.append('description_habitat = ?')
                    params.append(sp['description_habitat'])
                if not existing[3] and sp['description_distribution']:
                    updates.append('description_distribution = ?')
                    params.append(sp['description_distribution'])
                if not existing[4] and sp['description_altitude']:
                    updates.append('description_altitude = ?')
                    params.append(sp['description_altitude'])
                if not existing[5] and synonyms_str:
                    updates.append('synonyms = ?')
                    params.append(synonyms_str)

                if updates:
                    updates.append("updated_at = datetime('now')")
                    sql = f'UPDATE plants SET {", ".join(updates)} WHERE id = ?'
                    params.append(existing[0])
                    conn.execute(sql, params)
                    stats['updated'] += 1
                else:
                    stats['skipped'] += 1

                id_map[sp['latin_name']] = existing[0]
        else:
            cursor = conn.execute('''
                INSERT INTO plants (
                    latin_name, chinese_name, genus, species_epithet,
                    authority, kingdom, phylum, class, "order", family,
                    description, infraspecific_rank, synonyms,
                    description_habitat, description_distribution,
                    description_altitude, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                sp['latin_name'], sp['chinese_name'],
                sp['genus'], sp['species_epithet'], sp['authority'],
                taxon.get('kingdom', DEFAULT_HIGHER['kingdom']),
                taxon.get('phylum', DEFAULT_HIGHER['phylum']),
                taxon.get('class', DEFAULT_HIGHER['class']),
                taxon.get('order', family_info['order']),
                taxon.get('family', family_info['display']),
                sp['description'],
                sp['infraspecific_rank'],
                synonyms_str,
                sp['description_habitat'],
                sp['description_distribution'],
                sp['description_altitude'],
                sp.get('notes', ''),
            ))
            id_map[sp['latin_name']] = cursor.lastrowid
            stats['new'] += 1

    # Second pass: set parent_id for infraspecific taxa
    for sp in species:
        if sp.get('parent_latin_name') and sp['parent_latin_name'] in id_map:
            parent_id = id_map[sp['parent_latin_name']]
            plant_id = id_map.get(sp['latin_name'])
            if plant_id and parent_id:
                conn.execute('UPDATE plants SET parent_id = ? WHERE id = ?',
                             (parent_id, plant_id))

    conn.commit()
    conn.close()
    return stats


# ===================================================================
# CLI
# ===================================================================

def main():
    parser = argparse.ArgumentParser(
        description='\u690d\u7269\u8d44\u6599\u5e93 - Flora of China PDF full-content import')
    parser.add_argument('source', help='PDF file path or directory containing PDFs')
    parser.add_argument('--dry-run', action='store_true',
                        help='Parse only, do not write to database')
    parser.add_argument('--update', action='store_true',
                        help='Overwrite existing records')
    parser.add_argument('--order', help='Override order classification (e.g. "\u5507\u5f62\u76ee Lamiales")')
    parser.add_argument('--verbose', action='store_true',
                        help='Dump raw extracted text for debugging')
    args = parser.parse_args()

    source = Path(args.source)

    if source.is_dir():
        pdfs = sorted(source.glob('*.pdf'))
    elif source.is_file() and source.suffix.lower() == '.pdf':
        pdfs = [source]
    else:
        print(f'\u9519\u8bef: cannot find PDF - {source}')
        sys.exit(1)

    if not pdfs:
        print(f'No PDF files found in {source}')
        sys.exit(1)

    total_stats = {
        'genera': 0, 'species': 0,
        'new': 0, 'updated': 0, 'skipped': 0,
        'desc_new': 0, 'desc_updated': 0,
    }

    for pdf_path in pdfs:
        print(f'\n{"=" * 60}')
        print(f'Processing: {pdf_path.name}')
        print(f'{"=" * 60}')

        try:
            result = parse_foc_pdf(pdf_path, order_override=args.order,
                                   verbose=args.verbose)
        except Exception as e:
            print(f'  [!] Error parsing {pdf_path.name}: {e}')
            continue

        family_info, family_desc, genera, genus_sections, species, keys_info = result
        if not family_info:
            continue

        print(f'  Family: {family_info["display"]}')
        print(f'  Order:  {family_info["order"]}')

        # Summary
        infra_count = sum(1 for s in species if s.get('infraspecific_rank'))
        sp_count = len(species) - infra_count
        fam_desc_len = len(family_desc) if family_desc else 0
        fam_key_count = len(keys_info.get('family_key_data', []))

        print(f'  Family description: {fam_desc_len} chars')
        print(f'  Family key couplets: {fam_key_count}')
        print(f'  Genera: {len(genera)}')
        print(f'  Species: {sp_count}')
        if infra_count:
            print(f'  Infraspecific taxa: {infra_count}')

        total_stats['genera'] += len(genera)
        total_stats['species'] += len(species)

        if genera:
            print(f'\n  Genera:')
            for g in genera:
                sec = genus_sections.get(g['genus'], {})
                g_sp = sum(1 for s in species if s['genus'] == g['genus'])
                g_key = len(sec.get('key_data', []))
                g_desc = len(sec.get('description', '') or '')
                print(f'    {g["genus"]} {g["authority"]} '
                      f'({g_sp} taxa, desc {g_desc} chars, {g_key} key couplets)')

        if args.dry_run:
            # Show first 5 species with details
            print(f'\n  [dry-run] First 5 species:')
            for sp in species[:5]:
                cn = sp['chinese_name'] or '?'
                print(f'\n    {sp["latin_name"]} {sp["authority"]}')
                print(f'      Chinese: {cn}')
                if sp.get('infraspecific_rank'):
                    print(f'      Rank: {sp["infraspecific_rank"]}')
                    if sp.get('parent_latin_name'):
                        print(f'      Parent: {sp["parent_latin_name"]}')
                if sp['synonyms']:
                    print(f'      Synonyms: {"; ".join(sp["synonyms"][:3])}'
                          f'{"..." if len(sp["synonyms"]) > 3 else ""}')
                desc = sp.get('description', '') or ''
                if desc:
                    print(f'      Description: {desc[:120]}...' if len(desc) > 120
                          else f'      Description: {desc}')
                if sp.get('description_habitat'):
                    print(f'      Habitat: {sp["description_habitat"]}')
                if sp.get('description_altitude'):
                    print(f'      Altitude: {sp["description_altitude"]}')
                if sp.get('description_distribution'):
                    dist = sp['description_distribution']
                    print(f'      Distribution: {dist[:120]}...' if len(dist) > 120
                          else f'      Distribution: {dist}')
                if sp.get('flowering_fruiting'):
                    print(f'      Phenology: {sp["flowering_fruiting"]}')
                if sp.get('chromosome'):
                    print(f'      Chromosome: {sp["chromosome"]}')

            if len(species) > 5:
                print(f'\n    ... total {len(species)} entries')

            if args.verbose and family_desc:
                print(f'\n  --- Family description ---')
                print(f'  {family_desc[:500]}')
                if len(family_desc) > 500:
                    print(f'  ... ({len(family_desc)} chars total)')

                if keys_info.get('family_key_text'):
                    print(f'\n  --- Family key (raw) ---')
                    kt = keys_info['family_key_text']
                    print(f'  {kt[:500]}')
                    if len(kt) > 500:
                        print(f'  ... ({len(kt)} chars total)')

        else:
            # Write taxonomy-lookup.json
            tax_updated = update_taxonomy_lookup(genera, family_info)
            print(f'\n  taxonomy-lookup.json: +{tax_updated} genera')

            # Write to database
            stats = import_data(family_info, family_desc, genera,
                                genus_sections, species, keys_info,
                                update=args.update)
            total_stats['new'] += stats['new']
            total_stats['updated'] += stats['updated']
            total_stats['skipped'] += stats['skipped']
            total_stats['desc_new'] += stats['desc_new']
            total_stats['desc_updated'] += stats['desc_updated']

            print(f'  DB plants: +{stats["new"]} new, '
                  f'{stats["updated"]} updated, {stats["skipped"]} skipped')
            print(f'  DB descriptions: +{stats["desc_new"]} new, '
                  f'{stats["desc_updated"]} updated')

    # Summary
    print(f'\n{"=" * 60}')
    print(f'Import complete!')
    print(f'  Processed {len(pdfs)} PDF(s)')
    print(f'  Parsed: {total_stats["genera"]} genera, {total_stats["species"]} taxa')
    if not args.dry_run:
        print(f'  DB plants: +{total_stats["new"]} new, '
              f'{total_stats["updated"]} updated, {total_stats["skipped"]} skipped')
        print(f'  DB descriptions: +{total_stats["desc_new"]} new, '
              f'{total_stats["desc_updated"]} updated')
        print(f'\n  Database: {DB_PATH}')
        print(f'  Taxonomy: {TAXONOMY_PATH}')


if __name__ == '__main__':
    main()
