# -*- coding: utf-8 -*-
"""Générateur des maquettes SOLIDATA — section Insertion (refonte CIP)."""
import json, os

FONT = "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap\">"

BASE_CSS = """
:root{--p:#0D9488;--pd:#0F766E;--pl:#14B8A6;--pm:#CCFBF1;--ps:#F0FDFA;--bg:#FAFAF9;--sub:#F1F5F9;--txt:#0F172A;--mut:#64748B;--bd:#E2E8F0;--bdl:#F1F5F9;}
body{margin:0;font-family:'Plus Jakarta Sans',-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--txt);-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.45}
a{color:var(--pd);text-decoration:none} a:hover{color:var(--p)}
*{box-sizing:border-box}
.card{background:#fff;border-radius:12px;box-shadow:0 1px 3px 0 rgb(15 23 42/.05);border:1px solid var(--bdl)}
.sec{background:#fff;border:1px solid rgb(226 232 240/.7);border-radius:14px;box-shadow:0 1px 3px 0 rgb(15 23 42/.05)}
.sec-h{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;border-bottom:1px solid var(--bdl)}
.sec-t{font-size:15px;font-weight:700;color:#0F172A;margin:0}
.sec-b{padding:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-weight:500;border-radius:10px;padding:8px 14px;font-size:13px;border:1px solid transparent;cursor:pointer;white-space:nowrap}
.btn-p{background:var(--p);color:#fff}
.btn-s{background:#fff;border-color:var(--bd);color:var(--txt)}
.btn-g{color:var(--mut);padding:6px 10px}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:8px}
.inp{width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--bd);background:#fff;font-size:13px;color:var(--txt);font-family:inherit}
.lbl{display:block;font-size:12.5px;font-weight:600;color:#334155;margin-bottom:4px}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;line-height:1.5}
.b-teal{background:#CCFBF1;color:#0F766E}.b-slate{background:#F1F5F9;color:#475569}.b-red{background:#FEE2E2;color:#B91C1C}.b-amber{background:#FEF3C7;color:#B45309}.b-green{background:#D1FAE5;color:#047857}.b-blue{background:#DBEAFE;color:#1D4ED8}.b-violet{background:#EDE9FE;color:#6D28D9}.b-indigo{background:#E0E7FF;color:#3730A3}
.kpi{background:#fff;border-radius:12px;border:1px solid var(--bdl);box-shadow:0 1px 3px 0 rgb(15 23 42/.05);padding:18px 20px}
.kpi .t{font-size:13px;font-weight:500;color:var(--mut)}.kpi .v{font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
.mut{color:var(--mut)}.sm{font-size:12.5px}.xs{font-size:11.5px}.b{font-weight:700}.sb{font-weight:600}
.row{display:flex;align-items:center;gap:10px}.col{display:flex;flex-direction:column;gap:8px}
.line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border-radius:10px;border:1px solid var(--bdl);background:#fff}
.line.red{border-color:#FECACA;background:#FEF2F2}.line.amber{border-color:#FDE68A;background:#FFFBEB}.line.gray{background:#F8FAFC}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--bd);margin-bottom:18px}
.tab{padding:10px 14px;font-size:13.5px;font-weight:600;color:var(--mut);border-bottom:2px solid transparent;margin-bottom:-1px}
.tab.on{color:var(--pd);border-color:var(--p)}
.tbl{width:100%;border-collapse:collapse;font-size:13px}.tbl th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--bd);background:#F8FAFC}.tbl td{padding:9px 10px;border-bottom:1px solid var(--bdl);vertical-align:middle}
.ic{width:16px;height:16px;flex-shrink:0}
.chip{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:10px;border:1px solid var(--bd);background:#fff;font-size:13px;font-weight:600;min-height:38px}
.chip.on{background:var(--p);color:#fff;border-color:var(--p)}
.bar{height:8px;border-radius:999px;background:#E2E8F0;overflow:hidden}.bar>i{display:block;height:100%;background:var(--p)}
.pdfh{background:#0D9488;color:#fff;padding:16px 22px;display:flex;justify-content:space-between;align-items:center}
.pdft{font-size:12px;font-weight:700;color:#0F766E;border-bottom:2px solid #0D9488;padding-bottom:2px;margin:11px 0 6px;text-transform:uppercase;letter-spacing:.04em}
.tbl.tight td{padding:4px 8px}.tbl.tight th{padding:5px 8px}
.pdfc{background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;padding:10px 12px}
"""

