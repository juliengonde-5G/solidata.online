# -*- coding: utf-8 -*-
from gen import *

def obligation(txt, who, delay, tone="red", act="Traiter"):
    return (f'<div class="line {tone}"><div class="row" style="gap:10px;min-width:0"><span class="dot" style="background:{"#DC2626" if tone=="red" else "#D97706"}"></span>'
            f'<div style="min-width:0"><div class="sb" style="font-size:13px">{txt}</div><div class="xs mut">{who}</div></div></div>'
            f'<div class="row" style="gap:8px;flex-shrink:0"><span class="xs b" style="color:{"#B91C1C" if tone=="red" else "#B45309"}">{delay}</span>{btn(act,"s","",extra="btn-sm")}{btn("Reporter 48 h","g","",extra="btn-sm")}</div></div>')

def rdv(h, who, what, ia=False):
    b = badge("Préparation IA prête","violet") if ia else ""
    return f'<div class="line"><div class="row"><span class="sb" style="width:44px;color:#0F766E">{h}</span><div><div class="sb">{who}</div><div class="xs mut">{what}</div></div></div>{b}</div>'

def file_active(rows, filt="En parcours + sortis < 7 mois"):
    lines=[]
    for nom, rdv_, risk, tags in rows:
        d = {"rouge":"#DC2626","orange":"#D97706","ok":"#CBD5E1"}[risk]
        t = "".join(badge(x, "teal" if x=="ASI" else ("indigo" if x=="OCS" else "slate")) for x in tags)
        lines.append(f'<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid #F1F5F9"><span class="dot" style="background:{d}"></span><div style="flex:1;min-width:0"><div class="sb" style="font-size:13px">{nom}</div><div class="xs mut">{rdv_}</div></div><div class="row" style="gap:4px">{t}</div></div>')
    return (f'<div class="card" style="padding:14px;height:100%"><div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="b" style="font-size:14px">Ma file active <span class="mut" style="font-weight:500">(38)</span></div>{btn("Tableau de bord","g","",extra="btn-sm")}</div>'
            f'<div class="row" style="gap:6px;margin-bottom:8px"><div style="flex:1;position:relative">{ic("search",14,color="#94A3B8")}<input class="inp" style="padding-left:30px" placeholder="Rechercher un salarié"></div></div>'
            f'<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px"><span class="badge b-teal">{filt}</span><span class="badge b-slate">Mes salariés</span><span class="badge b-slate">ASI</span><span class="badge b-slate">BRSA</span><span class="badge b-slate">Sans RDV</span><span class="badge b-slate">Fin &lt; 60 j</span><span class="badge b-slate">Risque</span></div>'
            f'<div class="col" style="gap:4px">{"".join(lines)}</div><div class="xs mut" style="margin-top:8px;text-align:center">… et 30 autres</div></div>')

ROWS = [("BENALI Karim","Bilan n° 3 · aujourd'hui 10:00","rouge",["BRSA","ASI"]),("DUPONT Léa","Fin de contrat 28/09","rouge",["OCS"]),("MARTIN Sofiane","Sortie 21/08 · à saisir","rouge",["BRSA","ASI"]),("NDIAYE Awa","Bilan n° 1 · 15/09","orange",["ASI"]),("ROUSSEL Marc","Point référent · 17/09","ok",["BRSA"]),("KOVAC Ivana","PMSMP en cours","ok",["OCS"]),("PETIT Julien","Renouvellement · 02/10","orange",["OCS"]),("GARCIA Inès","Aucun RDV planifié","orange",["ASI","BRSA"])]

