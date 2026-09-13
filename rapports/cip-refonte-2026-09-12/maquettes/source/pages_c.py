# -*- coding: utf-8 -*-
from gen import *

def eti_mobile():
    scale = lambda title, vals, on: f'<div style="margin-top:9px"><div class="sb" style="font-size:15px;margin-bottom:8px">{title}</div><div style="display:grid;grid-template-columns:repeat({len(vals)},minmax(0,1fr));gap:6px">'+"".join(f'<div style="min-height:42px;display:grid;place-items:center;border-radius:12px;border:2px solid {"#0D9488" if v==on else "#E2E8F0"};background:{"#0D9488" if v==on else "#fff"};color:{"#fff" if v==on else "#334155"};font-weight:700;font-size:15px">{v}</div>' for v in vals)+'</div></div>'
    check = lambda t,on: f'<div style="display:flex;align-items:center;gap:12px;min-height:48px;padding:0 12px;border-radius:12px;border:2px solid {"#0D9488" if on else "#E2E8F0"};background:{"#F0FDFA" if on else "#fff"};font-size:15px;font-weight:600"><span style="display:grid;place-items:center;width:24px;height:24px;border-radius:6px;border:2px solid {"#0D9488" if on else "#CBD5E1"};background:{"#0D9488" if on else "#fff"};color:#fff">{ic("check",14) if on else ""}</span>{t}</div>'
    body = ('<div style="width:390px;height:844px;background:#F8FAFC;overflow:hidden;display:flex;flex-direction:column">'
            '<div style="padding:44px 20px 10px;background:#fff;border-bottom:1px solid #E2E8F0"><div class="row" style="gap:10px"><img src="logo.png" style="width:32px;height:32px" alt=""><div><div style="font-size:12px;color:#64748B">Solidarité Textiles · SOLIDATA</div><div style="font-size:17px;font-weight:800">Avis de l’encadrant</div></div></div>'
            '<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#F0FDFA;font-size:14px"><b>PETIT Julien</b> · Tri chaîne 2<br><span style="color:#64748B">Fin de contrat le 02/10/2026 · renouvellement à préparer</span></div></div>'
            '<div style="flex:1;overflow:hidden;padding:4px 20px 20px">'
            + scale("Assiduité",["1","2","3","4","5"],"4") + scale("Motivation",["1","2","3","4","5"],"4") + scale("Autonomie au poste",["1","2","3","4","5"],"3")
            + '<div style="margin-top:9px"><div class="sb" style="font-size:15px;margin-bottom:6px">Votre avis</div><div class="col" style="gap:6px">'+check("Favorable",True)+check("Favorable avec réserves",False)+check("Défavorable",False)+'</div></div>'
            + '<div style="margin-top:9px"><div class="sb" style="font-size:15px;margin-bottom:6px">Durée proposée</div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">'+"".join(f'<div style="min-height:42px;display:grid;place-items:center;border-radius:12px;border:2px solid {"#0D9488" if v=="6 mois" else "#E2E8F0"};background:{"#0D9488" if v=="6 mois" else "#fff"};color:{"#fff" if v=="6 mois" else "#334155"};font-weight:700;font-size:15px">{v}</div>' for v in ["2 mois","4 mois","6 mois"])+'</div></div>'
            + '</div>'
            '<div style="padding:12px 20px 28px;background:#fff;border-top:1px solid #E2E8F0"><div style="min-height:56px;display:grid;place-items:center;border-radius:14px;background:#0D9488;color:#fff;font-size:17px;font-weight:700">Transmettre à la CIP</div><div class="xs mut" style="text-align:center;margin-top:8px">Lien valable jusqu’au 12/11 · aucun compte nécessaire · l’avis est enregistré une seule fois</div></div></div>')
    return body

