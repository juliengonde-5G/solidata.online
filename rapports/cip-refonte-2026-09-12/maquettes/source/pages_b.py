# -*- coding: utf-8 -*-
from gen import *
from pages_a import header_fiche, tabs

def field(label, value, w="", ph=False):
    v = f'<input class="inp" value="{value}">' if not ph else f'<input class="inp" placeholder="{value}">'
    return f'<div style="{w}"><span class="lbl">{label}</span>{v}</div>'
def sel(label, value, w=""):
    return f'<div style="{w}"><span class="lbl">{label}</span><select class="inp"><option>{value}</option></select></div>'
def piece(t, state, detail, tone):
    icon = {"green":ic("check",14,color="#047857"),"red":ic("x",14,color="#B91C1C"),"amber":ic("alert",14,color="#B45309"),"slate":ic("info",14,color="#94A3B8")}[tone]
    bg = {"green":"#ECFDF5","red":"#FEF2F2","amber":"#FFFBEB","slate":"#F8FAFC"}[tone]
    return f'<div class="line" style="background:{bg};border-color:transparent"><div class="row" style="gap:8px">{icon}<div><div class="sb" style="font-size:13px">{t}</div><div class="xs mut">{detail}</div></div></div>{badge(state,tone)}</div>'

def dossier(vide=False):
    if not vide:
        crit = "".join(f'<span class="chip {"on" if on else ""}">{ic("check",14) if on else ""}{c}</span>' for c,on in [("BRSA",True),("ASS",False),("AAH",False),("DELD",True),("DETLD",False),("Jeune −26",False),("Senior 50+",False),("RQTH",False),("QPV",True),("ZRR",False),("Réfugié / BPI",False),("Sortant de détention",False),("Parent isolé",False),("Sans domicile stable",False)])
        elig = (f'<div class="row" style="gap:6px;flex-wrap:wrap">{crit}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">{field("Date de vérification","10/07/2025")}{sel("Source","Prescripteur habilité (CMS)")}{field("Référence des justificatifs (localisation)","Dossier Emplois de l’inclusion n° 4471-K")}</div>'
                '<div class="xs mut" style="margin-top:8px">Les justificatifs restent sur les Emplois de l’inclusion : l’outil en garde la référence, jamais la copie.</div>'
                '<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#F8FAFC;border:1px dashed #CBD5E1"><div class="row" style="justify-content:space-between"><div class="sb sm">Bloc à coller sur les Emplois de l’inclusion</div>'+btn("Copier","g","copy",extra="btn-sm")+'</div><div class="xs mut" style="font-family:ui-monospace,monospace;margin-top:4px">Critères : BRSA ; DELD ; QPV · Prescripteur : CMS Grand-Quevilly · Pass IAE : 2025-07-0918 · début 15/07/2025 · fin 14/03/2027</div></div>')
        pas = (f'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">{field("Numéro","2025-07-0918")}{field("Début","15/07/2025")}{field("Fin","14/03/2027")}{sel("Statut","Actif")}</div>'
               '<table class="tbl" style="margin-top:12px"><thead><tr><th>Événement</th><th>Du</th><th>Au</th><th>Motif</th><th>Réf. Emplois de l’inclusion</th></tr></thead><tbody>'
               '<tr><td>Prolongation</td><td>15/07/2026</td><td>14/03/2027</td><td>Formation en cours (code de la route)</td><td class="mut">PROL-2026-118</td></tr>'
               '<tr><td>Suspension</td><td>03/02/2026</td><td>28/02/2026</td><td>Arrêt maladie &gt; 15 j</td><td class="mut">SUSP-2026-041</td></tr></tbody></table>'
               f'<div class="row" style="gap:8px;margin-top:10px">{btn("+ Événement","g","plus",extra="btn-sm")}{btn("Bilan de prolongation (PDF)","s","file",extra="btn-sm")}</div>')
        orient = (f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{sel("Orienteur","Département — CMS Grand-Quevilly")}{sel("Prescripteur habilité","CMS Grand-Quevilly (type CD)")}{sel("Référent unique","CMS — Mme L. (travailleuse sociale)")}{field("Contact du référent","02 35 00 00 00 · l.martin@seinemaritime.fr")}</div>'
                  '<div class="row" style="gap:16px;margin-top:10px"><label class="row sm"><input type="checkbox"> Actualisation mensuelle France Travail requise</label><span class="xs mut">(le référent n’est pas France Travail)</span></div>')
        statuts = (f'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">{sel("Bénéficiaire du RSA","Oui — constaté le 10/07/2025")}{sel("Catégorie France Travail","F — sociale (le 01/09/2025)")}{field("Identifiant France Travail","7612345A")}{field("RQTH","non (diagnostic)")}</div><div class="xs mut" style="margin-top:6px">Statuts sociaux : visibles ADMIN/RH uniquement, jamais en lecture encadrant.</div>')
        projets = ('<table class="tbl"><thead><tr><th>Projet cofinancé</th><th>Entrée</th><th>Sortie</th><th>Obligations</th></tr></thead><tbody>'
                   f'<tr><td class="sb">ASI 2026-2027 (Accompagnement Social Intensif, FSE+ 60 % / CD76 40 %)</td><td>01/01/2026</td><td class="mut">—</td><td>{badge("questionnaires entrée / sortie / +6 mois","teal")}</td></tr>'
                   f'<tr><td class="sb">Postes CIP en OCS 2026-2027</td><td>01/01/2026</td><td class="mut">—</td><td>{badge("temps d’accompagnement imputé","indigo")}</td></tr></tbody></table>')
        conf = "".join([piece("Éligibilité IAE référencée","complet","3 critères · vérifiée le 10/07/2025","green"),piece("Pass IAE","complet","actif · fin 14/03/2027","green"),piece("Référent unique","complet","CMS Grand-Quevilly","green"),piece("Questionnaire FSE+ d’entrée","complet","5/5 items · saisi le 05/08/2025","green"),piece("Diagnostic d’accueil (socle)","complet","7/7 rubriques · 05/08/2025 (J+21)","green"),piece("Questionnaire FSE+ de sortie","sans objet","parcours en cours","slate"),piece("Statut de sortie saisi dans le mois","sans objet","parcours en cours","slate"),piece("Suivi à +6 mois","sans objet","parcours en cours","slate"),piece("Remise des documents tracée","complet","6 remises · dernière le 12/06/2026","green")])
        derog = f'<div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px">{sel("Motif de dérogation > 24 mois","— aucune (14/24 mois)")}{field("Date","")}<div class="xs mut" style="align-self:end">Requis seulement au-delà de 24 mois cumulés de CDDI (L. 5132-15-1).</div></div>'
        sub = "Dossier complet · 9 pièces sur 9"
    else:
        crit = "".join(f'<span class="chip">{c}</span>' for c in ["BRSA","ASS","AAH","DELD","DETLD","Jeune −26","Senior 50+","RQTH","QPV","ZRR","Réfugié / BPI","Sortant de détention","Parent isolé","Sans domicile stable"])
        elig = (f'<div class="row" style="gap:6px;flex-wrap:wrap">{crit}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">{field("Date de vérification","jj/mm/aaaa",ph=True)}{sel("Source","— à renseigner")}{field("Référence des justificatifs (localisation)","ex. dossier Emplois de l’inclusion n°…",ph=True)}</div>'
                '<div class="xs mut" style="margin-top:8px">Cochez les critères constatés sur les Emplois de l’inclusion. Rien n’est obligatoire ici pour continuer : le dossier vous dit ce qui manque, il ne vous bloque pas.</div>')
        pas = f'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">{field("Numéro","",ph=True)}{field("Début","jj/mm/aaaa",ph=True)}{field("Fin","jj/mm/aaaa",ph=True)}{sel("Statut","Inconnu")}</div><div class="xs mut" style="margin-top:8px">Sans numéro de Pass, aucune alerte d’échéance ne peut être calculée.</div>'
        orient = f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">{sel("Orienteur","— à renseigner")}{sel("Prescripteur habilité","— à renseigner")}{sel("Référent unique","— non déterminé")}{field("Contact du référent","",ph=True)}</div><div class="xs" style="margin-top:8px;color:#B91C1C">Référent unique non déterminé : à signaler au Département si la personne est BRSA.</div>'
        statuts = f'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">{sel("Bénéficiaire du RSA","— non renseigné")}{sel("Catégorie France Travail","— non renseignée")}{field("Identifiant France Travail","",ph=True)}{field("RQTH","non renseigné")}</div>'
        projets = f'<div class="line gray"><div class="sm mut">Aucun rattachement à un projet cofinancé.</div>{btn("Rattacher à un projet","g","plus",extra="btn-sm")}</div>'
        conf = "".join([piece("Éligibilité IAE référencée","à faire","aucun critère coché","red"),piece("Pass IAE","à faire","numéro absent","red"),piece("Référent unique","à faire","non déterminé","red"),piece("Questionnaire FSE+ d’entrée","à faire","0/5 items · attendu sous 30 j","red"),piece("Diagnostic d’accueil (socle)","en cours","2/7 rubriques · J+6","amber"),piece("Questionnaire FSE+ de sortie","sans objet","parcours en cours","slate"),piece("Statut de sortie saisi dans le mois","sans objet","parcours en cours","slate"),piece("Suivi à +6 mois","sans objet","parcours en cours","slate"),piece("Remise des documents tracée","à faire","aucune remise","amber")])
        derog = f'<div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px">{sel("Motif de dérogation > 24 mois","— sans objet (0/24 mois)")}{field("Date","")}<div class="xs mut" style="align-self:end">Requis seulement au-delà de 24 mois cumulés de CDDI.</div></div>'
        sub = "Dossier vide · 4 pièces à compléter, 2 en cours · rien n’est bloquant"
    body = (header_fiche() if not vide else header_fiche().replace("BENALI Karim","GARCIA Inès").replace("KB","GI").replace("Agent de tri · équipe Tri chaîne 1 · entré le 15/07/2025","Agente de tri · équipe Tri chaîne 2 · entrée le 08/09/2026"))
    if vide:
        body = body.replace('Pass IAE actif · fin 14/03/2027','Pass IAE non renseigné').replace('b-teal">Pass','b-red">Pass').replace("CDDI 14 / 24 mois","CDDI 0 / 24 mois").replace('Référent unique : CMS Grand-Quevilly','Référent unique : non déterminé').replace('b-blue">Référent','b-red">Référent').replace("Point avec le référent à prévoir (3 mois)","Diagnostic d’accueil à terminer avant le 08/10").replace("Semaine 36 : 14 h (arrêt maladie déclaré)","Questionnaire FSE+ d’entrée manquant (projet ASI)")
    body += tabs("Dossier administratif")
    body += (f'<div style="display:grid;grid-template-columns:1fr 340px;gap:14px;align-items:start"><div class="col" style="gap:14px">'
             + sec("Éligibilité IAE", elig, icon="check", sub="Critères constatés sur les Emplois de l’inclusion — référencés, jamais recopiés")
             + sec("Pass IAE", pas, icon="shield")
             + sec("Orientation et référent unique", orient, icon="users")
             + sec("Statuts", statuts, icon="lock", sub="ADMIN / RH")
             + sec("Projets cofinancés", projets, icon="folder")
             + sec("Dérogation CDDI", derog, icon="info")
             + f'</div><div style="position:sticky;top:0">{sec("Dossier de conformité", "<div class=’col’ style=’gap:6px’>"+conf+"</div>", icon="clip", sub=sub)}</div></div>')
    return page("Espace CIP — "+("BENALI Karim" if not vide else "GARCIA Inès"), "Onglet Dossier administratif · "+("dossier complet" if not vide else "nouvelle entrante, dossier vide"), body, H=2200 if not vide else 2000)