def echeances_charge():
    obligations = "".join([
        obligation("Sortie FSE+ à saisir avant le 21/09","MARTIN Sofiane · contrat terminé le 21/08 · projet ASI","J+22","red","Saisir la sortie"),
        obligation("Pass IAE expiré","LAMBERT Chloé · fin le 05/09 · statut inconnu","expiré","red","Mettre à jour"),
        obligation("CDDI 23 mois sans dérogation","DUPONT Léa · fin de contrat 28/09","16 j","red","Renseigner"),
        obligation("Référent unique non renseigné","GARCIA Inès · BRSA · orientée par le CMS Grand-Quevilly","—","red","Compléter"),
        obligation("Questionnaire FSE+ d'entrée manquant","NDIAYE Awa · entrée le 18/08 · projet ASI","J+25","red","Compléter"),
        obligation("Suivi à +6 mois échu","BOUCHER Théo · sorti le 10/03","J+6","red","Contacter"),
        obligation("Catégorie France Travail G depuis 41 jours","ROUSSEL Marc · en attente d'orientation","41 j","amber","Signaler au référent"),
        obligation("2 salariés sous 15 h deux semaines de suite","KOVAC Ivana, PETIT Julien · semaines 35-36","—","amber","Voir"),
    ])
    today = "".join([rdv("09:00","NDIAYE Awa","Bilan n° 1 (45 min)",True),rdv("10:00","BENALI Karim","Bilan n° 3 (45 min)",True),rdv("11:30","PETIT Julien","Point avec le référent · CMS · tripartite"),rdv("14:00","KOVAC Ivana","Entretien de sortie (60 min)")])
    week = "".join([rdv("Mar.","GARCIA Inès","Diagnostic d'accueil · J-1 · 9:30"),rdv("Jeu.","ROUSSEL Marc","Bilan n° 2 · J-3 · 14:00"),rdv("Ven.","LAMBERT Chloé","Entretien de conciliation (protection des droits)")])
    suivi = "".join([
        f'<div class="line"><div><div class="sb">Renouvellement · DUPONT Léa</div><div class="xs mut">Fin de contrat 28/09 · avis encadrant reçu</div></div><div class="row" style="gap:6px">{badge("J-16","amber")}{btn("Ouvrir","s","",extra="btn-sm")}</div></div>',
        f'<div class="line"><div><div class="sb">Renouvellement · PETIT Julien</div><div class="xs mut">Fin de contrat 02/10 · formulaire encadrant à remplir</div></div><div class="row" style="gap:6px">{badge("J-20","amber")}{btn("Copier le lien encadrant","s","link",extra="btn-sm")}</div></div>',
        f'<div class="line"><div><div class="sb">3 entretiens en retard</div><div class="xs mut">HAMDI Yacine (12 j), FERREIRA Ana (8 j), LEROY Paul (3 j)</div></div>{btn("Voir","g","",extra="btn-sm")}</div>',
        f'<div class="line"><div><div class="sb">2 actions critiques en retard</div><div class="xs mut">Dossier logement · Rendez-vous auto-école sociale</div></div>{btn("Voir","g","",extra="btn-sm")}</div>',
    ])
    rappels = "".join([
        f'<div class="line gray"><div><div class="sb">Actualisation France Travail à confirmer</div><div class="xs mut">4 salariés dont le référent est France Travail · avant le 15/09</div></div>{btn("Cocher","g","",extra="btn-sm")}</div>',
        f'<div class="line gray"><div><div class="sb">Point avec le référent à prévoir</div><div class="xs mut">BENALI Karim · dernier point le 12/06 (3 mois)</div></div>{btn("Planifier","g","",extra="btn-sm")}</div>',
        f'<div class="line gray"><div><div class="sb">Déclaration trimestrielle de ressources (CAF)</div><div class="xs mut">Rappel informatif · avant fin septembre · 11 BRSA</div></div><span class="xs mut">rappel</span></div>',
    ])
    kpis = (f'<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">{kpi("En parcours","38","#1D4ED8","dont 11 BRSA · 14 ASI")}{kpi("Entretiens en retard","3","#B91C1C","7 % des échéances")}{kpi("À venir (7 j)","7","#B45309","4 aujourd’hui")}{kpi("Sorties dynamiques 2026","9 / 14","#047857","64 % · objectif non paramétré")}</div>')
    right = (f'<div class="col" style="gap:14px">'
             + sec("Aujourd'hui / Cette semaine", f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div><div class="xs b mut" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Aujourd’hui (4)</div><div class="col" style="gap:6px">{today}</div></div><div><div class="xs b mut" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Cette semaine (3)</div><div class="col" style="gap:6px">{week}</div></div></div>', icon="cal")
             + sec("À traiter cette semaine — obligations", f'<div class="col" style="gap:6px">{obligations}</div>', actions=badge("6 rouges · 2 orange","red"), icon="alert", sub="Un report de 48 h est possible ; le motif est demandé au second report.")
             + sec("Organisation du suivi", f'<div class="col" style="gap:6px">{suivi}</div>', icon="list")
             + sec("Rendez-vous réguliers et rappels", f'<div class="col" style="gap:6px">{rappels}</div>', icon="bell")
             + f'<div>{kpis}</div></div>')
    body = f'<div style="display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start">{file_active(ROWS)}{right}</div>'
    actions = btn("+ Action","p","plus")+btn("Exports","s","down")+btn("Proposition de synthèse (IA)","s","spark")
    return page("Espace CIP — Mes échéances","Lundi 14 septembre 2026 · ce qui doit être fait cette semaine, et ce qui met un dossier en risque", body, actions=actions, H=2140)

def echeances_calme():
    empty = lambda t: f'<div style="padding:14px;border-radius:10px;background:#ECFDF5;border:1px solid #A7F3D0;color:#047857;font-size:13px;font-weight:600" class="row">{ic("check",16)}{t}</div>'
    today = "".join([rdv("14:00","ROUSSEL Marc","Bilan n° 2 (45 min)",True)])
    right = (f'<div class="col" style="gap:14px">'
             + sec("Aujourd'hui / Cette semaine", f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div><div class="xs b mut" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Aujourd’hui (1)</div><div class="col" style="gap:6px">{today}</div></div><div><div class="xs b mut" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Cette semaine (0)</div>{empty("Aucun autre entretien planifié cette semaine.")}</div></div>', icon="cal")
             + sec("À traiter cette semaine — obligations", empty("Aucune obligation en attente : tous les dossiers FSE+ sont à jour, aucun Pass IAE n'expire dans les 2 mois, chaque BRSA a un référent renseigné."), actions=badge("0","green"), icon="alert")
             + sec("Organisation du suivi", f'<div class="col" style="gap:6px"><div class="line"><div><div class="sb">Renouvellement · PETIT Julien</div><div class="xs mut">Fin de contrat 02/10 · formulaire encadrant à remplir</div></div><div class="row" style="gap:6px">{badge("J-20","amber")}{btn("Copier le lien encadrant","s","link",extra="btn-sm")}</div></div>{empty("Aucun entretien ni action en retard.")}</div>', icon="list")
             + sec("Rendez-vous réguliers et rappels", f'<div class="col" style="gap:6px"><div class="line gray"><div><div class="sb">Déclaration trimestrielle de ressources (CAF)</div><div class="xs mut">Rappel informatif · avant fin septembre · 11 BRSA</div></div><span class="xs mut">rappel</span></div></div>', icon="bell")
             + f'<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">{kpi("En parcours","38","#1D4ED8","dont 11 BRSA · 14 ASI")}{kpi("Entretiens en retard","0","#047857","0 % des échéances")}{kpi("À venir (7 j)","1","#B45309","")}{kpi("Sorties dynamiques 2026","9 / 14","#047857","64 % · objectif non paramétré")}</div></div>')
    rows=[(n,r,"ok",t) for n,r,_,t in ROWS]
    body = f'<div style="display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start">{file_active(rows)}{right}</div>'
    return page("Espace CIP — Mes échéances","Lundi 5 octobre 2026 · un lundi calme", body, pill=0, actions=btn("+ Action","p","plus")+btn("Exports","s","down"), H=1250)

def header_fiche(open_menu=False):
    menu = ""
    if open_menu:
        item = lambda t,d: f'<div style="padding:8px 12px;border-radius:8px"><div class="sb" style="font-size:13px">{t}</div><div class="xs mut">{d}</div></div>'
        grp = lambda t,items: f'<div style="padding:6px 12px 2px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94A3B8">{t}</div>{items}'
        menu = ('<div style="position:absolute;right:0;top:40px;width:340px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 10px 24px -4px rgb(15 23 42/.12);padding:6px;z-index:5">'
                + grp("Pour le salarié", item("Mon parcours en une page","Français simple · engagements, heures, prochain RDV, référent")+item("Exemplaire salarié du dernier bilan","FALC, sans champs internes"))
                + grp("Pour le référent unique (CMS / France Travail)", item("Fiche pour le référent","9 rubriques · santé et judiciaire jamais inclus")+item("Relevé d'assiduité","Entretiens, actions, absences et motifs légitimes")+item("Récapitulatif de parcours","Étapes datées, partageable"))
                + grp("Pour le dossier", item("Fiche parcours complète","Dossier interne")+item("Bilan de prolongation Pass IAE","À déposer sur les Emplois de l'inclusion"))
                + '</div>')
    badges = "".join([badge("Parcours n° 1","slate"),badge("Pass IAE actif · fin 14/03/2027","teal"),badge("CDDI 14 / 24 mois","amber"),badge("BRSA","indigo"),badge("Projet ASI","teal"),badge("Référent unique : CMS Grand-Quevilly","blue"),badge("PCM recrutement","slate")])
    alerts = (f'<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px"><span class="line amber" style="padding:5px 10px;font-size:12px"><span class="dot" style="background:#D97706"></span>Point avec le référent à prévoir (3 mois)</span><span class="line gray" style="padding:5px 10px;font-size:12px"><span class="dot" style="background:#94A3B8"></span>Semaine 36 : 14 h (arrêt maladie déclaré)</span></div>')
    return (f'<div class="card" style="padding:18px 20px;margin-bottom:16px;position:relative"><div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">'
            f'<div><div class="row" style="gap:10px"><div style="width:44px;height:44px;border-radius:12px;background:#0D9488;color:#fff;display:grid;place-items:center;font-weight:700">KB</div><div><div style="font-size:19px;font-weight:700">BENALI Karim</div><div class="sm mut">Agent de tri · équipe Tri chaîne 1 · entré le 15/07/2025 · CIP référente : Nadia B.</div></div></div>'
            f'<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">{badges}</div>{alerts}</div>'
            f'<div class="row" style="gap:8px;flex-shrink:0;position:relative">{btn("+ Action","p","plus")}{btn("+ Entretien","s","cal")}<span class="btn btn-s" style="{"border-color:#0D9488;color:#0F766E" if open_menu else ""}">{ic("file",14)}Documents PDF {ic("chev",14)}</span>{menu}</div></div></div>')

def tabs(on):
    t = ["Situation","Suivi","Dossier administratif","Diagnostic"]
    return '<div class="tabs">'+"".join(f'<span class="tab {"on" if x==on else ""}">{x}</span>' for x in t)+'</div>'

def radar_svg(size=250):
    import math
    axes=["Mobilité","Santé","Finances","Famille","Langue","Administratif","Numérique","Logement","Judiciaire"]
    entree=[4,2,4,2,3,4,2,5,None]; last=[2,2,3,2,2,2,2,3,None]
    cx=cy=size/2; R=size/2-40
    def pt(i,v): a=-math.pi/2+2*math.pi*i/9; r=R*v/5; return (cx+r*math.cos(a), cy+r*math.sin(a))
    grid="".join(f'<polygon points="{" ".join(f"{pt(i,k)[0]:.1f},{pt(i,k)[1]:.1f}" for i in range(9))}" fill="none" stroke="#E2E8F0"/>' for k in (1,2,3,4,5))
    lab="".join(f'<text x="{pt(i,5.9)[0]:.1f}" y="{pt(i,5.9)[1]:.1f}" font-size="9.5" fill="#64748B" text-anchor="middle" dominant-baseline="middle">{a}</text>' for i,a in enumerate(axes))
    def poly(vals,col,fill):
        pts=[pt(i,v) for i,v in enumerate(vals) if v is not None]
        return f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x,y in pts)}" fill="{fill}" stroke="{col}" stroke-width="2"/>'
    return f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">{grid}{poly(entree,"#94A3B8","rgba(148,163,184,.15)")}{poly(last,"#0D9488","rgba(13,148,136,.2)")}{lab}</svg>'

