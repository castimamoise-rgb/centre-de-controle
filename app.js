const DBKEY="LAPERLE_CENTRE_CONTROL_V3";
const MODULES={
dashboard:{label:"Tableau de bord",icon:"🏠"},
clients:{label:"Clients",icon:"👥"},
prospects:{label:"Prospects",icon:"🎯"},
bookings:{label:"Réservations",icon:"📅"},
drivers:{label:"Chauffeurs",icon:"👨‍✈️"},
vehicles:{label:"Véhicules",icon:"🚙"},
planning:{label:"Planning",icon:"🗓️"},
payments:{label:"Paiements",icon:"💰"},
expenses:{label:"Dépenses",icon:"🧾"},
quotes:{label:"Proformas",icon:"📄"},
invoices:{label:"Factures",icon:"🧾"},
reports:{label:"Rapports",icon:"📊"},
marketing:{label:"Marketing",icon:"📣"},
settings:{label:"Paramètres",icon:"⚙️"}
};
const SCHEMAS={
clients:[
["name","Nom complet","text"],["phone","Téléphone / WhatsApp","text"],["email","Email","email"],["zone","Zone","text"],
["service","Service","select:Transport scolaire|Abonnement travail|Taxi privé|Transport privé|Location|Tourisme"],
["route","Trajet","text"],["start","Date de début","date"],["amount","Montant HTG","number"],
["status","Statut","select:Nouveau|En discussion|Confirmé|Actif|Terminé|Annulé"],["notes","Notes","textarea"]],
prospects:[
["name","Nom / entreprise","text"],["phone","Téléphone / WhatsApp","text"],["need","Besoin / trajet","text"],["source","Source","text"],
["status","Statut","select:Nouveau|Contacté|Intéressé|Proforma envoyée|Gagné|Perdu"],["next","Prochaine action","date"],["notes","Notes","textarea"]],
bookings:[
["client","Client","text"],["date","Date","date"],["time","Heure","time"],["route","Trajet","text"],["passengers","Passagers","number"],
["price","Prix HTG","number"],["payment","Paiement","select:En attente|Partiel|Payé"],["status","Statut","select:À confirmer|Confirmée|Effectuée|Annulée"],["notes","Notes","textarea"]],
drivers:[
["name","Nom complet","text"],["phone","Téléphone","text"],["vehicle","Véhicule","text"],["capacity","Capacité","number"],["zone","Zone","text"],
["status","Disponibilité","select:Disponible|Occupé|Inactif"],["share","Part chauffeur %","number"],["notes","Notes","textarea"]],
vehicles:[
["vehicle","Véhicule","text"],["plate","Plaque","text"],["type","Type","text"],["capacity","Capacité","number"],["zone","Zone","text"],
["status","Statut","select:Disponible|Affecté|Maintenance|Inactif"],["notes","Notes","textarea"]],
planning:[
["client","Client","text"],["date","Date","date"],["time","Heure","time"],["route","Trajet","text"],["driver","Chauffeur","text"],["vehicle","Véhicule","text"],
["status","Statut","select:Planifié|En cours|Terminé|Incident|Annulé"],["notes","Notes","textarea"]],
payments:[
["client","Client","text"],["date","Date","date"],["amount","Montant HTG","number"],["method","Mode","select:MonCash|Cash|Virement|Autre"],
["status","Statut","select:Reçu|À recevoir|Remboursé"],["reference","Référence","text"],["notes","Notes","textarea"]],
expenses:[
["label","Dépense","text"],["date","Date","date"],["amount","Montant HTG","number"],
["category","Catégorie","select:Carburant|Chauffeur|Marketing|Maintenance|Administration|Autre"],["notes","Notes","textarea"]],
quotes:[
["client","Client","text"],["date","Date","date"],["route","Trajet","text"],["service","Service","select:Transport scolaire|Abonnement travail|Taxi privé|Transport privé|Location|Tourisme"],
["amount","Montant HTG","number"],["validity","Validité","text"],["status","Statut","select:Brouillon|Envoyée|Acceptée|Refusée"],["notes","Notes","textarea"]],
invoices:[
["client","Client","text"],["date","Date","date"],["proforma","N° Proforma lié","text"],["amount","Montant HTG","number"],
["status","Statut","select:Brouillon|Envoyée|Payée|Partielle|Annulée"],["due","Échéance","date"],["notes","Notes","textarea"]]
};
let state=loadState();
let current=location.hash.slice(1)||"dashboard";