def header_vide():
    h = header_fiche().replace("BENALI Karim","GARCIA Inès").replace("KB","GI").replace("Agent de tri · équipe Tri chaîne 1 · entré le 15/07/2025","Agente de tri · équipe Tri chaîne 2 · entrée le 08/09/2026")
    return h.replace('Pass IAE actif · fin 14/03/2027','Pass IAE non renseigné').replace('b-teal">Pass','b-red">Pass').replace("CDDI 14 / 24 mois","CDDI 0 / 24 mois").replace('Référent unique : CMS Grand-Quevilly','Référent unique : non déterminé').replace('b-blue">Référent','b-red">Référent').replace("Point avec le référent à prévoir (3 mois)","Diagnostic d’accueil à terminer avant le 08/10").replace("Semaine 36 : 14 h (arrêt maladie déclaré)","Questionnaire FSE+ d’entrée manquant (projet ASI)")

def diagnostic_fse():
    steps=["1 · Cadre administratif","2 · Logement","3 · Santé","4 · Mobilité","5 · Situation & projet pro","6 · Expression du salarié + freins","7 · Questionnaire FSE+ d’entrée"]
    rail = '<div class="col" style="gap:4px">'+"".join(f'<div class="row" style="gap:8px;padding:8px 10px;border-radius:10px;{"background:#0D9488;color:#fff;font-weight:600" if i==6 else "color:#475569"}"><span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:{"rgba(255,255,255,.25)" if i==6 else "#D1FAE5"};color:{"#fff" if i==6 else "#047857"};font-size:11px">{ic("check",11) if i<6 else "7"}</span><span class="sm">{s}</span></div>' for i,s in enumerate(steps))+'</div>'
    rail += '<div style="margin-top:14px;padding:10px;border-radius:10px;background:#F8FAFC"><div class="xs b mut" style="text-transform:uppercase;letter-spacing:.04em">Socle J+30</div><div class="bar" style="margin:6px 0"><i style="width:86%"></i></div><div class="xs mut">6 rubriques sur 7 · entré le 08/09 · à terminer avant le 08/10</div></div>'
    rail += '<div style="margin-top:10px;padding:10px;border-radius:10px;border:1px dashed #CBD5E1"><div class="xs b mut" style="text-transform:uppercase;letter-spacing:.04em">Approfondissements (plus tard)</div><div class="xs mut" style="margin-top:4px">Portefeuille & AFOM · Style d’apprentissage · Budget détaillé · Choix d’orientation — accessibles ici, jamais exigés à J+30.</div></div>'
    def q(label, options, sel_, src):
        opts = "".join(f'<span class="chip {"on" if o==sel_ else ""}">{o}</span>' for o in options)
        s = f'<div class="row" style="gap:6px;margin-top:6px"><span class="badge b-violet">{ic("spark",11)}proposé depuis « {src} »</span>{btn("Confirmer","s","check",extra="btn-sm")}{btn("Corriger","g","",extra="btn-sm")}</div>' if src else ""
        return f'<div style="padding:12px 0;border-bottom:1px solid #F1F5F9"><div class="sb" style="margin-bottom:8px">{label}</div><div class="row" style="gap:6px;flex-wrap:wrap">{opts}</div>{s}</div>'
    form = (q("Situation avant l’entrée dans la structure",["Demandeur d’emploi","Inactif","En emploi","En formation"],"Demandeur d’emploi","Situation & projet pro : inscrite à France Travail")
            + q("Durée sans emploi avant l’entrée",["< 6 mois","6 – 12 mois","12 – 24 mois","> 24 mois"],"12 – 24 mois","Situation & projet pro : dernier emploi 03/2025")
            + q("Foyer monoparental",["Oui","Non"],"Oui","Parcours & famille : 2 enfants à charge, situation « seule »")
            + q("Sans domicile stable",["Oui","Non"],"Non","Logement : locataire parc social")
            + q("Ressources principales",["RSA","ARE","AAH","ASS","Aucune","Autre"],"RSA","Cadre administratif : BRSA constaté le 08/09")
            + '<div style="padding:12px 0"><span class="lbl">Commentaire (facultatif)</span><textarea class="inp" style="min-height:60px" placeholder="Précision utile au dossier FSE+…"></textarea></div>'
            + '<div style="padding:10px 12px;border-radius:10px;background:#FFFBEB;border:1px solid #FDE68A;font-size:12.5px;color:#92400E">Ces réponses alimentent le dossier européen du projet ASI (piste d’audit ≥ 5 ans). Une fausse déclaration engage la personne : relisez-les avec elle avant d’enregistrer.</div>')
    body = (header_vide() + tabs("Diagnostic")
            + f'<div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start"><div class="card" style="padding:14px">{rail}</div>'
            + sec("7 · Questionnaire FSE+ d’entrée", form, actions=f'<span class="xs mut">enregistré automatiquement il y a 12 s</span>{btn("Étape précédente","g","chevl",extra="btn-sm")}{btn("Terminer le socle","p","check",extra="btn-sm")}', icon="folder", sub="5 réponses proposées depuis les rubriques précédentes — la CIP confirme ou corrige, rien n’est enregistré sans elle")
            + '</div>')
    return page("Espace CIP — GARCIA Inès","Diagnostic d’accueil · socle J+30 · rubrique 7 pré-remplie par déduction", body, H=1500)