def fiche_situation():
    deltas=[("Logement",5,3,"levé en partie","green"),("Administratif",4,2,"levé","green"),("Mobilité",4,2,"levé","green"),("Finances",4,3,"en cours","amber"),("Langue",3,2,"levé","green"),("Santé",2,2,"stable","slate"),("Judiciaire","—","—","non évalué (art. 10)","slate")]
    rows="".join(f'<tr><td class="sb">{a}</td><td>{e}</td><td>{l}</td><td>{badge(s,t)}</td></tr>' for a,e,l,s,t in deltas)
    freins = (f'<div style="display:grid;grid-template-columns:270px 1fr;gap:18px;align-items:center"><div>{radar_svg()}<div class="xs mut" style="text-align:center">gris : diagnostic d’accueil · teal : bilan n° 3 (12/06)</div></div>'
              f'<table class="tbl"><thead><tr><th>Frein</th><th>Entrée</th><th>Dernière éval.</th><th>Évolution</th></tr></thead><tbody>{rows}</tbody></table></div>')
    note = ('<div class="row" style="justify-content:space-between"><div class="sm">Note de profil initial générée le 20/07/2025 · prise de connaissance le 22/07/2025 · <span class="mut">analyse IA, jamais une décision</span></div>'+btn("Ouvrir","g","",extra="btn-sm")+'</div>')
    frise = ('<div style="position:relative;height:110px;background:#F8FAFC;border-radius:10px;padding:10px 14px">'
             '<div class="xs mut" style="display:flex;justify-content:space-between"><span>07/2025</span><span>10/2025</span><span>01/2026</span><span>04/2026</span><span>07/2026</span><span>10/2026</span></div>'
             '<div style="position:absolute;left:14px;right:14px;top:34px;height:8px;border-radius:4px;background:#CBD5E1"><div style="position:absolute;left:0;width:48%;height:100%;border-radius:4px;background:#0D9488"></div><div style="position:absolute;left:48%;width:44%;height:100%;border-radius:4px;background:#14B8A6"></div></div>'
             '<div class="xs" style="position:absolute;left:14px;top:46px;color:#0F766E">CDDI 1 (6 mois)</div><div class="xs" style="position:absolute;left:52%;top:46px;color:#0F766E">CDDI 2 (renouvelé 6 mois)</div>'
             + "".join(f'<div style="position:absolute;left:{l}%;top:66px;width:12px;height:12px;border-radius:50%;background:{c};border:2px solid #fff;box-shadow:0 0 0 1px {c}"></div>' for l,c in [(4,"#0D9488"),(14,"#3B82F6"),(26,"#3B82F6"),(40,"#F59E0B"),(52,"#3B82F6"),(66,"#3B82F6"),(80,"#F59E0B"),(90,"#3B82F6")])
             + '<div style="position:absolute;left:66%;top:84px" class="xs mut">PMSMP Renault Ampère (10 j)</div><div style="position:absolute;left:87%;top:20px;width:2px;height:70px;background:#EF4444"></div><div class="xs" style="position:absolute;left:88%;top:20px;color:#B91C1C">aujourd’hui</div></div>'
             '<div class="row" style="gap:12px;margin-top:8px" class="xs">'+"".join(f'<span class="xs row" style="gap:4px"><span class="dot" style="background:{c}"></span>{t}</span>' for c,t in [("#0D9488","Diagnostic"),("#3B82F6","Bilan"),("#F59E0B","Renouvellement"),("#8B5CF6","Sortie")])+'<span class="xs mut" style="margin-left:auto">Voir le détail chronologique</span></div>')
    heures = (f'<div class="row" style="gap:18px"><div style="flex:1"><div class="xs mut">Semaine 37 · activité</div><div class="row" style="gap:8px"><span class="b" style="font-size:20px">27,5 h</span><span class="xs mut">26 h travail + 1,5 h accompagnement</span></div></div><div style="width:200px"><div class="bar"><i style="width:100%"></i></div><div class="xs mut" style="margin-top:4px">objectif d’activité couvert par le contrat de travail</div></div></div>')
    pmsmp = f'<div class="line"><div><div class="sb">PMSMP · Renault Ampère (Cléon)</div><div class="xs mut">02/06 → 12/06/2026 · 10 j · cumul 12 mois : 10 / 60 j · débouché : proposition d’intérim</div></div>{badge("Immersion Facilitée saisie","green")}</div>'
    body = (header_fiche(open_menu=True)+tabs("Situation")
            + f'<div class="col" style="gap:14px">'
            + sec("Freins périphériques", freins, actions=btn("Évaluer dans un entretien","g","",extra="btn-sm"), icon="chart", sub="1 = pas de difficulté · 5 = bloquant · le judiciaire n’est jamais suggéré ni exporté")
            + sec("Note de profil initial", note, icon="spark")
            + sec("Parcours", frise, icon="cal")
            + f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">{sec("Activité hebdomadaire", heures, icon="clock")}{sec("Immersions (PMSMP)", pmsmp, actions=btn("+ PMSMP","g","",extra="btn-sm"), icon="bld")}</div>'
            + f'<div class="row" style="justify-content:flex-end">{btn("Proposition de synthèse (IA)","s","spark")}</div></div>')
    return page("Espace CIP — BENALI Karim","Fiche en milieu de parcours · 14 mois · 7 entretiens · 2 renouvellements · 1 PMSMP · 12 actions", body, H=1720)