def pdf_shell(title, subtitle, content, footer_note):
    return ('<div style="width:794px;height:1123px;background:#fff;display:flex;flex-direction:column;font-size:11.5px;line-height:1.4">'
            f'<div class="pdfh"><div><div style="font-size:11px;opacity:.85">SOLIDATA — Solidarité Textiles</div><div style="font-size:18px;font-weight:800">{title}</div><div style="font-size:11px;opacity:.9">{subtitle}</div></div><img src="logo.png" style="width:44px;height:44px;background:#fff;border-radius:8px;padding:3px" alt=""></div>'
            f'<div style="flex:1;padding:8px 24px 0">{content}</div>'
            f'<div style="padding:10px 24px;border-top:1px solid #E2E8F0;font-size:9.5px;color:#64748B;display:flex;justify-content:space-between"><span>{footer_note}</span><span>Généré le 14/09/2026 10:42 par Nadia B. · périmètre : 1 personne · page 1/1</span></div></div>')

def pdf_referent():
    kv = lambda k,v: f'<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px dotted #E2E8F0"><span style="width:190px;color:#64748B">{k}</span><span style="flex:1;font-weight:600">{v}</span></div>'
    c = ('<div class="pdft">1 · Identité et cadre</div>'+kv("Personne","BENALI Karim")+kv("Structure d’accueil","Solidarité Textiles — ACI, Rouen (CIP : Nadia B.)")+kv("Référent unique destinataire","CMS Grand-Quevilly — Mme L.")+kv("Orientation","Département · CMS · prescription du 10/07/2025")
         +'<div class="pdft">2 · Contrat et Pass IAE</div>'+kv("Contrat","CDDI 26 h/sem · 2ᵉ contrat · 15/01/2026 → 14/07/2026, renouvelé jusqu’au 14/01/2027")+kv("Pass IAE","n° 2025-07-0918 · actif · fin 14/03/2027 · prolongé le 15/07/2026")
         +'<div class="pdft">3 · Activité hebdomadaire (12 dernières semaines)</div><div class="pdfc">Contrat de travail : 26 h/semaine. Activité moyenne constatée : 27,1 h (travail + accompagnement). Semaines sous 15 h : <b>1</b> (semaine 36, arrêt maladie déclaré). Immersion en entreprise : 10 jours (Renault Ampère, juin 2026), proposition d’intérim à l’issue.</div>'
         +'<div class="pdft">4 · Situation et freins travaillés</div><table class="tbl tight" style="font-size:10.5px"><thead><tr><th>Domaine</th><th>À l’entrée (08/2025)</th><th>Aujourd’hui (06/2026)</th><th>Ce qui a été fait</th></tr></thead><tbody>'
         '<tr><td>Logement</td><td>Hébergé chez un tiers</td><td>Demande DALO en cours</td><td>Dossier déposé avec SOLIHA (orientation DORA)</td></tr>'
         '<tr><td>Mobilité</td><td>Sans permis</td><td>Code en cours</td><td>Auto-école sociale de Rouen, 2 séances/sem.</td></tr>'
         '<tr><td>Administratif</td><td>Pièce d’identité expirée</td><td>À jour</td><td>Renouvellement obtenu 11/2025</td></tr>'
         '<tr><td>Budget</td><td>Difficultés</td><td>En cours</td><td>Atelier budget CCAS planifié 08/10</td></tr>'
         '<tr><td>Français</td><td>Écrit difficile (A2)</td><td>Progrès à l’écrit</td><td>Atelier FLE interne, 1 h/sem.</td></tr></tbody></table>'
         '<div class="pdft">5 · Projet professionnel</div><div>Emploi visé : opérateur logistique (ROME N1103). Formation envisagée : CACES 1-3 (financement CPF vérifié). Souhaite un emploi à temps plein en fin de parcours.</div>'
         '<div class="pdft">6 · Assiduité et rendez-vous</div><div>7 entretiens réalisés sur 7 planifiés · 1 absence excusée (motif : rendez-vous médical, justifié) · 2 points avec le référent (12/03, 12/06). Aucune absence sans motif connue de la structure.</div>'
         '<div class="pdft">7 · Prochaines étapes proposées au référent</div><ul style="margin:0;padding-left:18px"><li>Point tripartite avant le 15/12 (préparation de la sortie de parcours, échéance CDDI 14/01/2027).</li><li>Appui du CMS sur la demande DALO (relance du bailleur).</li></ul>'
         '<div class="pdft">8 · Engagements tenus par la structure</div><div>Accompagnement bimestriel, atelier FLE hebdomadaire, immersion organisée, 3 orientations DORA.</div>'
         '<div class="pdft">9 · Remise</div><div>Document relu avec la personne le 14/09/2026 ; exemplaire remis. Contenu limité aux informations utiles au référent unique.</div>')
    return pdf_shell("Fiche pour le référent","Structure d’accueil → référent unique · à la demande · 14 septembre 2026", c, "Document établi par la structure d’accueil · aucune donnée de santé ni judiciaire · confidentiel")