# --- icônes (traits, grille 24, style lucide) -----------------------------
def ic(name, size=16, cls="ic", color="currentColor"):
    P = {
     'home':'<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
     'truck':'<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
     'users':'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
     'heart':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
     'list':'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
     'clip':'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
     'gauge':'<path d="M12 14l3-3"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
     'star':'<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
     'grad':'<path d="M22 10L12 5 2 10l10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
     'bld':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 21V9h6v12M9 13h6"/>',
     'set':'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
     'chev':'<path d="M6 9l6 6 6-6"/>','chevr':'<path d="M9 6l6 6-6 6"/>','chevl':'<path d="M15 18l-6-6 6-6"/>',
     'folder':'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
     'clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
     'chart':'<path d="M3 3v18h18"/><path d="M7 15l4-4 4 4 5-6"/>',
     'layers':'<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
     'shield':'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
     'shirt':'<path d="M20.4 6.5L16 3l-4 2-4-2-4.4 3.5 2 3 2.4-1.3V21h8V8.2l2.4 1.3z"/>',
     'menu':'<path d="M4 6h16M4 12h16M4 18h16"/>',
     'spark':'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
     'check':'<path d="M20 6L9 17l-5-5"/>','x':'<path d="M18 6L6 18M6 6l12 12"/>',
     'alert':'<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
     'search':'<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
     'plus':'<path d="M12 5v14M5 12h14"/>','file':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
     'cal':'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
     'bell':'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
     'lock':'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
     'copy':'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
     'link':'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
     'user':'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
     'pen':'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
     'info':'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
     'down':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
     'eye':'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
     'phone':'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    }
    return f'<svg class="{cls}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{P[name]}</svg>'

def badge(txt, tone="slate"): return f'<span class="badge b-{tone}">{txt}</span>'
def btn(txt, kind="s", icon=None, extra=""):
    return f'<span class="btn btn-{kind} {extra}">{ic(icon,14) if icon else ""}{txt}</span>'
def kpi(t, v, tone="#0F766E", foot=""):
    f = f'<div class="xs mut" style="margin-top:8px;padding-top:8px;border-top:1px solid #F1F5F9">{foot}</div>' if foot else ""
    return f'<div class="kpi"><div class="t">{t}</div><div class="v" style="color:{tone}">{v}</div>{f}</div>'
def sec(title, body, actions="", icon=None, sub=""):
    i = f'<div style="display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:#F0FDFA;color:#0F766E">{ic(icon,18)}</div>' if icon else ""
    s = f'<div class="xs mut" style="margin-top:2px">{sub}</div>' if sub else ""
    return f'<div class="sec"><div class="sec-h"><div class="row">{i}<div><h2 class="sec-t">{title}</h2>{s}</div></div><div class="row" style="gap:8px">{actions}</div></div><div class="sec-b">{body}</div></div>'

# --- gabarit application ----------------------------------------------------
NAV = [
 ("home","Accueil",None),("truck","Opérations",None),("users","RH et Insertion","rh"),("layers","Tri & Production",None),
 ("chart","Analyse",None),("shirt","Frip",None),("shield","QHSE",None),("set","Administration",None),
]
RH_CHILDREN = [
 ("Collaborateurs","/employees",None),("Espace CIP","/insertion","pill"),("Actions CIP","/insertion/actions",None),
 ("Dossiers FSE+","/insertion/conformite","new"),("Feuilles de temps","/insertion/temps","new"),
 ("Pilotage & indicateurs","/insertion/audit",None),("Effectifs ETP","/rh/effectifs",None),("Compétences","/skills",None),
 ("Plan de formation","/rh/formation",None),("Prescripteurs","/prescripteurs",None),("Réglages insertion","/admin/insertion",None),
]
ICONS_CHILD = {"/employees":"users","/insertion":"heart","/insertion/actions":"list","/insertion/conformite":"folder","/insertion/temps":"clock","/insertion/audit":"clip","/rh/effectifs":"gauge","/skills":"star","/rh/formation":"grad","/prescripteurs":"bld","/admin/insertion":"set"}

def sidebar(active="/insertion", pill=6):
    items=[]
    for icon,label,key in NAV:
        if key=="rh":
            items.append(f'<div style="margin-bottom:4px"><div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;color:#0F766E;background:#F0FDFA;font-size:13px;font-weight:600">{ic(icon,18)}<span style="flex:1">{label}</span>{ic("chev",14)}</div>'
                         f'<div style="margin-left:14px;margin-top:4px;padding-left:8px;border-left:1px solid #F1F5F9">'
                         f'<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;color:#475569;font-size:12.5px;font-weight:500">{ic("folder",16)}<span style="flex:1">Recrutement</span>{ic("chevr",14)}</div>'
                         f'<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;color:#0F766E;font-size:12.5px;font-weight:600">{ic("users",16)}<span style="flex:1">Gestion du personnel</span>{ic("chev",14)}</div>'
                         f'<div style="margin-left:12px;padding-left:8px;border-left:1px solid #F1F5F9;display:flex;flex-direction:column;gap:2px">')
            for lab,path,flag in RH_CHILDREN:
                on = path==active
                style = "background:linear-gradient(90deg,#0D9488,#14B8A6);color:#fff;font-weight:600;box-shadow:0 4px 10px -2px rgb(13 148 136/.35)" if on else "color:#475569;font-weight:500"
                p = ""
                if flag=="pill": p = f'<span style="font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:10px;background:{"rgba(255,255,255,.25)" if on else "#CCFBF1"};color:{"#fff" if on else "#0F766E"}">{pill}</span>'
                if flag=="new": p = f'<span title="Nouveau" style="width:7px;height:7px;border-radius:50%;background:#7C3AED;flex-shrink:0"></span>'
                items.append(f'<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:10px;font-size:13px;{style}">{ic(ICONS_CHILD[path],16)}<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{lab}</span>{p}</div>')
            items.append('</div></div></div>')
        else:
            items.append(f'<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;color:#334155;font-size:13px;font-weight:600;margin-bottom:4px">{ic(icon,18,color="#64748B")}<span style="flex:1">{label}</span>{ic("chevr",14,color="#94A3B8")}</div>')
    return ('<aside style="width:256px;flex-shrink:0;background:#fff;border-right:1px solid #E2E8F0;box-shadow:2px 0 8px -2px rgb(15 23 42/.04);display:flex;flex-direction:column;height:100%">'
            '<div style="display:flex;align-items:center;gap:12px;padding:16px 14px;border-bottom:1px solid #F1F5F9">'
            '<img src="logo.png" style="width:36px;height:36px;object-fit:contain" alt="">'
            '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:800;letter-spacing:.02em">Solidarité Textiles</div><div style="font-size:11px;color:#64748B">ERP SOLIDATA</div></div>'
            f'<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:6px;border:1px solid #E2E8F0;background:#F8FAFC;color:#64748B">{ic("chevl",14)}</div></div>'
            '<nav style="flex:1;overflow:hidden;padding:12px 8px">'+"".join(items)+'</nav></aside>')

def topbar(user="Nadia B. · RH"):
    return ('<header style="height:56px;background:#fff;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;gap:12px;padding:0 16px;flex-shrink:0">'
            '<div style="margin-left:auto;display:flex;align-items:center;gap:6px">'
            f'<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border-radius:999px;background:#F0FDFA;color:#0F766E;font-size:13px;font-weight:600"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:999px;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff">{ic("spark",14)}</span>Assistant &amp; messages<span style="min-width:18px;height:18px;padding:0 5px;background:#EF4444;color:#fff;font-size:10px;font-weight:700;border-radius:999px;display:grid;place-items:center">3</span></div>'
            f'<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:10px;color:#334155;font-size:13px;font-weight:600"><span style="display:grid;place-items:center;width:30px;height:30px;border-radius:999px;background:#0D9488;color:#fff;font-size:12px">NB</span>{user}{ic("chev",14)}</div>'
            '</div></header>')

def page(title, sub, body, active="/insertion", pill=6, actions="", icon="heart", W=1366, H=900, crumb="RH et Insertion / Gestion du personnel"):
    hdr = (f'<div style="margin-bottom:22px"><div class="xs mut" style="margin-bottom:6px">{crumb} / <span style="color:#1E293B;font-weight:600">{title}</span></div>'
           f'<div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><div class="row" style="gap:12px"><div style="padding:10px;border-radius:12px;background:#F0FDFA;color:#0D9488">{ic(icon,24)}</div>'
           f'<div><h1 style="font-size:23px;font-weight:700;letter-spacing:-.02em;margin:0;color:#1E293B">{title}</h1><div class="sm mut" style="margin-top:2px">{sub}</div></div></div><div class="row" style="gap:10px;flex-wrap:wrap">{actions}</div></div></div>')
    return (f'<div style="width:{W}px;height:{H}px;display:flex;background:#FAFAF9;overflow:hidden;position:relative">{sidebar(active,pill)}'
            f'<div style="flex:1;display:flex;flex-direction:column;min-width:0">{topbar()}<main style="flex:1;overflow:hidden"><div style="padding:24px;max-width:1600px;margin:0 auto">{hdr}{body}</div></main></div></div>')

def dc(body, W, H, extra_css=""):
    return ('<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
            f'  {FONT}\n  <style>{BASE_CSS}{extra_css}</style>\n</helmet>\n{body}\n</x-dc>\n</body>\n</html>\n')

ARTBOARDS=[]
def write(name, html, W, H, title=None, print_mode=None, page_id=None):
    open(f"{name}.dc.html","w").write(html)
    e={"file":f"{name}.dc.html","w":W,"h":H}
    if title: e["title"]=title
    if print_mode: e["print"]=print_mode
    if page_id: e["page"]=page_id
    ARTBOARDS.append(e)