def dossiers_fse():
    cols=["Éligib.","Pass","Référent","FSE+ entrée","Diag. socle","Sortie","Saisie < 30 j","+6 mois","Remise"]
    def cell(v):
        m={"ok":("#ECFDF5",ic("check",14,color="#047857")),"ko":("#FEF2F2",ic("x",14,color="#B91C1C")),"warn":("#FFFBEB",ic("alert",14,color="#B45309")),"na":("#F8FAFC",'<span class="xs mut">—</span>')}
        bg,i=m[v]; return f'<td style="text-align:center;background:{bg}">{i}</td>'
    data=[("MARTIN Sofiane","sorti le 21/08","ok ok ok ok ok ko ko na ok","J+22 : sortie à saisir"),("NDIAYE Awa","entrée le 18/08","ok ok ok ko warn na na na ko","FSE+ entrée manquant"),("GARCIA Inès","entrée le 08/09","ko ko ko ko warn na na na ko","dossier vide (J+6)"),("BENALI Karim","en parcours","ok ok ok ok ok na na na ok",""),("BOUCHER Théo","sorti le 10/03","ok ok ok ok ok ok ok ko ok","+6 mois échu (J+6)"),("KOVAC Ivana","en parcours","ok ok ok ok ok na na na ok",""),("HAMDI Yacine","en parcours","ok ok warn ok ok na na na ok","référent : non déterminé"),("FERREIRA Ana","sortie le 30/06","ok ok ok ok ok ok ok na ok","+6 mois le 30/12")]
    rows="".join(f'<tr><td class="sb">{n}<div class="xs mut" style="font-weight:400">{s}</div></td>'+"".join(cell(v) for v in c.split())+f'<td class="xs" style="color:{"#B91C1C" if r else "#64748B"}">{r or "complet"}</td></tr>' for n,s,c,r in data)
    table = f'<table class="tbl"><thead><tr><th>Participant</th>'+"".join(f'<th style="text-align:center">{c}</th>' for c in cols)+'<th>À faire</th></tr></thead><tbody>'+rows+'</tbody></table><div class="xs mut" style="margin-top:8px">… et 6 autres participants complets</div>'
    kp = f'<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px">{kpi("Participants ASI","14","#1D4ED8","projet 2026-2027")}{kpi("Dossiers complets","9 / 14","#047857","64 %")}{kpi("À traiter sous 30 j","2","#B91C1C","sortie MARTIN · FSE+ NDIAYE")}{kpi("Sorties à +6 mois attendues","1","#B45309","BOUCHER · échu")}</div>'
    filt = f'<div class="row" style="gap:8px;margin-bottom:14px"><select class="inp" style="width:280px"><option>ASI 2026-2027 — Accompagnement Social Intensif</option></select><select class="inp" style="width:150px"><option>2026 · T3</option></select><span class="badge b-slate">Tous</span><span class="badge b-teal">Incomplets d’abord</span></div>'
    ocs = f'<div class="row" style="gap:12px"><div style="flex:1"><div class="sb">Postes CIP en OCS 2026-2027 — feuilles de temps</div><div class="xs mut">Nadia B. (quotité affectée 80 %) · Août validé RH · <span style="color:#B45309">Septembre : en attente de validation intervenant</span> · taux forfaitaire 40 %</div></div>{btn("Ouvrir le temps d’accompagnement","s","clock",extra="btn-sm")}</div>'
    body = kp+filt+sec("Pièces par participant", table, actions=btn("Export FSE+ (CSV, 29 colonnes)","s","down",extra="btn-sm")+btn("Bilan d’exécution (PDF)","p","file",extra="btn-sm"), icon="folder", sub="Chaque case ouvre le champ manquant · un export à zéro ligne est refusé, jamais un fichier vide")+'<div style="height:14px"></div>'+sec("Projet OCS", ocs, icon="clock")
    return page("Dossiers FSE+ — pièces à compléter","Projet ASI 2026-2027 · 3ᵉ trimestre 2026", body, active="/insertion/conformite", icon="folder", actions=btn("Réglages des projets","g","set"), H=1250)