def fiche_suivi_cloture():
    ent=[("Bilan n° 3","12/06/2026","réalisé","45 min","green"),("Point avec le référent (tripartite, CMS)","12/06/2026","réalisé","30 min","green"),("Renouvellement CDDI","03/01/2026","réalisé · triple validation","30 min","green"),("Bilan n° 2","10/11/2025","réalisé","50 min","green"),("Diagnostic d'accueil","05/08/2025","réalisé","90 min","green"),("Entretien de période d'essai","28/07/2025","réalisé · confirmée","30 min","green"),("Bilan n° 4","14/09/2026","en cours","—","amber")]
    rows="".join(f'<tr><td class="sb">{t}</td><td>{d}</td><td>{badge(s,c)}</td><td class="mut">{m}</td></tr>' for t,d,s,m,c in ent)
    entretiens = f'<table class="tbl"><thead><tr><th>Entretien</th><th>Date</th><th>Statut</th><th>Durée</th></tr></thead><tbody>{rows}</tbody></table>'
    acts=[("Rendez-vous auto-école sociale (code)","Mobilité","Auto-école sociale Rouen","en cours","30/09"),("Dossier DALO déposé","Logement","SOLIHA · orientation DORA","fait","15/06"),("Atelier budget (2 séances)","Finances","CCAS · orientation DORA","planifié","08/10"),("Job dating Job 76 « Démarquez-vous »","Insertion","Département · Job 76","planifié","22/09")]
    arows="".join(f'<tr><td class="sb">{a}</td><td>{badge(f,"slate")}</td><td class="mut">{p}</td><td>{badge(s,"green" if s=="fait" else ("amber" if s=="en cours" else "blue"))}</td><td class="mut">{e}</td></tr>' for a,f,p,s,e in acts)
    actions = f'<table class="tbl"><thead><tr><th>Action</th><th>Frein</th><th>Partenaire / DORA</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>{arows}</tbody></table>'
    objectifs = '<div class="col" style="gap:6px"><div class="line"><div><div class="sb">Obtenir le permis B</div><div class="xs mut">origine : salarié · 2 sous-objectifs · butoir 03/2027</div></div>'+badge("en cours","amber")+'</div><div class="line"><div><div class="sb">Stabiliser le logement</div><div class="xs mut">origine : CIP · lié au frein logement</div></div>'+badge("atteint en partie","green")+'</div></div>'
    modal = ('<div style="position:absolute;inset:0;background:rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;z-index:20">'
             '<div style="width:560px;background:#fff;border-radius:16px;box-shadow:0 20px 40px -8px rgb(15 23 42/.3);padding:22px 24px">'
             '<div style="font-size:17px;font-weight:700">Clôturer le bilan n° 4</div><div class="sm mut" style="margin-top:2px">Une fois clôturé, l’entretien est verrouillé ; une réouverture est tracée.</div>'
             '<div style="margin-top:16px"><span class="lbl">Date de l’entretien</span><div class="row"><input class="inp" style="width:160px" value="14/09/2026"><input class="inp" style="width:90px" value="10:00"></div></div>'
             '<div style="margin-top:14px"><span class="lbl">Durée <span class="mut" style="font-weight:400">(valeur proposée pour un bilan : 45 min)</span></span><div class="row" style="gap:6px;flex-wrap:wrap">'
             + "".join(f'<span class="chip {"on" if v=="45" else ""}">{v} min</span>' for v in ["15","30","45","60","90"]) + '<span class="chip">autre</span></div></div>'
             '<div style="margin-top:14px"><span class="lbl">Présence</span><div class="row" style="gap:6px"><span class="chip on">Présent</span><span class="chip">Absent</span><span class="chip">Excusé</span></div></div>'
             '<div style="margin-top:14px"><span class="lbl">Prochain entretien</span><div class="row"><select class="inp" style="width:220px"><option>Bilan n° 5</option></select><input class="inp" style="width:160px" value="14/11/2026"><span class="xs mut">rythme : 2 mois</span></div></div>'
             '<div style="margin-top:14px" class="row"><input type="checkbox" checked> <span class="sm">Relu avec le salarié — exemplaire salarié à remettre</span></div>'
             '<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#ECFDF5;border:1px solid #A7F3D0;font-size:12.5px;color:#047857" class="row">'+ic("check",14)+'Prêt à clôturer : freins évalués (9/9), éléments du bilan précédent statués (4/4), objectifs revus.</div>'
             '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:18px">'+btn("Annuler","g")+btn("Clôturer et planifier","p","check")+'</div>'
             '<div class="xs mut" style="margin-top:8px;text-align:right">4 clics : durée · présence · prochain entretien · clôturer</div></div></div>')
    body = (header_fiche()+tabs("Suivi")
            + f'<div class="col" style="gap:14px">'
            + sec("Entretiens et bilans", entretiens, actions=btn("+ Entretien","s","cal",extra="btn-sm"), icon="cal")
            + f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">{sec("Objectifs", objectifs, actions=btn("+ Objectif","g","",extra="btn-sm"), icon="star")}{sec("Notes de suivi", "<div class=’sm mut’>Dernière note : 09/09 — « Appel du CMS : rendez-vous logement obtenu le 24/09 » · 6 notes · chiffrées, ADMIN/RH</div>", actions=btn("+ Note","g","",extra="btn-sm"), icon="pen")}</div>'
            + sec("Actions", actions, actions=btn("+ Action","p","plus",extra="btn-sm"), icon="list")
            + '</div>')
    html = page("Espace CIP — BENALI Karim","Onglet Suivi · fenêtre de clôture d’un bilan avec le champ durée", body, H=1500)
    html = html.replace('<div style="width:1366px;height:1500px;display:flex;background:#FAFAF9;overflow:hidden;position:relative">', '<div style="width:1366px;height:1500px;display:flex;background:#FAFAF9;overflow:hidden;position:relative">'+modal, 1)
    return html

def build():
    write("Main", dc(echeances_charge(),1366,2140), 1366, 2140, "1 · Mes échéances — lundi chargé")
    write("Echeances_Calme", dc(echeances_calme(),1366,1250), 1366, 1250, "2 · Mes échéances — jour calme")
    write("Fiche_Situation", dc(fiche_situation(),1366,1720), 1366, 1720, "3 · Fiche salarié — Situation + menu PDF")
    write("Fiche_Suivi_Cloture", dc(fiche_suivi_cloture(),1366,1500), 1366, 1500, "7 · Fiche — Suivi + clôture de bilan (durée)")