function loadState(){try{return JSON.parse(localStorage.getItem(DBKEY))||{}}catch(e){return {}}}
function save(){localStorage.setItem(DBKEY,JSON.stringify(state))}
function list(k){if(!Array.isArray(state[k]))state[k]=[];return state[k]}
function money(n){return new Intl.NumberFormat("fr-FR").format(Number(n)||0)+" HTG"}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function today(){return new Date().toISOString().slice(0,10)}

const nav=document.getElementById("mainNav");
Object.entries(MODULES).forEach(([key,m])=>{
 const b=document.createElement("button");b.className="nav-item";b.dataset.key=key;
 b.innerHTML=`<span class="nav-icon">${m.icon}</span><span>${m.label}</span><span class="chev">›</span>`;
 b.onclick=()=>go(key);nav.appendChild(b);
});
document.getElementById("date").textContent=new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
function clock(){document.getElementById("clock").textContent=new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}
clock();setInterval(clock,1000);
document.getElementById("globalSearchBtn").onclick=globalSearch;
document.getElementById("globalSearch").onkeydown=e=>{if(e.key==="Enter")globalSearch()};
document.getElementById("notificationBtn").onclick=()=>showToast("Aucune nouvelle notification.");
document.getElementById("profileBtn").onclick=()=>openProfile();
window.addEventListener("hashchange",()=>{current=location.hash.slice(1)||"dashboard";render()});
render();