def temps():
    days = ["L 1","M 2","M 3","J 4","V 5","L 8","M 9","M 10","J 11","V 12","L 15","M 16","M 17","J 18","V 19","L 22","M 23","M 24","J 25","V 26","L 29","M 30"]
    conge = {"L 15","M 16","M 17","J 18","V 19"}
    cells=[]
    for d in days:
        if d in conge: cells.append(f'<td style="text-align:center;background:#F1F5F9;color:#94A3B8" class="xs">congé</td>')
        elif d=="M 17": pass
        else: cells.append(f'<td style="text-align:center" class="sm">{ {"L 1":"5,25","M 2":"4,0","M 3":"6,5","J 4":"3,75","V 5":"2,0","L 8":"6,0","M 9":"4,5","M 10":"5,0","J 11":"4,25","V 12":"1,5","L 22":"5,5","M 23":"4,0","M 24":"6,25","J 25":"3,5","V 26":"2,25","L 29":"5,0","M 30":"3,75"}[d] }</td>')
    hdr = "".join(f'<th style="text-align:center;{"background:#F1F5F9" if d in conge else ""}">{d}</th>' for d in days)
    grid = f'<div style="overflow:auto"><table class="tbl"><thead><tr><th>Sept. 2026</th>{hdr}<th>Total</th></tr></thead><tbody><tr><td class="sb">Heures d’accompagnement</td>{"".join(cells)}<td class="b">73,0 h</td></tr></tbody></table></div>'
    vent = ('<table class="tbl"><thead><tr><th>Activité</th><th>Nombre</th><th>Heures</th><th>Projet ASI</th><th>Projet OCS</th><th>Hors projet</th></tr></thead><tbody>'
            '<tr><td>Entretiens et bilans (durée à la clôture)</td><td>31</td><td>24,5 h</td><td>11,0 h</td><td>24,5 h</td><td>—</td></tr>'
            '<tr><td>Points avec les référents (CMS / FT)</td><td>9</td><td>4,5 h</td><td>3,0 h</td><td>4,5 h</td><td>—</td></tr>'
            '<tr><td>Actions individuelles (durée saisie)</td><td>58</td><td>27,0 h</td><td>12,5 h</td><td>27,0 h</td><td>—</td></tr>'
            '<tr><td>Temps collectif (ateliers, réunions d’équipe)</td><td>6</td><td>12,0 h</td><td>4,0 h</td><td>12,0 h</td><td>—</td></tr>'
            '<tr><td>Administratif hors accompagnement</td><td>—</td><td>5,0 h</td><td>—</td><td>—</td><td>5,0 h</td></tr>'
            '<tr style="background:#F8FAFC"><td class="b">Total du mois</td><td></td><td class="b">73,0 h</td><td class="b">30,5 h</td><td class="b">68,0 h</td><td class="b">5,0 h</td></tr></tbody></table>'
            '<div class="xs mut" style="margin-top:8px">Les durées sont déclaratives, saisies à la clôture de chaque geste ; le PDF signé le mentionne. Temps de présence total (badgeuse) : 121,5 h.</div>')
    incoh = ('<div style="padding:12px 14px;border-radius:12px;background:#FEF2F2;border:1px solid #FECACA" class="row"><span style="color:#B91C1C">'+ic("alert",18)+'</span><div><div class="sb" style="color:#B91C1C">Incohérence avec les congés de la paie</div><div class="sm" style="color:#7F1D1D">Le 17/09 porte 2 actions (1,5 h) alors que la paie enregistre un congé du 15 au 19/09. Corrigez la date des actions ou le congé avant validation : un contrôle de service fait rejetterait la journée.</div><div class="row" style="gap:8px;margin-top:8px">'+btn("Voir les 2 actions","s","",extra="btn-sm")+btn("Ignorer avec un motif","g","",extra="btn-sm")+'</div></div></div>')
    valid = (f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="line"><div><div class="sb">Intervenante — Nadia B.</div><div class="xs mut">quotité affectée au projet OCS : 80 %</div></div>{badge("à valider","amber")}</div><div class="line"><div><div class="sb">RH — validation et signature</div><div class="xs mut">après correction de l’incohérence</div></div>{badge("en attente","slate")}</div></div><div class="row" style="gap:8px;margin-top:12px;justify-content:flex-end">{btn("Export CSV","s","down")}{btn("PDF à signer","s","file")}{btn("Valider ma feuille","p","check")}</div>')
    body = (f'<div class="row" style="gap:8px;margin-bottom:14px"><select class="inp" style="width:200px"><option>Nadia B. (CIP)</option></select><select class="inp" style="width:160px"><option>Septembre 2026</option></select>{badge("Août 2026 : validé RH le 03/09","green")}</div>'
            + incoh + '<div style="height:14px"></div>'
            + sec("Heures d’accompagnement par jour", grid, icon="cal", sub="Composées automatiquement des entretiens, actions et temps collectifs saisis — aucune saisie début / fin")
            + '<div style="height:14px"></div>' + sec("Ventilation par activité et par projet", vent, icon="chart")
            + '<div style="height:14px"></div>' + sec("Validation", valid, icon="pen"))
    return page("Temps d’accompagnement","Feuille de temps mensuelle par intervenant et par projet cofinancé (OCS)", body, active="/insertion/temps", icon="clock", H=1420)

def build():
    write("Dossier_Complet", dc(dossier(False),1366,2200), 1366, 2200, "4a · Dossier administratif — complet")
    write("Dossier_Vide", dc(dossier(True),1366,2000), 1366, 2000, "4b · Dossier administratif — vide")
    write("Diagnostic_FSE", dc(diagnostic_fse(),1366,1500), 1366, 1500, "5 · Diagnostic — rubrique 7 FSE+ pré-remplie")
    write("Dossiers_FSE", dc(dossiers_fse(),1366,1250), 1366, 1250, "Dossiers FSE+ — vue transversale")
    write("Temps_Accompagnement", dc(temps(),1366,1420), 1366, 1420, "8 · Feuille de temps — incohérence congés")
