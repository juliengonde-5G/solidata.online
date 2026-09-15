import json, gen, pages_a, pages_b, pages_c
pages_a.build(); pages_b.build(); pages_c.build()
# Disposition : 3 rangées desktop (1366 large), puis PDF + mobile
order = ["Main","Echeances_Calme","Fiche_Situation","Fiche_Suivi_Cloture","Dossier_Complet","Dossier_Vide","Diagnostic_FSE","Dossiers_FSE","Temps_Accompagnement","ETI_Mobile","PDF_Referent","PDF_Assiduite","PDF_MonParcours"]
by = {a["file"].replace(".dc.html",""):a for a in gen.ARTBOARDS}
arts=[]; x=0; y=0; rowh=0; per_row=3
for i,n in enumerate(order):
    a=by[n]
    if n=="ETI_Mobile": x=0; y+=rowh+160; rowh=0
    if i>0 and i%per_row==0 and n!="ETI_Mobile" and n not in ("PDF_Referent","PDF_Assiduite","PDF_MonParcours"):
        x=0; y+=rowh+160; rowh=0
    a.update({"x":x,"y":y}); arts.append(a)
    x+=a["w"]+100; rowh=max(rowh,a["h"])
canvas={"artboards":arts,
 "annotations":[{"id":"lecture","x":0,"y":-150,"w":900,"text":"Refonte du module CIP — maquettes de la section Insertion (phase 7).\nNumérotation = liste des 10 vues demandées par la CIP (08b § G). Vues statiques, données fictives.\nÀ arbitrer : l’organisation des blocs de « Mes échéances », l’onglet Dossier administratif, le socle de diagnostic, la feuille de temps, les trois PDF."}],
 "launch":{"view":"canvas"}}
json.dump(canvas, open("canvas.json","w"), ensure_ascii=False, indent=1)
print("artboards:", len(arts))