function go(k){current=k;location.hash=k;render()}
function render(){
 document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.key===current));
 if(current==="dashboard")dashboard();
 else if(SCHEMAS[current])modulePage(current);
 else if(current==="reports")reportsPage();
 else if(current==="marketing")marketingPage();
 else if(current==="settings")settingsPage();
 else dashboard();
}
function dashboard(){
 const received=list("payments").filter(x=>x.status==="Reçu").reduce((s,x)=>s+Number(x.amount||0),0);
 const spent=list("expenses").reduce((s,x)=>s+Number(x.amount||0),0);
 const toReceive=list("payments").filter(x=>x.status==="À recevoir").reduce((s,x)=>s+Number(x.amount||0),0);
 document.getElementById("page").innerHTML=`
 <div class="welcome"><div><h2>👤 Bonjour, Castima !</h2><p>Voici la situation de LAPERLE TOUR HT aujourd'hui.</p></div><div class="quote">❝ Plus qu'un transport, une destination de confiance. ❞<br>— LAPERLE TOUR HT</div></div>
 <div class="kpis">
 ${kpi("👥","Clients actifs",list("clients").filter(x=>["Actif","Confirmé"].includes(x.status)).length,"clients")}
 ${kpi("🎯","Prospects",list("prospects").length,"prospects")}
 ${kpi("📅","Réservations",list("bookings").length,"bookings")}
 ${kpi("💰","CA encaissé",money(received),"payments")}
 ${kpi("🚗","Chauffeurs",list("drivers").length,"drivers")}
 ${kpi("🚙","Véhicules",list("vehicles").length,"vehicles")}
 ${kpi("🧾","Dépenses",money(spent),"expenses")}
 ${kpi("📊","Résultat (enregistré)",money(received-spent),"reports")}
 </div>
 <div class="dashboard-grid">
   <div class="panel"><div class="panel-title"><h3>📊 Revenus vs Dépenses</h3><select id="chartRange"><option>Cette année</option><option>Ce mois</option></select></div>${chartHTML()}<div class="legend"><i></i>Revenus <i class="orange"></i>Dépenses</div></div>
   <div class="panel"><div class="panel-title"><h3>◕ Répartition des services</h3><select><option>Cette année</option></select></div>${servicesHTML()}</div>
 </div>
 <div class="panel" style="margin-top:12px"><div class="panel-title"><h3>📄 Documents commerciaux</h3></div>
<div class="quick-list">
<button onclick="go('quotes')">📄 Proformas <b>›</b></button>
<button onclick="go('invoices')">🧾 Factures <b>›</b></button>
<button onclick="go('settings')">⚙️ Paramètres <b>›</b></button>
</div></div>
<div class="bottom-grid">
  <div class="panel"><div class="panel-title"><h3>📅 Dernières réservations</h3><button onclick="go('bookings')">Voir tout</button></div>${recentTable("bookings",["client","route","date","status"],"Nouvelle réservation","bookings")}</div>
  <div class="panel"><div class="panel-title"><h3>💰 Derniers paiements</h3><button onclick="go('payments')">Voir tout</button></div>${recentTable("payments",["client","amount","date","status"],"Enregistrer un paiement","payments")}</div>
  <div class="panel quick-card"><div class="panel-title"><h3>⚡ Actions rapides</h3></div><div class="quick-list">
   <button onclick="openForm('clients')">👥 Ajouter un client <b>›</b></button>
   <button onclick="openForm('prospects')">🎯 Ajouter un prospect <b>›</b></button>
   <button onclick="openForm('quotes')">📄 Créer une proforma <b>›</b></button>
   <button onclick="openForm('payments')">💰 Enregistrer un paiement <b>›</b></button>
   <button onclick="openForm('expenses')">🧾 Ajouter une dépense <b>›</b></button>
   <button onclick="openForm('invoices')">🧾 Créer une facture <b>›</b></button>
  </div></div>
 </div>
 <div class="bottom-grid">
  <div class="panel"><div class="panel-title"><h3>🗓️ Agenda du jour</h3><button onclick="go('planning')">Voir le planning</button></div><div class="agenda">${agendaHTML()}</div></div>
  <div class="panel promo"><img src="logo-laperle.jpg" alt="LAPERLE"><div class="check">● Transport fiable</div><div class="check">● Service professionnel</div><div class="check">● Partout en Haïti</div><button class="contact-btn" onclick="contactLaperle()">☎ Contactez-nous</button></div>
  <div></div>
 </div>`;
}
function kpi(icon,label,value,target){return `<div class="kpi"><div class="kpi-icon">${icon}</div><div><small>${label}</small><strong>${value}</strong><a onclick="go('${target}')">Voir ${label.toLowerCase()} →</a></div></div>`}
function chartHTML(){
 const months=["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
 const rev=list("payments").filter(x=>x.status==="Reçu").reduce((s,x)=>s+Number(x.amount||0),0);
 const exp=list("expenses").reduce((s,x)=>s+Number(x.amount||0),0);
 const max=Math.max(rev,exp,1);
 return `<div class="chart"><div class="bars">${months.map((m,i)=>{const r=i===new Date().getMonth()?rev:0,e=i===new Date().getMonth()?exp:0;return `<div class="bar-group"><div class="bar rev" style="height:${Math.max(2,r/max*100)}%"></div><div class="bar exp" style="height:${Math.max(2,e/max*100)}%"></div></div>`}).join("")}</div><div class="months">${months.map(x=>`<span>${x}</span>`).join("")}</div></div>`
}
function servicesHTML(){
 const counts={};list("clients").forEach(x=>{counts[x.service]=(counts[x.service]||0)+1});
 const total=Object.values(counts).reduce((a,b)=>a+b,0);
 if(!total)return `<div class="services-donut"><div class="donut"></div><div class="service-list">🔵 Transport scolaire <b>0%</b><br>🟢 Abonnement travail <b>0%</b><br>🟠 Taxi privé <b>0%</b><br>🟣 Transport privé <b>0%</b><br>🔴 Autres <b>0%</b></div></div>`;
 return `<div class="services-donut"><div class="donut" style="background:conic-gradient(#1675ea 0 20%,#2ba84a 20% 40%,#f7941d 40% 60%,#7354e8 60% 80%,#d93025 80% 100%)"></div><div class="service-list">${Object.entries(counts).slice(0,5).map(([k,v])=>`<div><span class="dot" style="background:#1675ea"></span>${esc(k)} <b>${Math.round(v/total*100)}%</b></div>`).join("")}</div></div>`
}
function recentTable(key,cols,emptyBtn,target){
 const a=list(key).slice(-4).reverse();
 if(!a.length)return `<div class="empty-table"><div>▣<br>Aucune donnée pour le moment.<br><button class="primary" onclick="openForm('${target}')">＋ ${emptyBtn}</button></div></div>`;
 return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th>${SCHEMAS[key]?.find(x=>x[0]===c)?.[1]||c}</th>`).join("")}</tr></thead><tbody>${a.map(o=>`<tr>${cols.map(c=>`<td>${esc(o[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
}
function agendaHTML(){
 const a=list("planning").filter(x=>x.date===today());
 if(!a.length)return `▣<br>Aucun service prévu aujourd'hui.<br><button class="secondary" onclick="go('planning')">Voir le planning</button>`;
 return `<div style="width:100%;text-align:left">${a.slice(0,4).map(x=>`<div class="info">⏰ ${esc(x.time)} · <b>${esc(x.client)}</b><br>${esc(x.route)} · ${esc(x.driver)}</div>`).join("")}</div>`
}


function documentModuleIntro(key){
  if(key==="quotes") return `<div class="info" style="margin-bottom:12px">
  <b>Gestion des Proformas</b><br>
  Créez une proforma, le numéro PF est généré automatiquement, modifiez-la à tout moment,
  consultez son détail et utilisez <b>PDF</b> pour préparer le document commercial LAPERLE.
  </div>`;
  if(key==="invoices") return `<div class="info" style="margin-bottom:12px">
  <b>Gestion des Factures</b><br>
  Chaque facture possède son numéro FAC. Elle peut être créée depuis une proforma et conserve
  automatiquement le <b>N° Proforma lié</b>. Utilisez <b>PDF</b> pour préparer la facture.
  </div>`;
  if(key==="settings") return `<div class="info" style="margin-bottom:12px">
  <b>Paramètres LAPERLE</b><br>
  Configurez les informations de l'entreprise et le profil administrateur sans modifier
  les autres modules ni le design.
  </div>`;
  return "";
}
function modulePage(key){
 const title=MODULES[key].label,schema=SCHEMAS[key];
 document.getElementById("page").innerHTML=`<div class="section-head"><div><h2>${MODULES[key].icon} ${title}</h2><p>Gérez, recherchez, ajoutez et modifiez toutes les informations de ce module.</p></div><div class="actions"><button class="primary" onclick="openForm('${key}')">＋ Ajouter</button></div></div>
 <div class="data-panel">${documentModuleIntro(key)}<div class="filters"><input id="moduleSearch" placeholder="Rechercher..." oninput="drawTable('${key}')"><select id="statusFilter" onchange="drawTable('${key}')"><option value="">Tous les statuts</option>${statusOptions(schema)}</select></div><div id="moduleTable"></div></div>`;
 drawTable(key);
}
function statusOptions(schema){const s=schema.find(x=>x[0]==="status");if(!s)return "";return s[2].slice(7).split("|").map(x=>`<option>${esc(x)}</option>`).join("")}
function drawTable(key){
 const q=(document.getElementById("moduleSearch")?.value||"").toLowerCase(),f=document.getElementById("statusFilter")?.value||"";
 let a=list(key).filter(o=>Object.values(o).join(" ").toLowerCase().includes(q)&&(!f||o.status===f));
 let cols=SCHEMAS[key].slice(0,7);
 if(key==="clients") cols=[["id","ID client","text"],...cols];
 if(key==="quotes") cols=[["number","N° Proforma","text"],...cols];
 if(key==="invoices") cols=[["number","N° Facture","text"],...cols];
 const box=document.getElementById("moduleTable");if(!box)return;
 if(!a.length){box.innerHTML=`<div class="empty-table">Aucune donnée enregistrée.<br><button class="primary" onclick="openForm('${key}')">＋ Ajouter ${MODULES[key].label.toLowerCase()}</button></div>`;return}
 box.innerHTML=`<div class="table-wrap"><table class="table"><thead><tr>${cols.map(x=>`<th>${x[1]}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${a.map(o=>{const i=list(key).indexOf(o);return `<tr>${cols.map(x=>`<td>${formatCell(o[x[0]],x[2])}</td>`).join("")}<td class="action-cell">
<button class="tiny edit" onclick="openForm('${key}',${i})">Modifier</button>
<button class="tiny" onclick="viewRow('${key}',${i})">Voir</button>
${key==="quotes"?`<button class="tiny" onclick="createInvoiceFromQuote(${i})">Facture</button><button class="tiny" onclick="printDocument('quote',${i})">PDF Proforma</button>`:""}
${key==="invoices"?`<button class="tiny" onclick="printDocument('invoice',${i})">PDF Facture</button>`:""}
<button class="tiny delete" onclick="removeRow('${key}',${i})">Suppr.</button></td></tr>`}).join("")}</tbody></table></div>`;
}
function formatCell(v,t){if(!v)return "";if(t?.startsWith("select:")){let cls="";if(["Payé","Reçu","Actif","Confirmée","Effectuée","Gagné","Disponible","Acceptée"].includes(v))cls="green";else if(["En attente","À recevoir","En discussion","Intéressé","Envoyée","Planifié"].includes(v))cls="orange";else if(["Annulée","Perdu","Inactif","Incident"].includes(v))cls="red";return `<span class="badge ${cls}">${esc(v)}</span>`}if(t==="number"&&String(v).length)return money(v);return esc(v)}
function openForm(key,index=-1){
 const schema=SCHEMAS[key], existing=index>=0?list(key)[index]:{};
 document.getElementById("modal").innerHTML=`<div class="modal-head"><div><h2>${index>=0?"Modifier":"Ajouter"} • ${MODULES[key].label}</h2><small>Toutes les informations peuvent être modifiées.</small></div><button class="close" onclick="closeModal()">×</button></div>
 <form id="dataForm" class="form-grid">${(key==="clients"?[["id","ID client","text"],...schema]:key==="quotes"?[["number","N° Proforma","text"],...schema]:key==="invoices"?[["number","N° Facture","text"],...schema]:schema).map(([id,label,type])=>fieldHTMLLinked(id,label,type,existing[id]||"",key)).join("")}<div class="full form-actions"><button type="button" class="secondary" onclick="closeModal()">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`;
 document.getElementById("modalBackdrop").classList.add("open");
 document.getElementById("dataForm").onsubmit=e=>{
 e.preventDefault(); let obj={}; new FormData(e.target).forEach((v,k)=>obj[k]=v.trim());
 if(index>=0){
   const old=list(key)[index]; obj.id=old.id; obj.number=old.number; list(key)[index]=obj;
 }else{
   if(["clients","drivers","vehicles","bookings","planning","payments","expenses"].includes(key)){
     obj.id=nextNumber(({clients:"CL",drivers:"CH",vehicles:"VH",bookings:"RES",planning:"SRV",payments:"PAY",expenses:"DEP"})[key],key);
   }
   if(key==="quotes") obj.number=nextQuoteNumber();
   if(key==="invoices") obj.number=nextInvoiceNumber();
   if(["bookings","planning","payments","quotes","invoices"].includes(key) && obj.client){
     const c=list("clients").find(x=>x.id===obj.client); if(c){obj.clientId=c.id;obj.client=c.name;}
   }
   list(key).push(obj);
 }
 save();closeModal();go(key);showToast("Enregistrement effectué.");
};
}
function fieldHTMLLinked(id,label,type,val,key){
 if(key==="clients" && id==="id") return `<div class="field"><label>ID client</label><input value="${esc(val||nextClientId())}" readonly></div>`;
 if(key==="quotes" && id==="number") return `<div class="field"><label>N° Proforma</label><input value="${esc(val||nextQuoteNumber())}" readonly></div>`;
 if(key==="invoices" && id==="number") return `<div class="field"><label>N° Facture</label><input value="${esc(val||nextInvoiceNumber())}" readonly></div>`;
 if(key==="invoices" && id==="proforma") return `<div class="field"><label>N° Proforma lié</label><select name="proforma">${list("quotes").map(q=>`<option value="${esc(q.number||"")}" ${q.number===val?"selected":""}>${esc(q.number)} — ${esc(q.client)}</option>`).join("")}</select></div>`;
 if(["bookings","planning","payments","quotes","invoices"].includes(key) && id==="client") return `<div class="field"><label>Client</label><select name="client">${list("clients").map(c=>`<option value="${esc(c.id)}" ${c.id===val?"selected":""}>${esc(c.name)} — ${esc(c.id)}</option>`).join("")}</select></div>`;
 if(key==="planning" && id==="driver") return `<div class="field"><label>Chauffeur</label><select name="driver">${list("drivers").map(c=>`<option value="${esc(c.id)}" ${c.id===val?"selected":""}>${esc(c.name)} — ${esc(c.id)}</option>`).join("")}</select></div>`;
 if(key==="planning" && id==="vehicle") return `<div class="field"><label>Véhicule</label><select name="vehicle">${list("vehicles").map(c=>`<option value="${esc(c.id)}" ${c.id===val?"selected":""}>${esc(c.vehicle)} — ${esc(c.id)}</option>`).join("")}</select></div>`;
 return fieldHTML(id,label,type,val);
}
function fieldHTML(id,label,type,val){
 if(type.startsWith("select:"))return `<div class="field"><label>${label}</label><select name="${id}">${type.slice(7).split("|").map(x=>`<option ${x===val?"selected":""}>${esc(x)}</option>`).join("")}</select></div>`;
 if(type==="textarea")return `<div class="field full"><label>${label}</label><textarea name="${id}">${esc(val)}</textarea></div>`;
 return `<div class="field"><label>${label}</label><input name="${id}" type="${type}" value="${esc(val)}"></div>`;
}
function viewRow(key,index){
 const o=list(key)[index],fields=SCHEMAS[key].map(x=>`<div class="info"><b>${x[1]}</b><br>${esc(o[x[0]]||"—")}</div>`).join("");
 document.getElementById("modal").innerHTML=`<div class="modal-head"><div><h2>${MODULES[key].icon} ${MODULES[key].label}</h2><small>Fiche détaillée</small></div><button class="close" onclick="closeModal()">×</button></div><div class="form-grid">${fields}</div><div class="form-actions"><button class="secondary" onclick="openForm('${key}',${index})">Modifier</button><button class="primary" onclick="closeModal()">Fermer</button></div>`;
 document.getElementById("modalBackdrop").classList.add("open");
}
function closeModal(){document.getElementById("modalBackdrop").classList.remove("open")}
function removeRow(key,index){if(confirm("Supprimer définitivement cette fiche ?")){list(key).splice(index,1);save();render();showToast("Fiche supprimée.")}}
function globalSearch(){const q=document.getElementById("globalSearch").value.trim();if(!q){go("dashboard");return}for(const key of Object.keys(SCHEMAS)){if(list(key).some(o=>Object.values(o).join(" ").toLowerCase().includes(q.toLowerCase()))){go(key);setTimeout(()=>{const s=document.getElementById("moduleSearch");if(s){s.value=q;drawTable(key)}},20);return}}showToast("Aucun résultat trouvé.")}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="LAPERLE_Centre_Controle_sauvegarde.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);showToast("Sauvegarde exportée.")}
function importData(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{state=JSON.parse(r.result);save();render();showToast("Données importées.");}catch(err){alert("Fichier JSON invalide.")}};r.readAsText(f)}
function openProfile(){document.getElementById("modal").innerHTML=`<div class="modal-head"><h2>Profil administrateur</h2><button class="close" onclick="closeModal()">×</button></div><div class="info"><b>Compte</b><br>Admin</div><div class="info" style="margin-top:8px"><b>Entreprise</b><br>LAPERLE TOUR HT</div><div class="form-actions"><button class="primary" onclick="closeModal()">Fermer</button></div>`;document.getElementById("modalBackdrop").classList.add("open")}
function contactLaperle(){window.location.href="tel:+50944408687"}
function showToast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2300)}

function reportsPage(){
 const rev=list("payments").filter(x=>x.status==="Reçu").reduce((s,x)=>s+Number(x.amount||0),0),exp=list("expenses").reduce((s,x)=>s+Number(x.amount||0),0);
 document.getElementById("page").innerHTML=`<div class="section-head"><div><h2>📊 Rapports</h2><p>Lecture synthétique des données enregistrées.</p></div><button class="primary" onclick="exportData()">Exporter les données</button></div><div class="kpis"><div class="kpi"><div class="kpi-icon">💰</div><div><small>Encaissements</small><strong>${money(rev)}</strong></div></div><div class="kpi"><div class="kpi-icon">🧾</div><div><small>Dépenses</small><strong>${money(exp)}</strong></div></div><div class="kpi"><div class="kpi-icon">📊</div><div><small>Résultat enregistré</small><strong>${money(rev-exp)}</strong></div></div><div class="kpi"><div class="kpi-icon">👥</div><div><small>Clients</small><strong>${list("clients").length}</strong></div></div></div>`;
}
function marketingPage(){
 document.getElementById("page").innerHTML=`<div class="section-head"><div><h2>📣 Marketing</h2><p>Centre de préparation des actions commerciales LAPERLE.</p></div><button class="primary orange" onclick="showToast('Brief marketing créé.')">＋ Nouvelle action</button></div><div class="dashboard-grid"><div class="panel"><div class="panel-title"><h3>Calendrier contenu</h3></div><div class="info"><b>Contenu du jour</b><br>Publication orientée confiance, ponctualité et présentation des services LAPERLE TOUR HT.</div><div class="info" style="margin-top:8px"><b>Canaux</b><br>Facebook • Instagram • WhatsApp</div></div><div class="panel"><div class="panel-title"><h3>Prospection</h3></div><div class="info"><b>Objectif de démarrage</b><br>Identifier 20 prospects qualifiés et enregistrer leur prochaine action dans le module Prospects.</div><button class="primary" style="margin-top:10px" onclick="go('prospects')">Ouvrir les prospects</button></div></div>`;
}
function settingsPage(){
 document.getElementById("page").innerHTML=`<div class="section-head"><div><h2>⚙️ Paramètres</h2><p>Configuration de LAPERLE TOUR HT et du profil administrateur.</p></div></div>
 <div class="data-panel">
 <div class="info" style="margin-bottom:14px"><b>Configuration de l'entreprise</b><br>Ces informations servent de référence pour les documents commerciaux LAPERLE.</div>
 <div class="form-grid">
  <div class="field"><label>Nom de l'entreprise</label><input id="setCompany" value="${esc(localStorage.getItem("LAPERLE_COMPANY")||"LAPERLE TOUR HT")}"></div>
  <div class="field"><label>Téléphone / WhatsApp</label><input id="setPhone" value="${esc(localStorage.getItem("LAPERLE_PHONE")||"+509 4440 8687")}"></div>
  <div class="field"><label>Email</label><input id="setEmail" value="${esc(localStorage.getItem("LAPERLE_EMAIL")||"laperletourht@gmail.com")}"></div>
  <div class="field"><label>Slogan</label><input id="setSlogan" value="${esc(localStorage.getItem("LAPERLE_SLOGAN")||"Un coup d'œil sur Haïti")}"></div>
  <div class="field"><label>Administrateur</label><input id="setAdmin" value="${esc(localStorage.getItem("LAPERLE_ADMIN")||"Admin")}"></div>
  <div class="field"><label>Devise</label><select id="setCurrency"><option>HTG</option><option>USD</option></select></div>
 </div>
 <div class="form-actions">
  <button class="primary" onclick="saveSettings()">Enregistrer les paramètres</button>
  <button class="secondary" onclick="go('dashboard')">Retour au tableau de bord</button>
 </div>
 </div>
 <div class="data-panel" style="margin-top:12px">
  <div class="panel-title"><h3>💾 Données de l'application</h3></div>
  <div class="quick-list">
   <button onclick="exportData()">⬇ Exporter une sauvegarde JSON <b>›</b></button>
   <label class="secondary" style="display:block;cursor:pointer;padding:10px;border-radius:8px">⬆ Importer une sauvegarde JSON <input type="file" accept=".json" hidden onchange="importData(event)"></label>
  </div>
 </div>`;
}
function saveSettings(){
 localStorage.setItem("LAPERLE_COMPANY",document.getElementById("setCompany").value.trim());
 localStorage.setItem("LAPERLE_PHONE",document.getElementById("setPhone").value.trim());
 localStorage.setItem("LAPERLE_EMAIL",document.getElementById("setEmail").value.trim());
 localStorage.setItem("LAPERLE_SLOGAN",document.getElementById("setSlogan").value.trim());
 localStorage.setItem("LAPERLE_ADMIN",document.getElementById("setAdmin").value.trim());
 showToast("Paramètres LAPERLE enregistrés.");
}

window.go=go;window.openForm=openForm;window.closeModal=closeModal;window.removeRow=removeRow;window.viewRow=viewRow;window.exportData=exportData;window.importData=importData;window.showToast=showToast;

function createInvoiceFromQuote(index){
 const q=list("quotes")[index]; if(!q)return;
 const existing=list("invoices").find(x=>x.proforma===q.number);
 if(existing){go("invoices");showToast("Une facture existe déjà pour cette proforma.");return;}
 list("invoices").push({number:nextInvoiceNumber(),clientId:q.clientId||"",client:q.client||"",date:today(),proforma:q.number,amount:q.amount||"",status:"Brouillon",due:"",notes:"Créée automatiquement depuis "+q.number});
 save();go("invoices");showToast("Facture créée depuis "+q.number+".");
}
function printDocument(type,index){
 const key=type==="quote"?"quotes":"invoices",o=list(key)[index];if(!o)return;
 const isQuote=type==="quote",title=isQuote?"PROFORMA":"FACTURE",client=list("clients").find(c=>c.id===o.clientId)||{};
 const w=window.open("","_blank","width=900,height=1000");
 if(!w){alert("Autorisez les fenêtres pop-up pour exporter le PDF.");return;}
 w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title} ${esc(o.number)}</title>
 <style>
 body{font-family:Arial,sans-serif;margin:0;color:#102b61}.doc{max-width:800px;margin:auto;padding:40px}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:6px solid #123c98;padding-bottom:18px}.logo{width:150px;height:100px;object-fit:contain}.brand h1{margin:0;font-size:27px}.brand h1 span{color:#f7941d}.brand p{margin:6px 0;color:#526b8e}.tag{font-weight:700;color:#35a853;font-size:12px}.title{font-size:30px;font-weight:800;margin:28px 0 15px}.meta{display:flex;gap:15px}.box{flex:1;border:1px solid #dce4ee;border-radius:10px;padding:15px}.total{text-align:right;font-size:25px;font-weight:800;margin:25px 0;color:#0b3275}.foot{margin-top:60px;border-top:3px solid #35a853;padding-top:12px;text-align:center;font-size:12px;color:#667991}@media print{button{display:none}}
 </style></head><body><div class="doc">
 <div class="head"><img class="logo" src="logo-laperle.jpg"><div class="brand"><h1>LAPERLE <span>TOUR HT</span></h1><p>Un coup d'œil sur Haïti</p><div class="tag">Confort • Sécurité • Confiance</div></div></div>
 <div class="title">${title}</div>
 <div class="meta"><div class="box"><b>Client</b><br>${esc(o.client||client.name||"—")}<br>${esc(client.phone||"")}<br>${esc(client.email||"")}</div>
 <div class="box"><b>Document</b><br>N° ${esc(o.number)}<br>Date : ${esc(o.date||today())}${isQuote?"":"<br>N° Proforma lié : "+esc(o.proforma||"—")}</div></div>
 <div class="box" style="margin-top:15px"><b>Détails</b><p>Service : ${esc(o.service||"Transport LAPERLE TOUR HT")}</p><p>Trajet : ${esc(o.route||"—")}</p><p>${isQuote?"Validité":"Échéance"} : ${esc(isQuote?(o.validity||"—"):(o.due||"—"))}</p></div>
 <div class="total">TOTAL : ${money(o.amount||0)}</div>
 <p><b>Paiement :</b> MonCash +509 4440 8687</p>
 <div class="foot">LAPERLE TOUR HT • Transport • Tourisme • Location • Abonnement • Taxi<br>Confort • Sécurité • Confiance</div>
 <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></div></body></html>`);
 w.document.close();
}
window.createInvoiceFromQuote=createInvoiceFromQuote;window.printDocument=printDocument;