def pdf_assiduite():
    rows=[("05/08/2025","Diagnostic d’accueil","Présent","—"),("28/07/2025","Entretien de période d’essai","Présent","—"),("10/11/2025","Bilan n° 2","Présent","—"),("03/01/2026","Entretien de renouvellement","Présent","—"),("12/03/2026","Point avec le référent (CMS)","Présent","—"),("14/04/2026","Bilan n° 3 (initialement prévu)","Excusé","Rendez-vous médical — justificatif présenté"),("12/06/2026","Bilan n° 3","Présent","—"),("12/06/2026","Point avec le référent (CMS)","Présent","—"),("22/09/2026","Job dating Job 76 « Démarquez-vous »","Prévu","—")]
    t = '<table class="tbl tight" style="font-size:10.5px"><thead><tr><th>Date</th><th>Rendez-vous</th><th>Présence</th><th>Motif (facultatif)</th></tr></thead><tbody>'+"".join(f'<tr><td>{d}</td><td>{r}</td><td>{p}</td><td>{m}</td></tr>' for d,r,p,m in rows)+'</tbody></table>'
    abs_ = '<table class="tbl tight" style="font-size:10.5px"><thead><tr><th>Période</th><th>Nature (paie)</th><th>Jours ouvrés</th></tr></thead><tbody><tr><td>01/09 → 05/09/2026</td><td>Arrêt maladie</td><td>5</td></tr><tr><td>20/07 → 31/07/2026</td><td>Congés payés</td><td>10</td></tr></tbody></table>'
    c = ('<div class="pdft">Personne et période</div><div>BENALI Karim · CDDI 26 h/sem · Solidarité Textiles · période du 15/07/2025 au 14/09/2026 · référent unique : CMS Grand-Quevilly.</div>'
         '<div class="pdft">Rendez-vous d’accompagnement</div>'+t+'<div style="margin-top:6px" class="pdfc">9 rendez-vous · 8 présences · 1 absence excusée · 0 absence sans motif connue. Une absence sans motif renseigné est indiquée « motif non renseigné », jamais « injustifiée ».</div>'
         +'<div class="pdft">Absences au travail (source : paie)</div>'+abs_
         +'<div class="pdft">Activité hebdomadaire</div><div>52 semaines observées · 51 semaines ≥ 15 h d’activité · 1 semaine sous 15 h (semaine 36, arrêt maladie déclaré). Le temps de travail en CDDI est inclus, conformément à la règle retenue avec le Département.</div>'
         '<div class="pdft">Changements de situation signalés par la personne</div><div>11/2025 : pièce d’identité renouvelée · 02/2026 : arrêt maladie &gt; 15 j (Pass IAE suspendu du 03/02 au 28/02) · 06/2026 : immersion en entreprise.</div>'
         '<div class="pdft">Usage</div><div>Ce relevé est établi par la structure d’accueil, seul témoin des faits d’accompagnement, pour éclairer le référent unique — notamment avant tout entretien de conciliation. Il ne porte aucune appréciation.</div>')
    return pdf_shell("Relevé d’assiduité","Rendez-vous, présences et motifs légitimes · 14 septembre 2026", c, "Aucune donnée de santé ni judiciaire · les motifs sont ceux déclarés par la personne · confidentiel")

def pdf_mon_parcours():
    box = lambda t,b: f'<div style="border:2px solid #0D9488;border-radius:12px;padding:12px 14px;margin-top:12px"><div style="font-size:15px;font-weight:800;color:#0F766E;margin-bottom:6px">{t}</div><div style="font-size:14px;line-height:1.55">{b}</div></div>'
    c = ('<div style="font-size:14px;margin-top:6px">Bonjour Karim. Cette page résume où vous en êtes. Gardez-la avec vous.</div>'
         + box("Qui s’occupe de moi", "<b>Ma conseillère à Solidarité Textiles :</b> Nadia B. — bureau au 1<sup>er</sup> étage, le mardi et le jeudi.<br><b>Mon référent unique (Département) :</b> Mme L., CMS de Grand-Quevilly — 02 35 00 00 00.<br>Pour le RSA et le contrat d’engagements, c’est Mme L. Pour le travail et le parcours, c’est Nadia.")
         + box("Mes heures cette semaine", "Travail à l’atelier : <b>26 h</b> · Atelier français : <b>1 h</b> · Rendez-vous : <b>0 h 45</b><br>Total : <b>27 h 45</b>. Mon contrat de travail compte dans mes engagements : je suis dans les clous.")
         + box("Mes prochains rendez-vous", "<b>Lundi 14 septembre, 10 h</b> — bilan avec Nadia (45 min).<br><b>Mardi 22 septembre, 14 h</b> — job dating « Démarquez-vous » au gymnase d’Yvetot (bus organisé, départ 12 h 30 de l’atelier).<br><b>Jeudi 8 octobre, 9 h 30</b> — atelier budget au CCAS.")
         + box("Ce que je me suis engagé à faire", "• Aller aux rendez-vous, ou prévenir Nadia avant si je ne peux pas (un motif est toujours noté).<br>• Continuer le code de la route (2 séances par semaine).<br>• Apporter les papiers du logement pour le dossier DALO.<br>• Dire à Nadia si ma situation change (logement, santé, famille, papiers).")
         + box("Ce que la structure s’engage à faire", "• Un bilan avec Nadia tous les 2 mois.<br>• L’atelier français chaque semaine.<br>• M’aider pour le logement (SOLIHA) et le permis (auto-école sociale).<br>• Préparer avec moi la suite après le contrat (CACES, intérim).")
         + box("Mes documents", "Diagnostic d’accueil (05/08/2025) · Bilans n° 1, 2, 3 · Convention d’immersion Renault Ampère · Ce document (14/09/2026).<br>Je peux demander à voir mon dossier à tout moment.")
         + '<div style="margin-top:12px;font-size:12px;color:#64748B">Si j’ai une absence, j’en parle à Nadia : elle note le motif. Personne ne décide seul d’une suspension : il y a toujours un entretien avant.</div>')
    return pdf_shell("Mon parcours en une page","Pour Karim · remis le 14 septembre 2026", c, "Document remis à la personne · langage simple · sans donnée de santé ni judiciaire")

def build():
    write("ETI_Mobile", dc(eti_mobile(),390,844), 390, 844, "9 · Formulaire encadrant — téléphone (lien à jeton)")
    write("PDF_Referent", dc(pdf_referent(),794,1123), 794, 1123, "6a · PDF — Fiche pour le référent", print_mode="fixed")
    write("PDF_Assiduite", dc(pdf_assiduite(),794,1123), 794, 1123, "6b · PDF — Relevé d’assiduité", print_mode="fixed")
    write("PDF_MonParcours", dc(pdf_mon_parcours(),794,1123), 794, 1123, "PDF — Mon parcours en une page (salarié)", print_mode="fixed")
