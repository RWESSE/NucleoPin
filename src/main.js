import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";

const $=id=>document.getElementById(id);
const frame=$("visualizerFrame"),projectList=$("projectList"),iocList=$("iocList"),notes=$("projectNotes"),
autoReload=$("autoReload"),activeProjectName=$("activeProjectName"),activeFileMeta=$("activeFileMeta"),
statusText=$("statusText"),watchStatus=$("watchStatus"),iocCount=$("iocCount"),search=$("projectSearch");

let state={projects:[],settings:{lastProjectId:null,autoReload:true}};
let activeProjectId=null,watchTimer=null,notesTimer=null,editingComponentId=null,lastDeletedComponent=null,toastTimer=null;
const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const fileName=p=>p.split(/[\\/]/).pop()||p;
const stripIoc=n=>n.replace(/\.ioc$/i,"");
const project=()=>state.projects.find(p=>p.id===activeProjectId)||null;
const currentIoc=(p=project())=>!p||!p.iocFiles.length?null:p.iocFiles[Math.min(p.activeIocIndex||0,p.iocFiles.length-1)]||null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const setStatus=t=>statusText.textContent=t;

function showToast(message,actionLabel="",action=null,duration=3200){
 const toast=$("appToast"),text=$("appToastText"),btn=$("appToastAction");
 if(!toast||!text||!btn)return;
 clearTimeout(toastTimer);
 text.textContent=message;
 btn.hidden=!actionLabel;
 btn.textContent=actionLabel||"";
 btn.onclick=()=>{
   clearTimeout(toastTimer);
   toast.classList.remove("show");
   if(action)action();
 };
 toast.classList.add("show");
 toastTimer=setTimeout(()=>toast.classList.remove("show"),duration);
}

function updateTopActionState(){
 const hasProject=!!project();
 const hasIoc=!!currentIoc();
 $("renameProject").disabled=!hasProject;
 $("addIoc").disabled=!hasProject;
 $("refreshIoc").disabled=!hasIoc;
 $("openCubeMx").disabled=!hasIoc;
 $("removeProject").disabled=!hasProject;
 $("exportProject").disabled=!hasProject;
 const badge=$("activeIocBadge");
 if(badge){
   const f=currentIoc();
   badge.textContent=f?`Active IOC · ${fileName(f.path)}`:"No active IOC";
   badge.classList.toggle("has-ioc",!!f);
   badge.title=f?.path||"";
 }
}

const ensureShape=p=>{p.pinLabels??={};p.components??=[];p.components.forEach(c=>c.protocol??="Custom");p.notes??="";p.iocFiles??=[];p.changeHistory??=[];p.lastPinSnapshot??={};return p};

async function save(){await invoke("save_state",{json:JSON.stringify(state,null,2)})}
async function load(){
 try{const raw=await invoke("load_state");if(raw){const x=JSON.parse(raw);if(x&&Array.isArray(x.projects))state=x}}catch(e){console.error(e)}
 state.projects.forEach(ensureShape);
 autoReload.checked=state.settings?.autoReload!==false;activeProjectId=state.settings?.lastProjectId||state.projects[0]?.id||null;
 render();
 if(currentIoc())await loadIoc({reason:"silent"});
 else{
   setStatus(state.projects.length?"Ready · select or add an IOC":"Ready · create a project");
   updateTopActionState();
 }
}
function renderProjects(){
 projectList.innerHTML="";

 const rawQuery=search.value.trim().toLowerCase();
 const terms=rawQuery.split(/\s+/).filter(Boolean);

 const rows=state.projects
   .filter(p=>{
     if(!terms.length)return true;
     const projectName=String(p.name||"").toLowerCase();
     return terms.every(term=>projectName.includes(term));
   })
   .sort((a,b)=>(b.lastOpened||b.created||0)-(a.lastOpened||a.created||0));

 const count=$("projectSearchCount");
 if(count){
   if(terms.length){
     count.textContent=`${rows.length} of ${state.projects.length} project${state.projects.length===1?"":"s"} match`;
     count.classList.add("active");
   }else{
     count.textContent=state.projects.length?`${state.projects.length} project${state.projects.length===1?"":"s"}`:"";
     count.classList.remove("active");
   }
 }

 if(!rows.length){
   projectList.innerHTML=`<div class="project-filter-empty">${terms.length?"No project name matches your search.":"No projects yet."}</div>`;
   return;
 }

 rows.forEach(p=>{
   const b=document.createElement("button");
   b.className="project-row"+(p.id===activeProjectId?" active":"");

   const af=currentIoc(p);
   const displayName=terms.length
     ? highlightSearchTerms(p.name,terms)
     : esc(p.name);

   b.innerHTML=`<div class="name">${displayName}</div><div class="meta">${p.iocFiles.length} IOC · ${p.components.length} component${p.components.length===1?"":"s"}${af?` · ${esc(fileName(af.path))}`:""}</div>`;

   b.onclick=async()=>{
     activeProjectId=p.id;
     state.settings.lastProjectId=p.id;
     await save();
     render();
     currentIoc()?await loadIoc({reason:"silent"}):clearVisual();
   };

   projectList.appendChild(b);
 });
}

function highlightSearchTerms(value,terms){
 let html=esc(String(value||""));

 for(const term of terms){
   if(!term)continue;
   const re=new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`,"ig");
   html=html.replace(re,"<mark>$1</mark>");
 }

 return html;
}
function renderIocs(){
 const p=project();iocList.innerHTML="";iocCount.textContent=p?p.iocFiles.length:0;
 if(!p){iocList.className="ioc-list empty";iocList.textContent="No project selected.";return}iocList.className="ioc-list";
 if(!p.iocFiles.length){iocList.innerHTML='<div class="empty">No IOC files saved.</div>';return}
 p.iocFiles.forEach((f,i)=>{const row=document.createElement("div");row.className="ioc-row"+(i===(p.activeIocIndex||0)?" active":"");row.innerHTML=`<div class="label">${esc(f.label||fileName(f.path))}</div><div class="path" title="${esc(f.path)}">${esc(f.path)}</div><button class="remove-x" title="Remove reference">×</button>`;row.onclick=async e=>{if(e.target.classList.contains("remove-x")){e.stopPropagation();if(!confirm(`Remove ${fileName(f.path)} from this project?\n\nThe original file will NOT be deleted.`))return;p.iocFiles.splice(i,1);if(p.activeIocIndex>=p.iocFiles.length)p.activeIocIndex=Math.max(0,p.iocFiles.length-1);await save();render();currentIoc()?await loadIoc({reason:"silent"}):clearVisual();return}p.activeIocIndex=i;await save();render();await loadIoc({reason:"silent"})};iocList.appendChild(row)})
}
function renderLabels(){
 const p=project(),root=$("pinLabelList");root.innerHTML="";
 if(!p||!Object.keys(p.pinLabels).length){root.className="mini-list empty";root.textContent="No custom labels.";return}
 root.className="mini-list";
 Object.entries(p.pinLabels).sort().forEach(([pin,label])=>{const r=document.createElement("div");r.className="mini-row";r.innerHTML=`<div class="label">${esc(pin)} → ${esc(label)}</div><button class="remove-x">×</button>`;r.onclick=e=>{if(e.target.classList.contains("remove-x")){delete p.pinLabels[pin];save();renderLabels();renderWiring();return}focusPin(pin)};root.appendChild(r)})
}

function getConfiguredSnapshot(){
  try{
    const fn=frame.contentWindow?.getConfiguredPins;
    const pins=typeof fn==="function" ? fn() : [];
    const snapshot={};
    pins.forEach(p=>{
      snapshot[p.pin]={
        label:p.label||"",
        signal:p.signal||"",
        mode:p.mode||""
      };
    });
    return snapshot;
  }catch{
    return {};
  }
}

function detectPinChanges(previous,current){
  const allPins=[...new Set([...Object.keys(previous||{}),...Object.keys(current||{})])].sort();
  const changes=[];

  for(const pin of allPins){
    const before=previous?.[pin]||null;
    const after=current?.[pin]||null;

    if(!before && after){
      changes.push({pin,type:"added",before:null,after});
      continue;
    }
    if(before && !after){
      changes.push({pin,type:"removed",before,after:null});
      continue;
    }

    const beforeSig=before?.signal||"";
    const afterSig=after?.signal||"";
    const beforeLabel=before?.label||"";
    const afterLabel=after?.label||"";
    const beforeMode=before?.mode||"";
    const afterMode=after?.mode||"";

    if(beforeSig!==afterSig || beforeLabel!==afterLabel || beforeMode!==afterMode){
      changes.push({pin,type:"changed",before,after});
    }
  }
  return changes;
}

function peripheralNameFromSignal(signal=""){
  const s=String(signal).toUpperCase();

  const patterns=[
    /^(I2C\d+)/,
    /^(SPI\d+)/,
    /^(USART\d+)/,
    /^(UART\d+)/,
    /^(TIM\d+)/,
    /^(ADC\d+)/,
    /^(DAC\d+)/,
    /^(CAN\d+)/,
    /^(USB_OTG_[A-Z]+)/,
    /^(SDIO)/,
    /^(I2S\d+)/
  ];

  for(const re of patterns){
    const m=s.match(re);
    if(m)return m[1];
  }

  if(s.includes("GPIO"))return "GPIO";
  if(s.includes("EXTI"))return "EXTI";
  if(s.includes("SYS_") || s.includes("SWD") || s.includes("JT"))return "DEBUG / SYSTEM";

  return s ? "OTHER" : "";
}

function buildPeripheralGroups(){
  const snapshot=getConfiguredSnapshot();
  const groups={};

  for(const [pin,cfg] of Object.entries(snapshot)){
    const name=peripheralNameFromSignal(cfg.signal);
    if(!name)continue;
    if(!groups[name])groups[name]=[];
    groups[name].push({
      pin,
      label:cfg.label||"",
      signal:cfg.signal||"",
      mode:cfg.mode||""
    });
  }

  return Object.entries(groups)
    .map(([name,pins])=>({name,pins:pins.sort((a,b)=>a.pin.localeCompare(b.pin))}))
    .sort((a,b)=>{
      const priority=n=>{
        if(/^I2C/.test(n))return 1;
        if(/^SPI/.test(n))return 2;
        if(/^(USART|UART)/.test(n))return 3;
        if(/^TIM/.test(n))return 4;
        if(/^ADC/.test(n))return 5;
        if(n==="GPIO")return 6;
        if(n==="EXTI")return 7;
        if(n.includes("DEBUG"))return 8;
        return 20;
      };
      return priority(a.name)-priority(b.name)||a.name.localeCompare(b.name);
    });
}

function renderPeripherals(){
  const root=$("peripheralList");
  const groups=buildPeripheralGroups();
  $("peripheralCount").textContent=groups.length;

  root.innerHTML="";
  if(!groups.length){
    root.className="peripheral-list empty";
    root.textContent=currentIoc() ? "No active peripherals detected." : "Load an IOC to inspect peripherals.";
    return;
  }

  root.className="peripheral-list";
  groups.forEach(group=>{
    const item=document.createElement("div");
    item.className="peripheral-row";
    item.innerHTML=`
      <div class="peripheral-head">
        <b>${esc(group.name)}</b>
        <span>${group.pins.length} pin${group.pins.length===1?"":"s"}</span>
      </div>
      <div class="peripheral-pins">
        ${group.pins.map(p=>`<button type="button" class="peripheral-pin" data-pin="${esc(p.pin)}">
          <b>${esc(p.pin)}</b>
          <span>${esc(p.label||p.signal)}</span>
        </button>`).join("")}
      </div>
    `;

    item.querySelectorAll(".peripheral-pin").forEach(btn=>{
      btn.addEventListener("click",()=>{
        focusPin(btn.dataset.pin);
      });
    });

    item.addEventListener("dblclick",()=>{
      highlightPeripheral(group.pins.map(p=>p.pin));
    });

    root.appendChild(item);
  });
}

function highlightPeripheral(pins){
  try{
    const doc=frame.contentDocument;
    if(!doc)return;
    doc.querySelectorAll(".mpin,.apin").forEach(el=>el.classList.remove("desktop-peripheral-highlight"));
    pins.forEach(pin=>{
      doc.querySelectorAll(`[data-pin="${pin}"]`).forEach(el=>el.classList.add("desktop-peripheral-highlight"));
    });
  }catch{}
}

function recordIocChanges(){
  const p=project();
  if(!p)return;

  const current=getConfiguredSnapshot();
  const previous=p.lastPinSnapshot||{};

  // First load establishes baseline and does not create a fake "everything added" event.
  if(!Object.keys(previous).length){
    p.lastPinSnapshot=current;
    save();
    renderPeripherals();
    renderChangeHistory();
    return;
  }

  const changes=detectPinChanges(previous,current);

  if(changes.length){
    p.changeHistory.unshift({
      id:uid(),
      timestamp:Date.now(),
      iocPath:currentIoc(p)?.path||"",
      changes
    });

    // Bound project history so it never grows forever.
    p.changeHistory=p.changeHistory.slice(0,50);
  }

  p.lastPinSnapshot=current;
  save();
  renderPeripherals();
  renderChangeHistory();
  if(document.querySelector(".tab[data-tab=\"check\"]")?.classList.contains("active")) executeSmartCheck();
}

function formatChangeValue(cfg){
  if(!cfg)return "Free";
  const bits=[cfg.signal||"Configured"];
  if(cfg.label)bits.push(cfg.label);
  return bits.join(" · ");
}

function renderChangeHistory(){
  const p=project();
  const root=$("changeList");
  const summary=$("changeSummary");

  if(!p || !p.changeHistory?.length){
    summary.textContent="No changes recorded yet.";
    root.className="change-list empty";
    root.textContent="Save the IOC in CubeMX/CubeIDE to see changes here.";
    return;
  }

  const latest=p.changeHistory[0];
  summary.innerHTML=`<b>${latest.changes.length}</b> change${latest.changes.length===1?"":"s"} in latest IOC update · ${new Date(latest.timestamp).toLocaleTimeString()}`;

  root.className="change-list";
  root.innerHTML="";

  p.changeHistory.forEach(entry=>{
    const section=document.createElement("div");
    section.className="change-event";
    section.innerHTML=`
      <div class="change-event-head">
        <b>${new Date(entry.timestamp).toLocaleString()}</b>
        <span>${entry.changes.length} change${entry.changes.length===1?"":"s"}</span>
      </div>
      <div class="change-event-items"></div>
    `;

    const body=section.querySelector(".change-event-items");

    entry.changes.forEach(change=>{
      const row=document.createElement("button");
      row.type="button";
      row.className=`change-row change-${change.type}`;
      row.innerHTML=`
        <b>${esc(change.pin)}</b>
        <span class="change-before">${esc(formatChangeValue(change.before))}</span>
        <span class="change-arrow">→</span>
        <span class="change-after">${esc(formatChangeValue(change.after))}</span>
      `;
      row.addEventListener("click",()=>focusPin(change.pin));
      body.appendChild(row);
    });

    root.appendChild(section);
  });
}


function configuredPinMap(){
  const map={};
  getConfiguredSnapshot && Object.assign(map,getConfiguredSnapshot());
  return map;
}

function componentConnections(){
  const p=project();
  if(!p)return [];
  const rows=[];
  (p.components||[]).forEach(component=>{
    (component.connections||[]).forEach(conn=>{
      rows.push({
        component:component.name||"Unnamed component",
        type:component.type||"Generic",
        protocol:component.protocol||"Custom",
        signal:conn.signal||"",
        pin:String(conn.pin||"").toUpperCase(),
        note:conn.note||"",
        kind:conn.kind||"signal"
      });
    });
  });
  return rows;
}

function classifyIssue(severity,title,detail,pin="",component=""){
  return {severity,title,detail,pin,component};
}


function normalizeProtocolName(protocol=""){
  return String(protocol||"Custom").trim().toUpperCase();
}

function expectedSignalDescription(protocol,signal){
  const p=normalizeProtocolName(protocol);
  const s=String(signal||"").trim().toUpperCase();

  if(s==="GND"||s.includes("GROUND"))return "GND";
  if(/VCC|VDD|POWER/.test(s))return "Power rail";

  if(p==="I2C"){
    if(s.includes("SCL"))return "I2C*_SCL";
    if(s.includes("SDA"))return "I2C*_SDA";
    return "I2C peripheral pin";
  }

  if(p==="SPI"||p==="SPI 4-WIRE"){
    if(/SCLK|SCK|CLK/.test(s))return "SPI*_SCK";
    if(s.includes("MOSI"))return "SPI*_MOSI";
    if(s.includes("MISO"))return "SPI*_MISO";
    if(s.includes("CS")||s.includes("NSS"))return "Named CS/NSS GPIO or SPI*_NSS";
    if(s.includes("DC"))return "Named DC GPIO output";
    if(s.includes("RST")||s.includes("RESET"))return "Named RST/RESET GPIO output";
    return "SPI or GPIO pin";
  }

  if(p==="SPI 3-WIRE"){
    if(/SCLK|SCK|CLK/.test(s))return "SPI*_SCK";
    if(s.includes("DATA"))return "SPI data pin or suitable GPIO output";
    if(s.includes("CS"))return "Named CS GPIO output";
    if(s.includes("DC"))return "Named DC GPIO output";
    if(s.includes("RST")||s.includes("RESET"))return "Named RST/RESET GPIO output";
    return "SPI or GPIO pin";
  }

  if(p==="UART"){
    if(s==="TX"||s.includes("_TX"))return "USART/UART TX or RX pin as wired";
    if(s==="RX"||s.includes("_RX"))return "USART/UART RX or TX pin as wired";
    return "USART/UART pin";
  }

  if(p==="ANALOG")return "ADC pin";
  if(p==="PWM")return "TIM*_CH* timer/PWM pin";
  if(p==="GPIO"||p==="DIGITAL GPIO")return "GPIO or EXTI pin";
  if(p==="GPIO / PWM")return "GPIO, EXTI or TIM*_CH* pin";

  return "Configured IOC pin";
}

function connectionMatchesProtocol(conn,cfg,protocol){
  const p=normalizeProtocolName(protocol);
  const signal=String(conn?.signal||"").trim().toUpperCase();
  const pin=String(conn?.pin||"").trim().toUpperCase();
  const iocSignal=String(cfg?.signal||"").trim().toUpperCase();
  const label=String(cfg?.label||"").trim().toUpperCase();

  if(!pin)return {ok:false,reason:"No MCU pin selected"};

  // Power rails are not MCU peripheral-function checks.
  if(pin==="GND"||pin==="3V3"||pin==="5V"||pin==="VIN")return {ok:true};
  if(signal==="GND"||signal.includes("GROUND"))return {ok:pin==="GND",reason:"Ground should be connected to GND"};
  if(/VCC|VDD|POWER/.test(signal))return {ok:["3V3","5V","VIN"].includes(pin),reason:"Power should use an appropriate supply rail"};

  if(!cfg)return {ok:false,reason:`${pin} is not configured in the active IOC`};

  if(p==="I2C"){
    if(signal.includes("SCL"))return {ok:/I2C\d*_SCL/.test(iocSignal),reason:`Expected I2C*_SCL, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("SDA"))return {ok:/I2C\d*_SDA/.test(iocSignal),reason:`Expected I2C*_SDA, found ${iocSignal||"unconfigured"}`};
    return {ok:/I2C/.test(iocSignal),reason:`Expected I2C function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="SPI"||p==="SPI 4-WIRE"){
    if(/SCLK|SCK|CLK/.test(signal))return {ok:/SPI\d*_(SCK|CLK)/.test(iocSignal),reason:`Expected SPI*_SCK, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("MOSI"))return {ok:/SPI\d*_MOSI/.test(iocSignal),reason:`Expected SPI*_MOSI, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("MISO"))return {ok:/SPI\d*_MISO/.test(iocSignal),reason:`Expected SPI*_MISO, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("CS")||signal.includes("NSS")){
      const nameMatch=label.includes("CS")||label.includes("NSS");
      const functionMatch=/SPI\d*_NSS/.test(iocSignal)||iocSignal==="GPIO_OUTPUT";
      return {ok:nameMatch||functionMatch,reason:`Expected CS/NSS-labelled GPIO or SPI*_NSS, found ${label||"(no label)"} / ${iocSignal||"unconfigured"}`};
    }
    if(signal.includes("DC")){
      const ok=label.includes("DC")||iocSignal==="GPIO_OUTPUT";
      return {ok,reason:`Expected DC-labelled GPIO output, found ${label||"(no label)"} / ${iocSignal||"unconfigured"}`};
    }
    if(signal.includes("RST")||signal.includes("RESET")){
      const ok=label.includes("RST")||label.includes("RESET")||iocSignal==="GPIO_OUTPUT";
      return {ok,reason:`Expected RST/RESET-labelled GPIO output, found ${label||"(no label)"} / ${iocSignal||"unconfigured"}`};
    }
    return {ok:/SPI|GPIO/.test(iocSignal),reason:`Expected SPI/GPIO function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="SPI 3-WIRE"){
    if(/SCLK|SCK|CLK/.test(signal))return {ok:/SPI\d*_(SCK|CLK)/.test(iocSignal),reason:`Expected SPI*_SCK, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("DATA"))return {ok:/SPI\d*_(MOSI|MISO)/.test(iocSignal)||iocSignal==="GPIO_OUTPUT",reason:`Expected SPI data or GPIO output, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("CS")){
      const ok=label.includes("CS")||iocSignal==="GPIO_OUTPUT";
      return {ok,reason:`Expected CS-labelled GPIO output, found ${label||"(no label)"} / ${iocSignal||"unconfigured"}`};
    }
    if(signal.includes("DC")){
      const ok=label.includes("DC")||iocSignal==="GPIO_OUTPUT";
      return {ok,reason:`Expected DC-labelled GPIO output, found ${label||"(no label)"} / ${iocSignal||"unconfigured"}`};
    }
    if(signal.includes("RST")||signal.includes("RESET")){
      const ok=label.includes("RST")||label.includes("RESET")||iocSignal==="GPIO_OUTPUT";
      return {ok,reason:`Expected RST/RESET-labelled GPIO output, found ${label||"(no label)"} / ${iocSignal||"unconfigured"}`};
    }
    return {ok:/SPI|GPIO/.test(iocSignal),reason:`Expected SPI/GPIO function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="UART"){
    // Module TX typically connects to MCU RX, and module RX to MCU TX.
    if(signal==="TX"||signal.endsWith("_TX")){
      return {ok:/(USART|UART)\d*_RX/.test(iocSignal),reason:`Module TX should normally connect to MCU RX; found ${iocSignal||"unconfigured"}`};
    }
    if(signal==="RX"||signal.endsWith("_RX")){
      return {ok:/(USART|UART)\d*_TX/.test(iocSignal),reason:`Module RX should normally connect to MCU TX; found ${iocSignal||"unconfigured"}`};
    }
    return {ok:/(USART|UART)/.test(iocSignal),reason:`Expected USART/UART function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="ANALOG"){
    return {ok:/ADC/.test(iocSignal),reason:`Expected ADC function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="PWM"){
    return {ok:/TIM\d*_CH/.test(iocSignal),reason:`Expected TIM*_CH* PWM function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="GPIO"||p==="DIGITAL GPIO"){
    return {ok:/GPIO_(INPUT|OUTPUT)|EXTI/.test(iocSignal),reason:`Expected GPIO/EXTI function, found ${iocSignal||"unconfigured"}`};
  }


  if(p==="TRIGGER / ECHO GPIO"){
    if(signal.includes("TRIG"))return {ok:iocSignal==="GPIO_OUTPUT",reason:`Expected GPIO_Output for trigger, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("ECHO"))return {ok:/GPIO_INPUT|EXTI|TIM\d*_CH/.test(iocSignal),reason:`Expected GPIO input / EXTI / timer capture for echo, found ${iocSignal||"unconfigured"}`};
    return {ok:/GPIO/.test(iocSignal),reason:`Expected GPIO function, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="1-WIRE"||p==="SINGLE-WIRE DIGITAL"){
    return {ok:/GPIO_INPUT|GPIO_OUTPUT|GPIO/.test(iocSignal),reason:`Expected GPIO for single-wire data, found ${iocSignal||"unconfigured"}`};
  }

  if(p==="MOTOR DRIVER / PWM"){
    if(signal.includes("PWM"))return {ok:/TIM\d*_CH/.test(iocSignal),reason:`Expected TIM*_CH* PWM output, found ${iocSignal||"unconfigured"}`};
    if(signal.includes("MOTOR_A")||signal.includes("MOTOR_B"))return {ok:iocSignal==="GPIO_OUTPUT",reason:`Expected GPIO_Output to motor driver input, found ${iocSignal||"unconfigured"}`};
    return {ok:true};
  }

  if(p==="MOTOR DRIVER / GPIO"){
    if(signal.includes("MOTOR_A")||signal.includes("MOTOR_B"))return {ok:iocSignal==="GPIO_OUTPUT",reason:`Expected GPIO_Output to motor driver input, found ${iocSignal||"unconfigured"}`};
    return {ok:true};
  }

  if(p==="ANALOG DIVIDER"){
    if(signal.includes("ADC"))return {ok:/ADC/.test(iocSignal),reason:`Expected ADC input, found ${iocSignal||"unconfigured"}`};
    return {ok:true};
  }

  if(p==="REFERENCE ONLY")return {ok:true};

  if(p==="GPIO / PWM"){
    return {ok:/GPIO_(INPUT|OUTPUT)|EXTI|TIM\d*_CH/.test(iocSignal),reason:`Expected GPIO/EXTI/TIM function, found ${iocSignal||"unconfigured"}`};
  }

  return {ok:!!iocSignal,reason:`${pin} is not configured in the active IOC`};
}

function protocolRequiredSignals(component){
  const type=component?.type||"Generic";
  const p=normalizeProtocolName(component?.protocol);


  if(type==="16x2 I2C LCD")return ["VCC","GND","SCL","SDA"];
  if(type==="HY-SRF05 Ultrasonic Sensor")return ["VCC","GND","TRIG","ECHO"];
  if(type==="DS18B20 Temperature Sensor")return ["VCC","GND","DQ"];
  if(type==="DHT11 Temp/Humidity Sensor")return ["VCC","GND","DATA"];
  if(type==="HC-05 Bluetooth Module")return ["VCC","GND","TX","RX"];
  if(type==="N20 DC Gear Motor")return ["MOTOR_A","MOTOR_B","GND","MOTOR_POWER"];
  if(type==="Ambient Light Sensor")return ["VCC","GND","ANALOG_OUT"];
  if(type==="10K NTC Thermistor Probe")return ["ADC_SENSE","VREF","GND"];
  if(type==="0.96in SPI OLED")return ["VCC","GND","SCLK","MOSI","CS","DC","RST"];
  if(type==="MQ2 Gas Sensor")return ["VCC","GND",p==="DIGITAL GPIO"?"DO":"AO"];
  if(type==="ESP8266 NodeMCU")return ["TX","RX","GND","POWER"];
  if(type==="ESP32-S3 Mini Dev Board")return ["TX","RX","GND","POWER"];
  if(type==="USB A-to-A Cable")return [];

  if(type==="OLED Display"){
    if(p==="I2C")return ["VCC","GND","SCL","SDA"];
    if(p==="SPI 3-WIRE")return ["VCC","GND","SCLK","DATA","CS"];
    if(p==="SPI 4-WIRE")return ["VCC","GND","SCLK","MOSI","CS","DC","RST"];
  }

  if(type==="Sensor"){
    if(p==="ANALOG")return ["VCC","GND","ANALOG_OUT"];
    if(p==="DIGITAL GPIO")return ["VCC","GND","SIGNAL"];
    if(p==="I2C")return ["VCC","GND","SCL","SDA"];
    if(p==="SPI")return ["VCC","GND","SCLK","MOSI","MISO","CS"];
    if(p==="UART")return ["VCC","GND","TX","RX"];
  }

  if(type==="Communication Module"){
    if(p==="UART")return ["VCC","GND","TX","RX"];
    if(p==="I2C")return ["VCC","GND","SCL","SDA"];
    if(p==="SPI")return ["VCC","GND","SCLK","MOSI","MISO","CS"];
  }

  if(type==="Motor / Servo")return [p==="PWM"?"PWM_CONTROL":"CONTROL","GND","POWER"];
  if(type==="Buzzer")return ["CONTROL","GND"];
  if(type==="LED")return ["ANODE / GPIO","CATHODE"];
  if(type==="Push Button")return ["BUTTON_SIGNAL","OTHER_SIDE"];

  return [];
}

function addProtocolAwareIssues(component,cfg,issues){
  const protocol=component?.protocol||"Custom";
  const required=protocolRequiredSignals(component);
  const conns=component?.connections||[];
  const bySignal=name=>conns.find(c=>String(c.signal||"").trim().toUpperCase()===name.toUpperCase());

  for(const requiredSignal of required){
    const conn=bySignal(requiredSignal);
    if(!conn){
      issues.push(classifyIssue(
        "error",
        `${component.name} — missing ${requiredSignal}`,
        `${component.type} using ${protocol} expects a ${requiredSignal} connection.`,
        "",
        component.name
      ));
    }
  }

  for(const conn of conns){
    const pin=String(conn.pin||"").trim().toUpperCase();
    if(!pin)continue;
    const result=connectionMatchesProtocol(conn,cfg[pin],protocol);

    if(!result.ok){
      issues.push(classifyIssue(
        "warning",
        `${component.name} — ${conn.signal||"connection"} mismatch`,
        `${pin} is selected for ${conn.signal||"this connection"}, but it does not match ${protocol}. ${result.reason}. Expected: ${expectedSignalDescription(protocol,conn.signal)}.`,
        pin,
        component.name
      ));
    }
  }
}

function runSmartProjectCheck(){
  const p=project();
  const issues=[];
  const cfg=configuredPinMap();
  const rows=componentConnections();

  if(!p){
    return {issues:[classifyIssue("error","No project selected","Select or create a NucleoPin project first.")],stats:{errors:1,warnings:0,info:0}};
  }

  if(!currentIoc(p)){
    issues.push(classifyIssue("error","No active IOC","Add or select an IOC file before checking the project."));
  }

  // Board-specific pins on NUCLEO-F401RE/F411RE.
  const boardNotes={
    "PA5":{
      title:"PA5 is also connected to onboard LD2",
      detail:"External hardware on PA5/D13 shares the line with the Nucleo green user LED (LD2). This may affect the external circuit or make LD2 light."
    },
    "PC13":{
      title:"PC13 is connected to onboard user button B1",
      detail:"PC13 is already used by the Nucleo user button. External circuitry can interact with the onboard button network."
    },
    "PA13":{
      title:"PA13 is normally SWDIO",
      detail:"PA13 is used for SWD debugging/programming. Reassigning it can make normal ST-LINK debugging unavailable."
    },
    "PA14":{
      title:"PA14 is normally SWCLK",
      detail:"PA14 is used for SWD debugging/programming. Reassigning it can make normal ST-LINK debugging unavailable."
    },
    "PA2":{
      title:"PA2 may be connected to ST-LINK Virtual COM",
      detail:"USART2_TX on PA2 is commonly routed to the onboard ST-LINK virtual COM port on Nucleo-64 boards."
    },
    "PA3":{
      title:"PA3 may be connected to ST-LINK Virtual COM",
      detail:"USART2_RX on PA3 is commonly routed to the onboard ST-LINK virtual COM port on Nucleo-64 boards."
    }
  };

  const componentPins=new Map();

  for(const row of rows){
    if(!row.pin)continue;

    if(!["GND","3V3","5V","VIN"].includes(row.pin)){
      if(!componentPins.has(row.pin))componentPins.set(row.pin,[]);
      componentPins.get(row.pin).push(row);
    }

    if(boardNotes[row.pin]){
      const n=boardNotes[row.pin];
      const severity=(row.pin==="PA13"||row.pin==="PA14") ? "warning" : "info";
      issues.push(classifyIssue(severity,n.title,`${n.detail} Used by ${row.component}: ${row.signal||"signal"}.`,row.pin,row.component));
    }

    if(!["GND","3V3","5V","VIN"].includes(row.pin) && !cfg[row.pin]){
      issues.push(classifyIssue(
        "warning",
        `${row.pin} is not configured in the active IOC`,
        `${row.component} uses ${row.pin} for ${row.signal||"a connection"}, but the active IOC does not currently configure that MCU pin.`,
        row.pin,row.component
      ));
    }
  }

  // Same MCU pin assigned to multiple component signals.
  for(const [pin,uses] of componentPins.entries()){
    const uniqueComponents=[...new Set(uses.map(x=>x.component))];
    const uniqueSignals=[...new Set(uses.map(x=>`${x.component}:${x.signal}`))];

    if(uniqueSignals.length>1){
      issues.push(classifyIssue(
        "error",
        `Multiple component connections use ${pin}`,
        uses.map(x=>`${x.component} — ${x.signal||"connection"}`).join("; "),
        pin,
        uniqueComponents.join(", ")
      ));
    }
  }

  // Per-component support checks.
  for(const component of (p.components||[])){
    const conns=component.connections||[];

    // v1.1 protocol-aware validation.
    addProtocolAwareIssues(component,cfg,issues);
    const pins=conns.map(c=>String(c.pin||"").toUpperCase());
    const signals=conns.map(c=>String(c.signal||"").toUpperCase());
    const notes=conns.map(c=>String(c.note||"").toLowerCase()).join(" ");

    const hasGnd=pins.includes("GND") || signals.some(s=>s==="GND"||s.includes("GROUND"));
    const hasPower=pins.some(pin=>["3V3","5V","VIN"].includes(pin)) || signals.some(s=>["VCC","VDD","POWER","+3V3","+5V"].some(k=>s.includes(k)));

    if(["OLED Display","Sensor","Communication Module"].includes(component.type)){
      if(!hasGnd){
        issues.push(classifyIssue("error",`${component.name} has no GND connection`,"Add a ground connection so the module shares the MCU reference.", "", component.name));
      }
      if(!hasPower){
        issues.push(classifyIssue("warning",`${component.name} has no saved power connection`,"Add the module supply rail and confirm its required voltage.", "", component.name));
      }
    }

    if(component.type==="LED"){
      if(!hasGnd){
        issues.push(classifyIssue("warning",`${component.name} has no GND return`,"A typical indicator LED circuit needs a complete current path.", "", component.name));
      }

      const resistorMention=/\b(220|330|470|1k|resistor|ohm|Ω)\b/i.test(notes);
      if(!resistorMention){
        issues.push(classifyIssue(
          "error",
          `${component.name} has no series resistor recorded`,
          "Add a current-limiting resistor. NucleoPin uses 330 Ω as a typical 3.3 V indicator-LED starting value.",
          "",component.name
        ));
      }
    }

    if(component.type==="Push Button"){
      if(!hasGnd && !pins.includes("3V3")){
        issues.push(classifyIssue("warning",`${component.name} has no reference connection`,"Save the button's GND or 3V3 side so its logic state is defined.", "",component.name));
      }

      if(!notes.includes("pull-up") && !notes.includes("pullup") && !notes.includes("pull-down") && !notes.includes("pulldown")){
        issues.push(classifyIssue("info",`${component.name}: check input pull resistor`,"Use an internal or external pull-up/pull-down so the GPIO input does not float.", "",component.name));
      }
    }

    if(component.type==="Motor / Servo"){
      if(!hasGnd){
        issues.push(classifyIssue("error",`${component.name} has no common GND`,"The external supply and Nucleo normally need a common ground reference for the control signal.", "",component.name));
      }
      if(!signals.some(s=>s.includes("POWER")) && !hasPower){
        issues.push(classifyIssue("warning",`${component.name} has no power source recorded`,"Do not power a motor directly from an STM32 GPIO. Record a suitable external supply.", "",component.name));
      }
    }

    if(component.type==="Buzzer" && !hasGnd){
      issues.push(classifyIssue("warning",`${component.name} has no GND connection`,"Add the return path and check whether the buzzer requires a transistor driver.", "",component.name));
    }


  }

  // IOC-specific debug protection even when no component is attached.
  ["PA13","PA14"].forEach(pin=>{
    const sig=cfg[pin]?.signal||"";
    if(sig && !/SWD|JT|SYS/i.test(sig)){
      issues.push(classifyIssue(
        "warning",
        `${pin} is configured away from normal debug use`,
        `${pin} currently shows ${sig}. Verify that you intentionally want to use an SWD pin for the application.`,
        pin
      ));
    }
  });

  if(!issues.length){
    issues.push(classifyIssue("ok","No obvious project issues found","NucleoPin did not detect any of its current board, IOC, or component-wiring checks."));
  }

  const stats={
    errors:issues.filter(x=>x.severity==="error").length,
    warnings:issues.filter(x=>x.severity==="warning").length,
    info:issues.filter(x=>x.severity==="info").length,
    ok:issues.filter(x=>x.severity==="ok").length
  };

  return {issues,stats};
}

function renderSmartCheck(result=null){
  const root=$("smartCheckList");
  const summary=$("smartCheckSummary");

  if(!result){
    root.className="smart-check-list empty";
    root.textContent="No check results yet.";
    summary.textContent="Run a check to review the active project.";
    return;
  }

  const {issues,stats}=result;

  summary.innerHTML=`
    <span class="check-count check-error">${stats.errors} error${stats.errors===1?"":"s"}</span>
    <span class="check-count check-warning">${stats.warnings} warning${stats.warnings===1?"":"s"}</span>
    <span class="check-count check-info">${stats.info} info</span>
  `;

  root.className="smart-check-list";
  root.innerHTML="";

  const order={error:0,warning:1,info:2,ok:3};
  [...issues].sort((a,b)=>order[a.severity]-order[b.severity]).forEach(issue=>{
    const row=document.createElement("button");
    row.type="button";
    row.className=`smart-check-row severity-${issue.severity}`;
    row.innerHTML=`
      <span class="check-icon">${issue.severity==="error"?"✕":issue.severity==="warning"?"!":issue.severity==="info"?"i":"✓"}</span>
      <span class="check-copy">
        <b>${esc(issue.title)}</b>
        <small>${esc(issue.detail)}</small>
      </span>
      ${issue.pin?`<span class="check-pin">${esc(issue.pin)}</span>`:""}
    `;
    if(issue.pin){
      row.addEventListener("click",()=>focusPin(issue.pin));
    }
    root.appendChild(row);
  });
}

function executeSmartCheck(){
  const result=runSmartProjectCheck();
  renderSmartCheck(result);
  const p=project();
  if(p){
    p.lastSmartCheck={
      timestamp:Date.now(),
      stats:result.stats
    };
    save();
  }
}

function renderComponents(){
 const p=project(),root=$("componentList");root.innerHTML="";
 if(!p||!p.components.length){root.className="component-list empty";root.textContent="No components yet.";return}
 root.className="component-list";
 p.components.forEach(c=>{const row=document.createElement("div");row.className="component-row";const chips=c.connections.map(x=>`<span class="connection-chip">${esc(x.signal||"?")} → ${esc(x.pin||"?")}</span>`).join("");row.innerHTML=`<div class="label">${esc(c.name)} <span class="badge">${esc(c.type)}</span> <span class="badge protocol-badge">${esc(c.protocol||"Custom")}</span></div><div>${chips}</div><button class="remove-x">×</button>`;row.onclick=e=>{if(e.target.classList.contains("remove-x")){
 e.stopPropagation();
 if(confirm(`Remove "${c.name}" from this project?`)){
   const deletedIndex=p.components.findIndex(x=>x.id===c.id);
   lastDeletedComponent={projectId:p.id,component:structuredClone(c),index:deletedIndex};
   p.components=p.components.filter(x=>x.id!==c.id);
   save();
   renderComponents();
   renderWiring();
   publishWiringToVisualizer();
   showToast(`Removed ${c.name}`,"Undo",async()=>{
     const target=state.projects.find(x=>x.id===lastDeletedComponent?.projectId);
     if(!target||!lastDeletedComponent)return;
     const at=Math.max(0,Math.min(lastDeletedComponent.index,target.components.length));
     target.components.splice(at,0,lastDeletedComponent.component);
     lastDeletedComponent=null;
     await save();
     renderComponents();
     renderWiring();
     publishWiringToVisualizer();
     showToast("Component restored");
   },5000);
 }
 return
}openComponentModal(c)};root.appendChild(row)})
}
function wiringRows(){
 const p=project();if(!p)return[];
 const rows=[];
 p.components.forEach(c=>c.connections.forEach(x=>rows.push({component:c.name,type:c.type,signal:x.signal||"",pin:(x.pin||"").toUpperCase(),note:x.note||"",label:p.pinLabels[(x.pin||"").toUpperCase()]||""})));
 return rows
}

function publishWiringToVisualizer(){
  try{
    const p=project();
    const rows=wiringRows();
    frame.contentWindow.NucleoPinDesktopPrintData = {
      projectName: p?.name || "",
      iocFile: currentIoc(p)?.path || "",
      wiringRows: rows.map(r=>({
        component:r.component || "",
        type:r.type || "",
        signal:r.signal || "",
        pin:r.pin || "",
        label:r.label || "",
        note:r.note || ""
      }))
    };
  }catch(e){
    console.warn("Could not publish wiring data to visualizer",e);
  }
}

function renderWiring(){
 const root=$("wiringTable"),rows=wiringRows();
 if(!rows.length){root.className="wiring-wrap empty";root.textContent="No wiring to show.";return}
 root.className="wiring-wrap";root.innerHTML=`<table class="wiring-table"><thead><tr><th>Component</th><th>Signal</th><th>Pin</th><th>Project label</th></tr></thead><tbody>${rows.map(r=>`<tr data-pin="${esc(r.pin)}"><td>${esc(r.component)}</td><td>${esc(r.signal)}</td><td><b>${esc(r.pin)}</b></td><td>${esc(r.label||r.note||"—")}</td></tr>`).join("")}</tbody></table>`;
 root.querySelectorAll("tr[data-pin]").forEach(tr=>tr.onclick=()=>focusPin(tr.dataset.pin))
}
function renderDetails(){
 const p=project();
 if(!p){
   activeProjectName.textContent="No project selected";
   activeFileMeta.textContent="Create a project or select one from the left.";
   activeFileMeta.title="";
   notes.value="";
   notes.disabled=true;
   updateTopActionState();
   return;
 }
 notes.disabled=false;
 notes.value=p.notes||"";
 activeProjectName.textContent=p.name;
 const f=currentIoc(p);
 activeFileMeta.textContent=f?fileName(f.path):"No IOC selected";
 activeFileMeta.title=f?.path||"";
 updateTopActionState();
}

function renderDashboard(){
 const p=project();
 const pins=configuredPinsFromVisualizer();
 const groups=buildPeripheralGroups();
 const stats=p?.lastSmartCheck?.stats;
 const active=currentIoc(p);

 $("dashUsedPins").textContent=pins.length;
 $("dashComponents").textContent=p?.components?.length||0;
 $("dashIocs").textContent=p?.iocFiles?.length||0;

 if($("dashPinSub"))$("dashPinSub").textContent=currentIoc()?`${pins.length} configured in active IOC`:"No IOC loaded";
 if($("dashComponentSub"))$("dashComponentSub").textContent=p?.components?.length?`${p.components.length} saved hardware item${p.components.length===1?"":"s"}`:"Nothing added yet";
 if($("dashIocSub"))$("dashIocSub").textContent=active?fileName(active.path):"No active IOC";

 let healthText="—",healthSub="Run Smart Check",healthClass="neutral";
 if(stats){
   if(stats.errors){
     healthText=`${stats.errors} Error${stats.errors===1?"":"s"}`;
     healthSub=`${stats.warnings||0} warning${stats.warnings===1?"":"s"}`;
     healthClass="error";
   }else if(stats.warnings){
     healthText=`${stats.warnings} Warning${stats.warnings===1?"":"s"}`;
     healthSub="No critical errors";
     healthClass="warning";
   }else{
     healthText="OK";
     healthSub="No obvious issues";
     healthClass="ok";
   }
 }

 $("dashCheckState").textContent=healthText;
 if($("dashCheckSub"))$("dashCheckSub").textContent=healthSub;
 if($("dashProjectName"))$("dashProjectName").textContent=p?.name||"No project selected";
 if($("dashActiveIoc"))$("dashActiveIoc").textContent=active?fileName(active.path):"—";
 if($("dashPeripherals"))$("dashPeripherals").textContent=groups.length;

 const badge=$("dashProjectBadge");
 if(badge){
   badge.className=`dashboard-health ${healthClass}`;
   badge.textContent=healthClass==="ok"?"Healthy":healthClass==="warning"?"Warnings":healthClass==="error"?"Needs attention":"Waiting";
 }

 const history=p?.changeHistory||[];
 if($("dashLastChange")){
   $("dashLastChange").textContent=history.length?new Date(history[0].timestamp).toLocaleString():"—";
 }

 const recent=$("dashRecentChanges");
 if(recent){
   if(!history.length){
     recent.className="dashboard-recent empty";
     recent.textContent="No IOC changes recorded yet.";
   }else{
     recent.className="dashboard-recent";
     recent.innerHTML=history.slice(0,3).map(entry=>`
       <button type="button" class="dashboard-change" data-change-time="${entry.timestamp}">
         <span>${new Date(entry.timestamp).toLocaleDateString()} ${new Date(entry.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>
         <b>${entry.changes.length} change${entry.changes.length===1?"":"s"}</b>
       </button>
     `).join("");
     recent.querySelectorAll(".dashboard-change").forEach(btn=>{
       btn.addEventListener("click",()=>setScreen("project"));
     });
   }
 }
}
function renderPinMatrix(){
 const root=$("pinMatrix");
 if(!root)return;

 const configured=configuredPinsFromVisualizer();
 const cfgMap={};
 configured.forEach(p=>cfgMap[p.pin]=p);

 const assignmentMap=new Map();
 componentConnections().forEach(r=>{
   if(!r.pin)return;
   if(!assignmentMap.has(r.pin))assignmentMap.set(r.pin,[]);
   assignmentMap.get(r.pin).push(r);
 });

 const pins=[...new Set([
   ...configured.map(p=>p.pin),
   ...assignmentMap.keys()
 ])].filter(Boolean).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));

 if(!pins.length){
   root.className="pin-matrix empty";
   root.textContent=currentIoc()?"No configured or assigned MCU pins detected.":"Load an IOC to build the matrix.";
   return;
 }

 const rows=pins.map(pin=>{
   const cfg=cfgMap[pin]||null;
   const assignments=assignmentMap.get(pin)||[];

   let status="free";
   let statusLabel="IOC only";
   let severity=0;

   if(assignments.length){
     if(!cfg){
       status="warning";
       statusLabel="Not in IOC";
       severity=2;
     }else{
       const checks=assignments.map(a=>({
         a,
         result:connectionMatchesProtocol(
           {signal:a.signal,pin:a.pin},
           cfg,
           a.protocol||"Custom"
         )
       }));

       const bad=checks.filter(x=>!x.result.ok);
       const duplicate=assignments.length>1;

       if(bad.length||duplicate){
         status=bad.length?"warning":"info";
         statusLabel=bad.length?"Protocol mismatch":"Shared pin";
         severity=bad.length?2:1;
       }else{
         status="ok";
         statusLabel="Matched";
         severity=0;
       }
     }
   }

   return {
     pin,
     label:cfg?.label||"",
     signal:cfg?.signal||"",
     mode:cfg?.mode||"",
     assignments,
     status,
     statusLabel,
     severity
   };
 });

 root.className="pin-matrix";
 root.innerHTML=`
   <div class="matrix-toolbar">
     <input id="matrixSearch" type="search" placeholder="Search pin, IOC label, function, component..." />
     <select id="matrixStatusFilter">
       <option value="all">All rows</option>
       <option value="assigned">Component assigned</option>
       <option value="ok">Matched</option>
       <option value="warning">Needs attention</option>
       <option value="ioc">IOC only</option>
     </select>
     <div class="matrix-summary">
       <span><b>${rows.length}</b> pins</span>
       <span class="matrix-summary-ok"><b>${rows.filter(r=>r.status==="ok").length}</b> matched</span>
       <span class="matrix-summary-warn"><b>${rows.filter(r=>r.status==="warning").length}</b> attention</span>
     </div>
   </div>
   <div class="matrix-table-wrap">
     <table>
       <thead>
         <tr>
           <th>MCU Pin</th>
           <th>CubeMX Label</th>
           <th>CubeMX Function</th>
           <th>Component</th>
           <th>Signal</th>
           <th>Protocol</th>
           <th>Status</th>
         </tr>
       </thead>
       <tbody id="matrixBody"></tbody>
     </table>
   </div>
 `;

 const body=$("matrixBody");
 const search=$("matrixSearch");
 const filter=$("matrixStatusFilter");

 function rowMatchesFilter(row){
   const f=filter.value;
   if(f==="all")return true;
   if(f==="assigned")return row.assignments.length>0;
   if(f==="ok")return row.status==="ok";
   if(f==="warning")return row.status==="warning"||row.status==="info";
   if(f==="ioc")return row.assignments.length===0;
   return true;
 }

 function renderRows(){
   const q=search.value.trim().toLowerCase();
   body.innerHTML="";

   const visible=rows.filter(row=>{
     if(!rowMatchesFilter(row))return false;

     const assignmentText=row.assignments.map(a=>
       `${a.component||""} ${a.signal||""} ${a.protocol||""}`
     ).join(" ");

     const hay=`${row.pin} ${row.label} ${row.signal} ${row.mode} ${assignmentText}`.toLowerCase();
     return !q||hay.includes(q);
   });

   if(!visible.length){
     body.innerHTML=`<tr><td colspan="7" class="matrix-no-results">No pin rows match this filter.</td></tr>`;
     return;
   }

   visible
     .sort((a,b)=>b.severity-a.severity||a.pin.localeCompare(b.pin,undefined,{numeric:true}))
     .forEach(row=>{
       const tr=document.createElement("tr");
       tr.className=`matrix-row matrix-status-${row.status}`;
       tr.dataset.pin=row.pin;

       const componentHtml=row.assignments.length
         ? row.assignments.map(a=>`<span class="matrix-chip">${esc(a.component||"Unnamed")}</span>`).join("")
         : '<span class="matrix-muted">—</span>';

       const signalHtml=row.assignments.length
         ? row.assignments.map(a=>`<span class="matrix-line">${esc(a.signal||"—")}</span>`).join("")
         : '<span class="matrix-muted">—</span>';

       const protocolHtml=row.assignments.length
         ? row.assignments.map(a=>`<span class="matrix-protocol">${esc(a.protocol||"Custom")}</span>`).join("")
         : '<span class="matrix-muted">—</span>';

       tr.innerHTML=`
         <td><button type="button" class="matrix-pin-button" data-pin="${esc(row.pin)}">${esc(row.pin)}</button></td>
         <td>${esc(row.label||"—")}</td>
         <td><span class="matrix-function">${esc(row.signal||"—")}</span></td>
         <td>${componentHtml}</td>
         <td>${signalHtml}</td>
         <td>${protocolHtml}</td>
         <td><span class="matrix-status-badge ${row.status}">${esc(row.statusLabel)}</span></td>
       `;

       tr.querySelector(".matrix-pin-button").addEventListener("click",()=>focusPin(row.pin));
       body.appendChild(tr);
     });
 }

 search.addEventListener("input",renderRows);
 filter.addEventListener("change",renderRows);
 renderRows();
}

function snippetForPin(p){
 const pin=p.pin,port=pin?.[1],num=pin?.slice(2),sig=String(p.signal||"");
 if(!/^P[A-H]\d+$/.test(pin))return "";
 if(sig==="GPIO_Output")return `HAL_GPIO_WritePin(GPIO${port}, GPIO_PIN_${num}, GPIO_PIN_SET);\\nHAL_GPIO_WritePin(GPIO${port}, GPIO_PIN_${num}, GPIO_PIN_RESET);`;
 if(sig==="GPIO_Input"||/EXTI/.test(sig))return `GPIO_PinState state = HAL_GPIO_ReadPin(GPIO${port}, GPIO_PIN_${num});`;
 if(/I2C/.test(sig))return `// ${pin}: ${sig}\\n// Use HAL_I2C_Master_Transmit / HAL_I2C_Master_Receive with the CubeMX-generated handle.`;
 if(/SPI/.test(sig))return `// ${pin}: ${sig}\\n// Use HAL_SPI_Transmit / HAL_SPI_Receive with the CubeMX-generated handle.`;
 if(/USART|UART/.test(sig))return `// ${pin}: ${sig}\\n// Use HAL_UART_Transmit / HAL_UART_Receive with the CubeMX-generated handle.`;
 if(/ADC/.test(sig))return `// ${pin}: ${sig}\\nHAL_ADC_Start(&hadc1);\\nHAL_ADC_PollForConversion(&hadc1, HAL_MAX_DELAY);\\nuint32_t value = HAL_ADC_GetValue(&hadc1);`;
 if(/TIM/.test(sig))return `// ${pin}: ${sig}\\n// Start the configured timer/PWM channel with HAL_TIM_PWM_Start(...).`;
 return `// ${pin}: ${sig||"configured pin"}\\n// Peripheral initialization is generated by CubeMX.`;
}
function personalizedSnippet(groupTitle,p){
 const pin=String(p?.pin||"");
 const label=String(p?.label||pin||"PIN");
 const signal=String(p?.signal||"");
 const port=pin.length>=2?pin[1]:"A";
 const num=pin.slice(2)||"0";
 const safeLabel=label.replace(/[^A-Za-z0-9_]/g,"_");

 if(groupTitle==="GPIO Outputs"){
   return `// ${label} — ${pin} (${signal})
HAL_GPIO_WritePin(GPIO${port}, GPIO_PIN_${num}, GPIO_PIN_SET);

// Later, turn ${label} off:
HAL_GPIO_WritePin(GPIO${port}, GPIO_PIN_${num}, GPIO_PIN_RESET);`;
 }

 if(groupTitle==="GPIO Inputs / EXTI"){
   if(/EXTI/.test(signal)){
     return `// ${label} — ${pin} (${signal})
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == GPIO_PIN_${num})
    {
        // ${label} was triggered
    }
}`;
   }

   return `// ${label} — ${pin} (${signal})
GPIO_PinState ${safeLabel.toLowerCase()}_state =
    HAL_GPIO_ReadPin(GPIO${port}, GPIO_PIN_${num});

if (${safeLabel.toLowerCase()}_state == GPIO_PIN_SET)
{
    // ${label} is HIGH
}`;
 }

 if(groupTitle==="I2C"){
   const bus=(signal.match(/I2C(\d+)/i)||[])[1]||"1";
   return `// ${label} — ${pin} (${signal})
uint8_t data[2] = {0x00, 0xFF};

HAL_I2C_Master_Transmit(
    &hi2c${bus},
    deviceAddress << 1,
    data,
    sizeof(data),
    HAL_MAX_DELAY
);`;
 }

 if(groupTitle==="SPI"){
   const bus=(signal.match(/SPI(\d+)/i)||[])[1]||"1";

   if(/SCK/.test(signal)){
     return `// ${label} — ${pin} (${signal})
//
// ${pin} is the clock line for SPI${bus}.
// CubeMX configures this pin automatically.
// Use the SPI${bus} handle when sending data:

uint8_t data[] = {0xAA, 0x55};
HAL_SPI_Transmit(&hspi${bus}, data, sizeof(data), HAL_MAX_DELAY);`;
   }

   if(/MOSI/.test(signal)){
     return `// ${label} — ${pin} (${signal})
//
// ${pin} carries controller-to-device data on SPI${bus}.

uint8_t data[] = {0xAA, 0x55};
HAL_SPI_Transmit(&hspi${bus}, data, sizeof(data), HAL_MAX_DELAY);`;
   }

   if(/MISO/.test(signal)){
     return `// ${label} — ${pin} (${signal})
//
// ${pin} carries device-to-controller data on SPI${bus}.

uint8_t rx[2];
HAL_SPI_Receive(&hspi${bus}, rx, sizeof(rx), HAL_MAX_DELAY);`;
   }

   return `// ${label} — ${pin} (${signal})
uint8_t data[] = {0xAA, 0x55};
HAL_SPI_Transmit(&hspi${bus}, data, sizeof(data), HAL_MAX_DELAY);`;
 }

 if(groupTitle==="UART / USART"){
   const match=signal.match(/(?:USART|UART)(\d+)/i);
   const bus=match?.[1]||"2";
   const handle=`huart${bus}`;

   if(/_RX/i.test(signal)){
     return `// ${label} — ${pin} (${signal})
uint8_t rxByte;

HAL_UART_Receive(
    &${handle},
    &rxByte,
    1,
    HAL_MAX_DELAY
);`;
   }

   return `// ${label} — ${pin} (${signal})
char message[] = "${label}\\r\\n";

HAL_UART_Transmit(
    &${handle},
    (uint8_t *)message,
    strlen(message),
    HAL_MAX_DELAY
);`;
 }

 if(groupTitle==="ADC"){
   const adc=(signal.match(/ADC(\d+)/i)||[])[1]||"1";
   return `// ${label} — ${pin} (${signal})
HAL_ADC_Start(&hadc${adc});
HAL_ADC_PollForConversion(&hadc${adc}, HAL_MAX_DELAY);

uint32_t ${safeLabel.toLowerCase()}_value =
    HAL_ADC_GetValue(&hadc${adc});

HAL_ADC_Stop(&hadc${adc});`;
 }

 if(groupTitle==="Timer / PWM"){
   const timer=(signal.match(/TIM(\d+)/i)||[])[1]||"2";
   const channel=(signal.match(/CH(\d+)/i)||[])[1]||"1";
   return `// ${label} — ${pin} (${signal})
HAL_TIM_PWM_Start(&htim${timer}, TIM_CHANNEL_${channel});

// Update ${label} duty cycle:
__HAL_TIM_SET_COMPARE(
    &htim${timer},
    TIM_CHANNEL_${channel},
    duty
);`;
 }

 return `// ${label} — ${pin} (${signal})
// Peripheral initialization is generated by CubeMX.`;
}

function renderCodeSnippets(){
 const root=$("codeSnippets");
 if(!root)return;

 const pins=configuredPinsFromVisualizer();

 if(!pins.length){
   root.className="code-snippet-grid empty";
   root.textContent=currentIoc()?"No configured MCU pins detected.":"Load an IOC to generate snippets.";
   return;
 }

 const groups=[];

 function addGroup(title,subtitle,items){
   if(!items.length)return;
   groups.push({title,subtitle,items,selected:items[0]});
 }

 addGroup("GPIO Outputs","Click a pin to generate a HAL example for that exact output.",pins.filter(p=>p.signal==="GPIO_Output"));
 addGroup("GPIO Inputs / EXTI","Click a pin to generate input or interrupt code for that exact pin.",pins.filter(p=>p.signal==="GPIO_Input"||/EXTI/.test(p.signal||"")));
 addGroup("I2C","Click SCL/SDA to generate code using the matching I2C handle.",pins.filter(p=>/I2C/.test(p.signal||"")));
 addGroup("SPI","Click a SPI pin to generate a personalized SPI example.",pins.filter(p=>/SPI/.test(p.signal||"")));
 addGroup("UART / USART","Click TX or RX to generate matching transmit/receive code.",pins.filter(p=>/USART|UART/.test(p.signal||"")));
 addGroup("ADC","Click an ADC pin to generate a read example for that ADC.",pins.filter(p=>/ADC/.test(p.signal||"")));
 addGroup("Timer / PWM","Click a timer channel to generate PWM code for that channel.",pins.filter(p=>/TIM\d*_CH/.test(p.signal||"")));

 root.className="code-snippet-sections";
 root.innerHTML=groups.map((g,i)=>{
   const selected=g.selected;
   const code=personalizedSnippet(g.title,selected);

   return `
     <section class="code-section" data-code-group="${i}">
       <div class="code-section-head">
         <div>
           <h3>${esc(g.title)}</h3>
           <p>${esc(g.subtitle)}</p>
         </div>
         <span>${g.items.length} pin${g.items.length===1?"":"s"}</span>
       </div>

       <div class="code-pin-list">
         ${g.items.map((p,index)=>`
           <button type="button"
                   class="code-pin-chip${index===0?" selected":""}"
                   data-pin="${esc(p.pin)}"
                   data-group="${i}"
                   data-index="${index}">
             <b>${esc(p.label||p.pin)}</b>
             <small>${esc(p.pin)} · ${esc(p.signal||"Configured")}</small>
           </button>
         `).join("")}
       </div>

       <div class="code-example">
         <div class="code-example-head">
           <div>
             <span>HAL example for</span>
             <b class="code-example-selected">${esc(selected.label||selected.pin)} · ${esc(selected.pin)}</b>
           </div>
           <button type="button" class="small code-copy" data-group="${i}">Copy</button>
         </div>
         <pre class="code-example-pre">${esc(code)}</pre>
       </div>
     </section>
   `;
 }).join("");

 root.querySelectorAll(".code-pin-chip").forEach(btn=>{
   btn.addEventListener("click",()=>{
     const groupIndex=Number(btn.dataset.group);
     const itemIndex=Number(btn.dataset.index);
     const group=groups[groupIndex];
     const pin=group?.items?.[itemIndex];
     if(!group||!pin)return;

     group.selected=pin;

     const section=root.querySelector(`[data-code-group="${groupIndex}"]`);
     section.querySelectorAll(".code-pin-chip").forEach(x=>x.classList.toggle("selected",x===btn));

     const selectedText=section.querySelector(".code-example-selected");
     const pre=section.querySelector(".code-example-pre");

     selectedText.textContent=`${pin.label||pin.pin} · ${pin.pin}`;
     pre.textContent=personalizedSnippet(group.title,pin);

     focusPin(pin.pin);
   });
 });

 root.querySelectorAll(".code-copy").forEach(btn=>{
   btn.addEventListener("click",async()=>{
     const groupIndex=Number(btn.dataset.group);
     const group=groups[groupIndex];
     if(!group)return;

     const code=personalizedSnippet(group.title,group.selected);
     await navigator.clipboard.writeText(code);
     showToast(`${group.selected.label||group.selected.pin} example copied`);
   });
 });
}

const NAMING_GUIDE={
 "16x2 I2C LCD":{
   protocols:["I2C"],defaultPrefix:"LCD",
   names:["LCD","STATUS_LCD","MAIN_LCD"],
   signals:{"I2C":[
     {signal:"VCC",suffix:"VCC",note:"LCD/backpack power"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"SCL",suffix:"SCL",note:"I2C clock"},
     {signal:"SDA",suffix:"SDA",note:"I2C data"}
   ]},
   tips:["Use LCD_SCL and LCD_SDA for clear I2C labels.","Many 16x2 I2C backpacks are powered from 5 V; verify your module.","The LCD uses an I2C backpack, so CubeMX should show an I2C peripheral on SCL/SDA."]
 },
 "HY-SRF05 Ultrasonic Sensor":{
   protocols:["Trigger / Echo GPIO"],defaultPrefix:"ULTRASONIC",
   names:["ULTRASONIC","DISTANCE_SENSOR","FRONT_ULTRASONIC"],
   signals:{"Trigger / Echo GPIO":[
     {signal:"VCC",suffix:"VCC",note:"Module supply"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"TRIG",suffix:"TRIG",note:"GPIO output pulse"},
     {signal:"ECHO",suffix:"ECHO",note:"GPIO input or timer capture"}
   ]},
   tips:["Use *_TRIG for the output pulse and *_ECHO for the return signal.","ECHO may be a 5 V signal depending on the module; protect STM32 inputs appropriately.","A timer input-capture channel can improve pulse-width measurement."]
 },
 "DS18B20 Temperature Sensor":{
   protocols:["1-Wire"],defaultPrefix:"TEMP_1W",
   names:["TEMP_1W","DS18B20","PROBE_TEMP"],
   signals:{"1-Wire":[
     {signal:"VCC",suffix:"VCC",note:"3.3 V supply"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"DQ",suffix:"DQ",note:"1-Wire data"}
   ]},
   tips:["Use a label such as TEMP_1W_DQ.","A 4.7 kΩ pull-up to 3.3 V is commonly used on the DQ line.","The data pin is GPIO, not UART/I2C/SPI."]
 },
 "DHT11 Temp/Humidity Sensor":{
   protocols:["Single-wire Digital"],defaultPrefix:"DHT11",
   names:["DHT11","ROOM_DHT11","TEMP_HUMIDITY"],
   signals:{"Single-wire Digital":[
     {signal:"VCC",suffix:"VCC",note:"Supply"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"DATA",suffix:"DATA",note:"Single-wire digital data"}
   ]},
   tips:["Use DHT11_DATA for the data GPIO.","The DHT11 protocol is timing-based GPIO, not Dallas 1-Wire.","Check whether your module already includes the pull-up resistor."]
 },
 "HC-05 Bluetooth Module":{
   protocols:["UART"],defaultPrefix:"BT",
   names:["BT","BLUETOOTH","HC05"],
   signals:{"UART":[
     {signal:"VCC",suffix:"VCC",note:"Module supply"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"TX",suffix:"TX",note:"HC-05 TX → STM32 RX"},
     {signal:"RX",suffix:"RX",note:"STM32 TX → HC-05 RX"},
     {signal:"STATE",suffix:"STATE",note:"Optional status GPIO"}
   ]},
   tips:["BT_TX is the module's TX signal and should connect to an STM32 RX pin.","BT_RX connects to an STM32 TX pin.","Verify HC-05 RX logic-level requirements."]
 },
 "N20 DC Gear Motor":{
   protocols:["Motor Driver / PWM","Motor Driver / GPIO"],defaultPrefix:"MOTOR",
   names:["MOTOR","DRIVE_MOTOR","N20_MOTOR"],
   signals:{
     "Motor Driver / PWM":[
       {signal:"MOTOR_A",suffix:"IN1",note:"Driver input 1"},
       {signal:"MOTOR_B",suffix:"IN2",note:"Driver input 2"},
       {signal:"PWM_ENABLE",suffix:"PWM",note:"Timer/PWM to driver enable"},
       {signal:"MOTOR_POWER",suffix:"PWR",note:"External motor supply"},
       {signal:"GND",suffix:"GND",note:"Common ground"}
     ],
     "Motor Driver / GPIO":[
       {signal:"MOTOR_A",suffix:"IN1",note:"Driver input 1"},
       {signal:"MOTOR_B",suffix:"IN2",note:"Driver input 2"},
       {signal:"MOTOR_POWER",suffix:"PWR",note:"External motor supply"},
       {signal:"GND",suffix:"GND",note:"Common ground"}
     ]
   },
   tips:["Never drive the N20 motor directly from an STM32 GPIO.","Use an H-bridge/motor driver and external motor supply.","Use a TIM*_CH* pin for PWM speed control."]
 },
 "Ambient Light Sensor":{
   protocols:["Analog"],defaultPrefix:"LIGHT",
   names:["LIGHT_SENSOR","AMBIENT_LIGHT","LDR_SENSOR"],
   signals:{"Analog":[
     {signal:"VCC",suffix:"VCC",note:"Supply"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"ANALOG_OUT",suffix:"ADC",note:"ADC input"}
   ]},
   tips:["LIGHT_ADC is a clear label for the analog signal.","Select an ADC-capable pin in CubeMX."]
 },
 "10K NTC Thermistor Probe":{
   protocols:["Analog Divider"],defaultPrefix:"NTC",
   names:["NTC","TEMP_NTC","THERMISTOR"],
   signals:{"Analog Divider":[
     {signal:"ADC_SENSE",suffix:"ADC",note:"Divider midpoint to ADC"},
     {signal:"FIXED_RESISTOR",suffix:"DIV",note:"External fixed resistor"},
     {signal:"VREF",suffix:"VREF",note:"3.3 V reference"},
     {signal:"GND",suffix:"GND",note:"Ground"}
   ]},
   tips:["An NTC probe needs a voltage divider before the ADC.","Use NTC_ADC for the ADC midpoint.","The fixed resistor value affects the useful measurement range."]
 },
 "0.96in SPI OLED":{
   protocols:["SPI 4-wire"],defaultPrefix:"OLED",
   names:["OLED","SPI_OLED","STATUS_OLED"],
   signals:{"SPI 4-wire":[
     {signal:"VCC",suffix:"VCC",note:"Supply"},
     {signal:"GND",suffix:"GND",note:"Ground"},
     {signal:"SCLK",suffix:"SCLK",note:"SPI clock"},
     {signal:"MOSI",suffix:"MOSI",note:"SPI data"},
     {signal:"CS",suffix:"CS",note:"Chip select"},
     {signal:"DC",suffix:"DC",note:"Data/command"},
     {signal:"RST",suffix:"RST",note:"Reset"}
   ]},
   tips:["Use OLED_CS, OLED_DC and OLED_RST exactly; NucleoPin recognizes these labels.","SCLK and MOSI should use the same SPI peripheral.","The class module is listed as a 7-pin SPI OLED."]
 },
 "MQ2 Gas Sensor":{
   protocols:["Analog","Digital GPIO"],defaultPrefix:"MQ2",
   names:["MQ2","GAS_SENSOR","SMOKE_SENSOR"],
   signals:{
     "Analog":[
       {signal:"VCC",suffix:"VCC",note:"Module supply"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"AO",suffix:"ADC",note:"Analog output to ADC"}
     ],
     "Digital GPIO":[
       {signal:"VCC",suffix:"VCC",note:"Module supply"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"DO",suffix:"DO",note:"Digital threshold output"}
     ]
   },
   tips:["Use MQ2_ADC for analog readings or MQ2_DO for the threshold output.","Verify output voltage before connecting to STM32 ADC/GPIO.","MQ sensors require warm-up time for meaningful readings."]
 },
 "ESP8266 NodeMCU":{
   protocols:["UART"],defaultPrefix:"ESP8266",
   names:["ESP8266","WIFI_MODULE","NODEMCU"],
   signals:{"UART":[
     {signal:"TX",suffix:"TX",note:"ESP8266 TX → STM32 RX"},
     {signal:"RX",suffix:"RX",note:"STM32 TX → ESP8266 RX"},
     {signal:"GND",suffix:"GND",note:"Common ground"},
     {signal:"POWER",suffix:"PWR",note:"Dev-board power input"}
   ]},
   tips:["UART is the simplest STM32-to-NodeMCU link to plan in NucleoPin.","ESP8266_TX connects to MCU RX; ESP8266_RX connects to MCU TX.","Use the NodeMCU board's correct power input rather than assuming a GPIO supply."]
 },
 "ESP32-S3 Mini Dev Board":{
   protocols:["UART"],defaultPrefix:"ESP32",
   names:["ESP32","ESP32_S3","COPROCESSOR"],
   signals:{"UART":[
     {signal:"TX",suffix:"TX",note:"ESP32 TX → STM32 RX"},
     {signal:"RX",suffix:"RX",note:"STM32 TX → ESP32 RX"},
     {signal:"GND",suffix:"GND",note:"Common ground"},
     {signal:"POWER",suffix:"PWR",note:"Dev-board power input"}
   ]},
   tips:["Use UART for a straightforward STM32-to-ESP32 link.","Keep a common ground between both development boards.","Verify the exact ESP32-S3 mini board power input."]
 },
"OLED Display":{
   protocols:["I2C","SPI 3-wire","SPI 4-wire"],
   defaultPrefix:"OLED",
   names:["OLED","OLED_DISPLAY","STATUS_OLED"],
   signals:{
     "I2C":[
       {signal:"VCC",suffix:"VCC",note:"Power rail"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCL",suffix:"SCL",note:"I2C clock"},
       {signal:"SDA",suffix:"SDA",note:"I2C data"}
     ],
     "SPI 3-wire":[
       {signal:"VCC",suffix:"VCC",note:"Power rail"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCLK",suffix:"SCLK",note:"SPI clock"},
       {signal:"DATA",suffix:"DATA",note:"Shared serial data"},
       {signal:"CS",suffix:"CS",note:"Chip select"},
       {signal:"DC",suffix:"DC",note:"Data / command if exposed"},
       {signal:"RST",suffix:"RST",note:"Reset if exposed"}
     ],
     "SPI 4-wire":[
       {signal:"VCC",suffix:"VCC",note:"Power rail"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCLK",suffix:"SCLK",note:"SPI clock"},
       {signal:"MOSI",suffix:"MOSI",note:"SPI data to display"},
       {signal:"CS",suffix:"CS",note:"Chip select"},
       {signal:"DC",suffix:"DC",note:"Data / command"},
       {signal:"RST",suffix:"RST",note:"Reset"}
     ]
   },
   tips:[
     "Use one clear prefix for the whole display, such as OLED.",
     "For SPI control pins, names like OLED_CS, OLED_DC and OLED_RST make NucleoPin recommendations much more accurate.",
     "Keep CubeMX labels short, uppercase and underscore-separated."
   ]
 },
 "LED":{
   protocols:["GPIO"],
   defaultPrefix:"STATUS_RED",
   names:["STATUS_RED","ROAD_A_RED","POWER_LED"],
   signals:{
     "GPIO":[
       {signal:"ANODE / GPIO",suffix:"",note:"GPIO output"},
       {signal:"CATHODE",suffix:"GND",note:"Ground through LED"}
     ]
   },
   tips:[
     "Include the LED colour in the component name so the parts list can group colours automatically.",
     "Examples: ROAD_A_RED, ROAD_A_YELLOW, ROAD_A_GREEN.",
     "Record a current-limiting resistor in the connection note."
   ]
 },
 "Push Button":{
   protocols:["GPIO"],
   defaultPrefix:"USER_BUTTON",
   names:["USER_BUTTON","PEDESTRIAN_BUTTON","EMERGENCY_BUTTON"],
   signals:{
     "GPIO":[
       {signal:"BUTTON_SIGNAL",suffix:"",note:"GPIO input / EXTI"},
       {signal:"OTHER_SIDE",suffix:"GND",note:"Ground or 3V3 reference"}
     ]
   },
   tips:[
     "Use a purpose-based name, not BUTTON1 unless the hardware really has no special role.",
     "Use EXTI when the button should trigger an interrupt.",
     "Keep the pull-up/pull-down choice documented."
   ]
 },
 "Sensor":{
   protocols:["Analog","Digital GPIO","I2C","SPI","UART"],
   defaultPrefix:"SENSOR",
   names:["TEMP_SENSOR","LIGHT_SENSOR","DISTANCE_SENSOR"],
   signals:{
     "Analog":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"ANALOG_OUT",suffix:"OUT",note:"ADC input"}
     ],
     "Digital GPIO":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SIGNAL",suffix:"SIG",note:"GPIO input/output"}
     ],
     "I2C":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCL",suffix:"SCL",note:"I2C clock"},
       {signal:"SDA",suffix:"SDA",note:"I2C data"}
     ],
     "SPI":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCLK",suffix:"SCLK",note:"SPI clock"},
       {signal:"MOSI",suffix:"MOSI",note:"Controller to sensor"},
       {signal:"MISO",suffix:"MISO",note:"Sensor to controller"},
       {signal:"CS",suffix:"CS",note:"Chip select"}
     ],
     "UART":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"TX",suffix:"TX",note:"Module TX → MCU RX"},
       {signal:"RX",suffix:"RX",note:"Module RX → MCU TX"}
     ]
   },
   tips:[
     "Name the sensor by what it measures: TEMP_SENSOR, LIGHT_SENSOR, etc.",
     "For bus devices, keep the interface suffix in the CubeMX label.",
     "For multiple identical sensors, add a location or number."
   ]
 },
 "Buzzer":{
   protocols:["GPIO / PWM"],
   defaultPrefix:"BUZZER",
   names:["BUZZER","ALARM_BUZZER","STATUS_BUZZER"],
   signals:{
     "GPIO / PWM":[
       {signal:"CONTROL",suffix:"CTRL",note:"GPIO or timer/PWM output"},
       {signal:"GND",suffix:"GND",note:"Ground"}
     ]
   },
   tips:[
     "Use PWM if you need tone/frequency control.",
     "Use a transistor driver if the buzzer current exceeds GPIO capability."
   ]
 },
 "Motor / Servo":{
   protocols:["PWM","GPIO"],
   defaultPrefix:"SERVO",
   names:["SERVO","GATE_SERVO","MOTOR_ENABLE"],
   signals:{
     "PWM":[
       {signal:"PWM_CONTROL",suffix:"PWM",note:"Timer channel"},
       {signal:"GND",suffix:"GND",note:"Common ground"},
       {signal:"POWER",suffix:"PWR",note:"External supply"}
     ],
     "GPIO":[
       {signal:"CONTROL",suffix:"CTRL",note:"GPIO control"},
       {signal:"GND",suffix:"GND",note:"Common ground"},
       {signal:"POWER",suffix:"PWR",note:"External supply"}
     ]
   },
   tips:[
     "Do not power motors directly from an STM32 GPIO.",
     "Use a meaningful motion name such as GATE_SERVO or FAN_MOTOR.",
     "PWM control pins should be configured on a TIM*_CH* function."
   ]
 },
 "Communication Module":{
   protocols:["UART","I2C","SPI"],
   defaultPrefix:"MODULE",
   names:["GPS_MODULE","BT_MODULE","RADIO_MODULE"],
   signals:{
     "UART":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"TX",suffix:"TX",note:"Module TX → MCU RX"},
       {signal:"RX",suffix:"RX",note:"Module RX → MCU TX"}
     ],
     "I2C":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCL",suffix:"SCL",note:"I2C clock"},
       {signal:"SDA",suffix:"SDA",note:"I2C data"}
     ],
     "SPI":[
       {signal:"VCC",suffix:"VCC",note:"Power"},
       {signal:"GND",suffix:"GND",note:"Ground"},
       {signal:"SCLK",suffix:"SCLK",note:"SPI clock"},
       {signal:"MOSI",suffix:"MOSI",note:"Controller out"},
       {signal:"MISO",suffix:"MISO",note:"Controller in"},
       {signal:"CS",suffix:"CS",note:"Chip select"}
     ]
   },
   tips:[
     "Name the module by function, e.g. GPS_MODULE instead of MODULE1.",
     "UART TX/RX are crossed: module TX goes to MCU RX and module RX goes to MCU TX."
   ]
 }
};

function namingGuideRecommendations(signal,protocol){
 const configured=configuredPinsFromVisualizer();
 const matcher=expectedPinMatch(signal,protocol);

 const exact=configured.filter(matcher);

 const ranked=[...configured]
   .sort((a,b)=>recommendationRank(a,signal,protocol)-recommendationRank(b,signal,protocol))
   .filter((item,index,arr)=>arr.findIndex(x=>x.pin===item.pin)===index);

 const combined=[
   ...exact,
   ...ranked.filter(x=>!exact.some(e=>e.pin===x.pin))
 ].slice(0,4);

 if(signal==="VCC")return [{pin:"3V3",label:"3.3 V",signal:"Power"}];
 if(signal==="GND"||signal==="CATHODE"||signal==="OTHER_SIDE")return [{pin:"GND",label:"Ground",signal:"Power"}];
 if(signal==="POWER")return [{pin:"External",label:"External supply",signal:"Power"}];

 return combined;
}

function renderNamingGuide(){
 const componentSelect=$("namingComponent");
 const protocolSelect=$("namingProtocol");
 const prefixInput=$("namingPrefix");
 if(!componentSelect||!protocolSelect||!prefixInput)return;

 const guide=NAMING_GUIDE[componentSelect.value]||NAMING_GUIDE["OLED Display"];

 const oldProtocol=protocolSelect.value;
 protocolSelect.innerHTML=guide.protocols.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("");
 protocolSelect.value=guide.protocols.includes(oldProtocol)?oldProtocol:guide.protocols[0];

 if(!prefixInput.dataset.userEdited){
   prefixInput.value=guide.defaultPrefix;
 }

 const protocol=protocolSelect.value;
 const prefix=String(prefixInput.value||guide.defaultPrefix)
   .trim()
   .toUpperCase()
   .replace(/[^A-Z0-9_]/g,"_")||guide.defaultPrefix;

 const names=$("namingComponentExamples");
 names.innerHTML=guide.names.map(n=>`
   <button type="button" class="naming-name-example" data-name="${esc(n)}">
     <b>${esc(n)}</b>
     <span>Use as component name</span>
   </button>
 `).join("");

 names.querySelectorAll(".naming-name-example").forEach(btn=>{
   btn.addEventListener("click",()=>{
     prefixInput.value=btn.dataset.name;
     prefixInput.dataset.userEdited="1";
     renderNamingGuide();
   });
 });

 const signals=guide.signals[protocol]||[];
 const table=$("namingSignalTable");

 table.innerHTML=`
   <div class="naming-signal-head">
     <span>Signal</span>
     <span>Suggested CubeMX label</span>
     <span>Recommended IOC pins</span>
   </div>
   ${signals.map(item=>{
     const label=item.suffix
       ? (item.suffix==="GND"||item.suffix==="VCC"||item.suffix==="PWR" ? `${prefix}_${item.suffix}` : `${prefix}_${item.suffix}`)
       : prefix;

     const recs=namingGuideRecommendations(item.signal,protocol);

     return `
       <div class="naming-signal-row">
         <div>
           <b>${esc(item.signal)}</b>
           <small>${esc(item.note||"")}</small>
         </div>
         <code>${esc(label)}</code>
         <div class="naming-recommendations">
           ${recs.length?recs.map(r=>`
             <button type="button" class="naming-pin" data-pin="${esc(r.pin)}" ${r.pin==="External"?"disabled":""}>
               <b>${esc(r.pin)}</b>
               <span>${esc(r.label||r.signal||"")}</span>
             </button>
           `).join(""):'<span class="naming-no-match">No matching configured IOC pin</span>'}
         </div>
       </div>
     `;
   }).join("")}
 `;

 table.querySelectorAll(".naming-pin:not(:disabled)").forEach(btn=>{
   btn.addEventListener("click",()=>focusPin(btn.dataset.pin));
 });

 const tips=$("namingTips");
 tips.innerHTML=guide.tips.map(t=>`<div class="naming-tip"><span>✓</span><p>${esc(t)}</p></div>`).join("");
}

function initNamingGuide(){
 const component=$("namingComponent"),protocol=$("namingProtocol"),prefix=$("namingPrefix");
 if(!component||!protocol||!prefix)return;

 component.addEventListener("change",()=>{
   const guide=NAMING_GUIDE[component.value];
   prefix.dataset.userEdited="";
   prefix.value=guide?.defaultPrefix||"COMPONENT";
   renderNamingGuide();
 });

 protocol.addEventListener("change",renderNamingGuide);

 prefix.addEventListener("input",()=>{
   prefix.dataset.userEdited="1";
   renderNamingGuide();
 });

 renderNamingGuide();
}


function setScreen(name){
 document.querySelectorAll(".screen-nav").forEach(b=>b.classList.toggle("active",b.dataset.screen===name));
 document.querySelectorAll(".v11-screen").forEach(p=>p.classList.toggle("active",p.dataset.screenPage===name));
 const titles={dashboard:"Dashboard",planner:"Pin Planner",check:"Smart Check",matrix:"Pin Matrix",code:"Code Snippets",naming:"Naming Guide",project:"Project",settings:"Settings"};
 if($("screenTitle"))$("screenTitle").textContent=titles[name]||"NucleoPin";
 if(name==="check"&&currentIoc())executeSmartCheck();
 if(name==="matrix")renderPinMatrix();
 if(name==="code")renderCodeSnippets();
 if(name==="naming")renderNamingGuide();
}
function render(){renderProjects();renderIocs();renderLabels();renderComponents();renderWiring();renderPeripherals();renderChangeHistory();renderDetails();renderDashboard();renderPinMatrix();renderCodeSnippets();publishWiringToVisualizer()}

function clearVisual(){
 watchStatus.textContent="No IOC selected";
 setStatus("Ready");
 updateTopActionState();
}
function waitFrame(){return new Promise(r=>{if(frame.contentWindow?.loadIOCText)return r();frame.addEventListener("load",()=>r(),{once:true})})}

let missingIocContext=null;

async function locateIocForFile(projectId,fileIndex){
 const p=state.projects.find(x=>x.id===projectId);
 if(!p||!p.iocFiles[fileIndex])return;

 const picked=await open({
   multiple:false,
   filters:[{name:"STM32CubeMX IOC",extensions:["ioc"]}]
 });
 if(!picked)return;

 p.iocFiles[fileIndex].path=picked;
 p.iocFiles[fileIndex].lastModifiedMs=0;
 p.iocFiles[fileIndex].lastSize=0;
 activeProjectId=p.id;
 p.activeIocIndex=fileIndex;

 await save();
 render();
 await loadIoc({reason:"manual"});
}

function showMissingIoc(p,f){
 missingIocContext={projectId:p.id,fileIndex:p.iocFiles.indexOf(f)};
 $("missingIocText").textContent=
   `${fileName(f.path)} could not be found at its saved location. Locate the IOC to reconnect it to this project.`;
 $("missingIocModal").hidden=false;
}

async function loadIoc(options={}){
 const p=project(),f=currentIoc(p);
 if(!p||!f){updateTopActionState();return}
 const reason=options.reason||"manual";
 setStatus(`Loading ${fileName(f.path)}...`);
 updateTopActionState();
 try{
   const text=await invoke("read_text_file",{path:f.path});
   const meta=await invoke("file_metadata",{path:f.path});
   f.lastModifiedMs=meta.modifiedMs;
   f.lastSize=meta.size;
   p.lastOpened=Date.now();
   await save();
   await waitFrame();
   frame.contentWindow.loadIOCText(text,fileName(f.path));
   publishWiringToVisualizer();
   refreshOpenComponentPinDropdowns();
   activeFileMeta.textContent=fileName(f.path);
   activeFileMeta.title=f.path;
   watchStatus.textContent=`Watching ${fileName(f.path)}`;
   setStatus("IOC loaded");
   updateTopActionState();

   // Wait for the iframe to finish applying the IOC before dependent analyses.
   setTimeout(()=>{
     recordIocChanges();
     renderPeripherals();
     executeSmartCheck();
   },80);

   if(reason==="watch")showToast(`IOC changed · ${fileName(f.path)} reloaded`);
   else if(reason==="manual")showToast(`Reloaded ${fileName(f.path)}`);
 }catch(e){
   console.error(e);
   watchStatus.textContent="IOC file unavailable · locate or reconnect";
   setStatus(`Could not load IOC: ${e}`);
   showToast("Could not reload active IOC");
   showMissingIoc(p,f);
   updateTopActionState();
 }
}

function refreshOpenComponentPinDropdowns(){
 document.querySelectorAll("#connectionRows .c-pin").forEach(input=>{
   input.dispatchEvent(new Event("change",{bubbles:true}));
 });
}

function focusPin(pin){
 const doc=frame.contentDocument;if(!doc)return;const el=doc.querySelector(`[data-pin="${pin}"]`);if(el){el.click();el.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})}
}
async function choose(){const s=await open({multiple:true,directory:false,filters:[{name:"STM32CubeMX IOC",extensions:["ioc"]}]});return !s?[]:Array.isArray(s)?s:[s]}
async function addIoc(){let p=project();if(!p){await newProject(false);p=project();if(!p)return}const paths=await choose();if(!paths.length)return;for(const path of paths)if(!p.iocFiles.some(f=>f.path===path))p.iocFiles.push({path,label:stripIoc(fileName(path)),lastModifiedMs:null,lastSize:null});p.activeIocIndex=Math.max(0,p.iocFiles.length-paths.length);await save();render();await loadIoc({reason:"silent"})}
async function newProject(askFiles=true){const name=prompt("New project name:");if(!name?.trim())return;const p={id:uid(),name:name.trim(),notes:"",iocFiles:[],activeIocIndex:0,created:Date.now(),lastOpened:null,pinLabels:{},components:[]};state.projects.unshift(p);activeProjectId=p.id;state.settings.lastProjectId=p.id;await save();render();if(askFiles&&confirm("Add IOC files now?"))await addIoc()}
async function renameProject(){const p=project();if(!p)return;const name=prompt("Project name:",p.name);if(!name?.trim())return;p.name=name.trim();await save();render()}
async function removeProject(){const p=project();if(!p)return;if(!confirm(`Remove "${p.name}" from NucleoPin?\n\nThis does NOT delete any IOC files.`))return;state.projects=state.projects.filter(x=>x.id!==p.id);activeProjectId=state.projects[0]?.id||null;state.settings.lastProjectId=activeProjectId;await save();render();currentIoc()?await loadIoc({reason:"silent"}):clearVisual()}
async function poll(){if(!autoReload.checked)return;const f=currentIoc();if(!f)return;try{const m=await invoke("file_metadata",{path:f.path});if(f.lastModifiedMs&&m.modifiedMs!==f.lastModifiedMs){setStatus("IOC changed — reloading...");await loadIoc({reason:"watch"})}}catch{}}

function configuredPinsFromVisualizer(){
 try{
   const fn=frame.contentWindow?.getConfiguredPins;
   return typeof fn==="function" ? fn() : [];
 }catch(e){
   console.warn("Could not read configured pins from visualizer",e);
   return [];
 }
}


function getPinInfo(pin){
 const p=String(pin||"").trim().toUpperCase();
 if(p==="GND")return {pin:"GND",label:"Ground",signal:"Power"};
 if(p==="3V3")return {pin:"3V3",label:"3.3 V",signal:"Power"};
 if(p==="5V")return {pin:"5V",label:"5 V",signal:"Power"};
 try{
   const getter=frame.contentWindow?.getPinConfig;
   return typeof getter==="function" ? getter(p) : null;
 }catch{
   return null;
 }
}

function expectedPinMatch(signalName="",protocol=""){
 const sig=String(signalName||"").trim().toUpperCase();
 const proto=String(protocol||"").trim().toUpperCase();

 if(sig==="GND"||sig.includes("GROUND"))return item=>item.pin==="GND";
 if(/VCC|VDD|POWER/.test(sig))return item=>["3V3","5V"].includes(item.pin);

 if(proto==="I2C"){
   if(sig.includes("SCL"))return item=>/I2C\d*_SCL/i.test(item.signal||"");
   if(sig.includes("SDA"))return item=>/I2C\d*_SDA/i.test(item.signal||"");
   return item=>/I2C/i.test(item.signal||"");
 }

 if(proto==="SPI"||proto==="SPI 4-WIRE"){
   if(/SCLK|SCK|CLK/.test(sig))return item=>/SPI\d*_(SCK|CLK)/i.test(item.signal||"");
   if(sig.includes("MOSI"))return item=>/SPI\d*_MOSI/i.test(item.signal||"");
   if(sig.includes("MISO"))return item=>/SPI\d*_MISO/i.test(item.signal||"");
   if(sig.includes("CS")||sig.includes("NSS"))return item=>{
     const label=String(item.label||"").toUpperCase();
     return label.includes("CS")||label.includes("NSS");
   };
   if(sig.includes("DC"))return item=>{
     const label=String(item.label||"").toUpperCase();
     return label.includes("DC");
   };
   if(sig.includes("RST")||sig.includes("RESET"))return item=>{
     const label=String(item.label||"").toUpperCase();
     return label.includes("RST")||label.includes("RESET");
   };
   return item=>/SPI/i.test(item.signal||"");
 }

 if(proto==="SPI 3-WIRE"){
   if(/SCLK|SCK|CLK/.test(sig))return item=>/SPI\d*_(SCK|CLK)/i.test(item.signal||"");
   if(sig.includes("DATA"))return item=>/SPI\d*_(MOSI|MISO)/i.test(item.signal||"")||/GPIO_Output/i.test(item.signal||"");
   if(sig.includes("CS"))return item=>{
     const label=String(item.label||"").toUpperCase();
     return label.includes("CS");
   };
   if(sig.includes("DC"))return item=>{
     const label=String(item.label||"").toUpperCase();
     return label.includes("DC");
   };
   if(sig.includes("RST")||sig.includes("RESET"))return item=>{
     const label=String(item.label||"").toUpperCase();
     return label.includes("RST")||label.includes("RESET");
   };
   return item=>/SPI/i.test(item.signal||"");
 }

 if(proto==="UART"){
   if(sig.includes("TX"))return item=>/(USART|UART)\d*_RX/i.test(item.signal||"")||/(USART|UART)\d*_TX/i.test(item.signal||"");
   if(sig.includes("RX"))return item=>/(USART|UART)\d*_TX/i.test(item.signal||"")||/(USART|UART)\d*_RX/i.test(item.signal||"");
   return item=>/(USART|UART)/i.test(item.signal||"");
 }

 if(proto==="ANALOG"){
   return item=>/ADC/i.test(item.signal||"");
 }

 if(proto==="PWM"){
   return item=>/TIM\d*_CH/i.test(item.signal||"");
 }


 if(proto==="TRIGGER / ECHO GPIO"){
   if(sig.includes("TRIG"))return item=>/GPIO_OUTPUT/i.test(item.signal||"");
   if(sig.includes("ECHO"))return item=>/GPIO_INPUT|EXTI|TIM\d*_CH/i.test(item.signal||"");
   return item=>/GPIO/i.test(item.signal||"");
 }

 if(proto==="1-WIRE"||proto==="SINGLE-WIRE DIGITAL"){
   return item=>/GPIO_INPUT|GPIO_OUTPUT|GPIO/i.test(item.signal||"");
 }

 if(proto==="MOTOR DRIVER / PWM"){
   if(sig.includes("PWM"))return item=>/TIM\d*_CH/i.test(item.signal||"");
   return item=>/GPIO_OUTPUT/i.test(item.signal||"");
 }

 if(proto==="MOTOR DRIVER / GPIO"){
   return item=>/GPIO_OUTPUT/i.test(item.signal||"");
 }

 if(proto==="ANALOG DIVIDER"){
   if(sig.includes("ADC"))return item=>/ADC/i.test(item.signal||"");
   return ()=>false;
 }

 if(proto==="REFERENCE ONLY"){
   return ()=>false;
 }

 if(proto==="GPIO"||proto==="DIGITAL GPIO"||proto==="GPIO / PWM"){
   if(proto==="GPIO / PWM")return item=>/GPIO_(Input|Output)|EXTI|TIM\d*_CH/i.test(item.signal||"");
   return item=>/GPIO_(Input|Output)|EXTI/i.test(item.signal||"");
 }

 return ()=>false;
}

function recommendationRank(item,signalName="",protocol=""){
 const matcher=expectedPinMatch(signalName,protocol);
 if(matcher(item))return 0;

 const sig=String(item.signal||"").toUpperCase();
 const proto=String(protocol||"").toUpperCase();

 if(proto==="I2C"&&sig.includes("I2C"))return 1;
 if(proto.startsWith("SPI")&&sig.includes("SPI"))return 1;
 if(proto==="UART"&&/(USART|UART)/.test(sig))return 1;
 if(proto==="ANALOG"&&sig.includes("ADC"))return 1;
 if(proto==="PWM"&&sig.includes("TIM"))return 1;
 if(proto==="TRIGGER / ECHO GPIO"&&/GPIO|EXTI|TIM/.test(sig))return 1;
 if((proto==="1-WIRE"||proto==="SINGLE-WIRE DIGITAL")&&/GPIO/.test(sig))return 1;
 if(proto==="MOTOR DRIVER / PWM"&&/TIM|GPIO/.test(sig))return 1;
 if(proto==="MOTOR DRIVER / GPIO"&&/GPIO/.test(sig))return 1;
 if(proto==="ANALOG DIVIDER"&&sig.includes("ADC"))return 1;

 if((proto==="GPIO"||proto==="DIGITAL GPIO"||proto==="GPIO / PWM")&&/GPIO|EXTI|TIM/.test(sig))return 1;

 return 5;
}

function makePinPicker(selected="",getSignalName=()=>"",getProtocol=()=>""){
 const wrap=document.createElement("div");
 wrap.className="pin-picker";

 const input=document.createElement("input");
 input.type="text";
 input.className="c-pin";
 input.autocomplete="off";
 input.placeholder="Search pin / label / function";
 input.value=String(selected||"").toUpperCase();

 const menu=document.createElement("div");
 menu.className="pin-picker-menu";

 function allItems(){
   return [
     ...configuredPinsFromVisualizer(),
     {pin:"GND",label:"Ground",signal:"Power"},
     {pin:"3V3",label:"3.3 V",signal:"Power"},
     {pin:"5V",label:"5 V",signal:"Power"}
   ];
 }

 function renderMenu(){
   const q=input.value.trim().toLowerCase();
   const signalName=getSignalName();
   const protocol=getProtocol();

   const items=allItems()
     .filter(item=>{
       const hay=`${item.pin} ${item.label||""} ${item.signal||""}`.toLowerCase();
       return !q||hay.includes(q);
     })
     .sort((a,b)=>{
       const ra=recommendationRank(a,signalName,protocol);
       const rb=recommendationRank(b,signalName,protocol);
       return ra-rb||String(a.pin).localeCompare(String(b.pin));
     })
     .slice(0,40);

   menu.innerHTML="";

   if(!items.length){
     const empty=document.createElement("div");
     empty.className="pin-picker-empty";
     empty.textContent="No configured IOC pin matches";
     menu.appendChild(empty);
   }else{
     items.forEach(item=>{
       const recommended=recommendationRank(item,signalName,protocol)===0;

       const b=document.createElement("button");
       b.type="button";
       b.className="pin-picker-item"+(recommended?" recommended":"");
       b.dataset.pin=item.pin;
       b.innerHTML=`<b>${esc(item.pin)}</b><span>${esc(item.label||"(no label)")}${recommended?' <em>Recommended</em>':""}</span><small>${esc(item.signal||"")}</small>`;

       b.addEventListener("mousedown",e=>{
         e.preventDefault();
         input.value=item.pin;
         menu.classList.remove("show");
         input.dispatchEvent(new Event("change",{bubbles:true}));
       });

       menu.appendChild(b);
     });
   }

   menu.classList.add("show");
 }

 input.addEventListener("focus",renderMenu);
 input.addEventListener("input",renderMenu);
 input.addEventListener("keydown",e=>{
   if(e.key==="Escape")menu.classList.remove("show");

   if(e.key==="Enter"){
     const first=menu.querySelector(".pin-picker-item");
     if(first){
       e.preventDefault();
       input.value=first.dataset.pin;
       menu.classList.remove("show");
       input.dispatchEvent(new Event("change",{bubbles:true}));
     }
   }
 });

 input.addEventListener("blur",()=>setTimeout(()=>menu.classList.remove("show"),120));

 wrap.refreshRecommendations=()=>{
   if(document.activeElement===input)renderMenu();
 };

 wrap.append(input,menu);
 return wrap;
}


function addConnectionRow(data={signal:"",pin:"",note:"",kind:"signal"}){
 const wrap=document.createElement("div");
 wrap.className="connection-row-wrap";
 wrap.dataset.kind=data.kind||"signal";

 const row=document.createElement("div");
 row.className="connection-row";

 const signalInput=document.createElement("input");
 signalInput.className="c-signal";
 signalInput.placeholder="Component signal";
 signalInput.value=data.signal||"";

 const picker=makePinPicker(
   data.pin||"",
   ()=>signalInput.value,
   ()=>$("componentProtocol")?.value||""
 );
 const pinInput=picker.querySelector(".c-pin");

 const noteInput=document.createElement("input");
 noteInput.className="c-note";
 noteInput.placeholder="Optional note";
 noteInput.value=data.note||"";

 const remove=document.createElement("button");
 remove.type="button";
 remove.className="remove-connection";
 remove.textContent="×";

 row.append(signalInput,picker,noteInput,remove);

 const info=document.createElement("div");
 info.className="ioc-pin-info";
 info.innerHTML=`<span>Current IOC label: <b class="current-label">—</b></span><span>Function: <b class="current-function">—</b></span>`;

 wrap.append(row,info);

 function updateInfo(){
   const pin=pinInput.value.trim().toUpperCase();
   pinInput.value=pin;
   const cfg=getPinInfo(pin);
   info.querySelector(".current-label").textContent=cfg?.label||"(no label)";
   info.querySelector(".current-function").textContent=cfg?.signal||"(not configured)";
 }

 pinInput.addEventListener("change",updateInfo);
 signalInput.addEventListener("input",()=>picker.refreshRecommendations?.());
 remove.onclick=()=>wrap.remove();
 $("connectionRows").appendChild(wrap);
 updateInfo();
}


const COMPONENT_PROTOCOLS={
 "Generic":["Custom"],
 "OLED Display":["I2C","SPI 3-wire","SPI 4-wire"],
 "16x2 I2C LCD":["I2C"],
 "HY-SRF05 Ultrasonic Sensor":["Trigger / Echo GPIO"],
 "DS18B20 Temperature Sensor":["1-Wire"],
 "DHT11 Temp/Humidity Sensor":["Single-wire Digital"],
 "HC-05 Bluetooth Module":["UART"],
 "N20 DC Gear Motor":["Motor Driver / PWM","Motor Driver / GPIO"],
 "Ambient Light Sensor":["Analog"],
 "10K NTC Thermistor Probe":["Analog Divider"],
 "0.96in SPI OLED":["SPI 4-wire"],
 "MQ2 Gas Sensor":["Analog","Digital GPIO"],
 "ESP8266 NodeMCU":["UART"],
 "ESP32-S3 Mini Dev Board":["UART"],
 "USB A-to-A Cable":["Reference Only"],
 "LED":["GPIO"],
 "Push Button":["GPIO"],
 "Sensor":["Analog","Digital GPIO","I2C","SPI","UART"],
 "Buzzer":["GPIO / PWM"],
 "Motor / Servo":["PWM","GPIO"],
 "Communication Module":["UART","I2C","SPI"]
};

function protocolOptionsForType(type){return COMPONENT_PROTOCOLS[type]||["Custom"]}

function refreshProtocolOptions(selected=""){
 const type=$("componentType").value,select=$("componentProtocol"),options=protocolOptionsForType(type);
 select.innerHTML=options.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
 select.value=options.includes(selected)?selected:options[0];
 const help={
   "I2C":"Two-wire bus: SCL + SDA, plus power and ground.",
   "SPI 3-wire":"Clock + shared serial data line. Exact module pins vary, so verify the display datasheet.",
   "SPI 4-wire":"Clock + MOSI, normally with CS, D/C and RESET.",
   "Analog":"One ADC signal plus power and ground where required.",
   "Digital GPIO":"One GPIO signal plus power and ground where required.",
   "SPI":"SCLK/MOSI/MISO/CS as required by the module.",
   "UART":"TX/RX plus power and ground where required.",
   "PWM":"Timer/PWM control signal; motors and servos normally use external power.",
   "GPIO":"General-purpose digital interface.",
   "GPIO / PWM":"GPIO or timer-driven output.",
   "Custom":"Manually define the connections."
 };
 if($("protocolHint"))$("protocolHint").textContent=help[select.value]||"Select the interface used by this component.";
}

function applyComponentTemplate(type,force=false){
 const root=$("connectionRows");
 const protocol=$("componentProtocol")?.value||protocolOptionsForType(type)[0]||"Custom";
 if(!force&&root.children.length){
   if(!confirm(`Replace the current connections with the ${type} / ${protocol} template?`))return;
 }
 root.innerHTML="";
 const power=(v="3V3")=>{
   addConnectionRow({signal:"VCC",pin:v,note:"Confirm module supply voltage",kind:"power"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
 };

 // --- EEDE226 class components ---
 if(type==="16x2 I2C LCD"){
   power("5V");
   addConnectionRow({signal:"SCL",pin:"",note:"I2C clock",kind:"signal"});
   addConnectionRow({signal:"SDA",pin:"",note:"I2C data",kind:"signal"});
 }
 else if(type==="HY-SRF05 Ultrasonic Sensor"){
   power("5V");
   addConnectionRow({signal:"TRIG",pin:"",note:"GPIO output pulse",kind:"signal"});
   addConnectionRow({signal:"ECHO",pin:"",note:"GPIO input / timer capture; protect 5 V logic if required",kind:"signal"});
 }
 else if(type==="DS18B20 Temperature Sensor"){
   power("3V3");
   addConnectionRow({signal:"DQ",pin:"",note:"1-Wire data; typically requires 4.7 kΩ pull-up to 3V3",kind:"signal"});
 }
 else if(type==="DHT11 Temp/Humidity Sensor"){
   power("3V3");
   addConnectionRow({signal:"DATA",pin:"",note:"Single-wire digital data; module/bare sensor pull-up may differ",kind:"signal"});
 }
 else if(type==="HC-05 Bluetooth Module"){
   power("5V");
   addConnectionRow({signal:"TX",pin:"",note:"HC-05 TX → STM32 UART RX",kind:"signal"});
   addConnectionRow({signal:"RX",pin:"",note:"STM32 UART TX → HC-05 RX; verify logic-level requirements",kind:"signal"});
   addConnectionRow({signal:"STATE",pin:"",note:"Optional status input",kind:"signal"});
 }
 else if(type==="N20 DC Gear Motor"){
   addConnectionRow({signal:"MOTOR_A",pin:"",note:"Connect through H-bridge / motor driver, not directly to STM32",kind:"signal"});
   addConnectionRow({signal:"MOTOR_B",pin:"",note:"Connect through H-bridge / motor driver, not directly to STM32",kind:"signal"});
   addConnectionRow({signal:"PWM_ENABLE",pin:"",note:"Optional timer/PWM to motor driver enable",kind:"signal"});
   addConnectionRow({signal:"MOTOR_POWER",pin:"",note:"External motor supply",kind:"power"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Common ground with motor driver",kind:"ground"});
 }
 else if(type==="Ambient Light Sensor"){
   power("3V3");
   addConnectionRow({signal:"ANALOG_OUT",pin:"",note:"ADC input",kind:"signal"});
 }
 else if(type==="10K NTC Thermistor Probe"){
   addConnectionRow({signal:"ADC_SENSE",pin:"",note:"ADC input from voltage-divider midpoint",kind:"signal"});
   addConnectionRow({signal:"FIXED_RESISTOR",pin:"",note:"Use a suitable fixed resistor to form a divider",kind:"signal"});
   addConnectionRow({signal:"VREF",pin:"3V3",note:"Divider supply/reference",kind:"power"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
 }
 else if(type==="0.96in SPI OLED"){
   power("3V3");
   addConnectionRow({signal:"SCLK",pin:"",note:"SPI clock",kind:"signal"});
   addConnectionRow({signal:"MOSI",pin:"",note:"SPI data to OLED",kind:"signal"});
   addConnectionRow({signal:"CS",pin:"",note:"Name pin OLED_CS in CubeMX",kind:"signal"});
   addConnectionRow({signal:"DC",pin:"",note:"Name pin OLED_DC in CubeMX",kind:"signal"});
   addConnectionRow({signal:"RST",pin:"",note:"Name pin OLED_RST in CubeMX",kind:"signal"});
 }
 else if(type==="MQ2 Gas Sensor"){
   power("5V");
   addConnectionRow({signal:protocol==="Digital GPIO"?"DO":"AO",pin:"",note:protocol==="Digital GPIO"?"Digital threshold output":"Analog gas-sensor output to ADC",kind:"signal"});
 }
 else if(type==="ESP8266 NodeMCU"){
   addConnectionRow({signal:"TX",pin:"",note:"ESP8266 TX → STM32 UART RX",kind:"signal"});
   addConnectionRow({signal:"RX",pin:"",note:"STM32 UART TX → ESP8266 RX",kind:"signal"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Common ground",kind:"ground"});
   addConnectionRow({signal:"POWER",pin:"",note:"Power NodeMCU through appropriate board power input; verify board requirements",kind:"power"});
 }
 else if(type==="ESP32-S3 Mini Dev Board"){
   addConnectionRow({signal:"TX",pin:"",note:"ESP32-S3 TX → STM32 UART RX",kind:"signal"});
   addConnectionRow({signal:"RX",pin:"",note:"STM32 UART TX → ESP32-S3 RX",kind:"signal"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Common ground",kind:"ground"});
   addConnectionRow({signal:"POWER",pin:"",note:"Use appropriate dev-board power input",kind:"power"});
 }
 else if(type==="USB A-to-A Cable"){
   addConnectionRow({signal:"REFERENCE",pin:"",note:"Class hardware item; no STM32 GPIO assignment required",kind:"signal"});
 }

 // --- Existing generic components ---
 else if(type==="OLED Display"){
   power();
   if(protocol==="I2C"){
     addConnectionRow({signal:"SCL",pin:"",note:"Choose configured I2C SCL pin",kind:"signal"});
     addConnectionRow({signal:"SDA",pin:"",note:"Choose configured I2C SDA pin",kind:"signal"});
   }else if(protocol==="SPI 3-wire"){
     addConnectionRow({signal:"SCLK",pin:"",note:"SPI clock",kind:"signal"});
     addConnectionRow({signal:"DATA",pin:"",note:"Shared serial data line; verify module datasheet",kind:"signal"});
     addConnectionRow({signal:"CS",pin:"",note:"Chip select",kind:"signal"});
     addConnectionRow({signal:"DC",pin:"",note:"Data / command if exposed",kind:"signal"});
     addConnectionRow({signal:"RST",pin:"",note:"Display reset if exposed",kind:"signal"});
   }else{
     addConnectionRow({signal:"SCLK",pin:"",note:"SPI clock",kind:"signal"});
     addConnectionRow({signal:"MOSI",pin:"",note:"SPI data to display",kind:"signal"});
     addConnectionRow({signal:"CS",pin:"",note:"Chip select",kind:"signal"});
     addConnectionRow({signal:"DC",pin:"",note:"Data / command",kind:"signal"});
     addConnectionRow({signal:"RST",pin:"",note:"Display reset",kind:"signal"});
   }
 }
 else if(type==="LED"){
   addConnectionRow({signal:"ANODE / GPIO",pin:"",note:"Use class/lab-specified series resistor value",kind:"signal"});
   addConnectionRow({signal:"CATHODE",pin:"GND",note:"LED cathode to GND",kind:"ground"});
 }
 else if(type==="Push Button"){
   addConnectionRow({signal:"BUTTON_SIGNAL",pin:"",note:"GPIO input; internal pull-up recommended",kind:"signal"});
   addConnectionRow({signal:"OTHER_SIDE",pin:"GND",note:"Button connects input to GND when pressed",kind:"ground"});
 }
 else if(type==="Sensor"){
   power();
   if(protocol==="Analog")addConnectionRow({signal:"ANALOG_OUT",pin:"",note:"Choose configured ADC pin",kind:"signal"});
   else if(protocol==="Digital GPIO")addConnectionRow({signal:"SIGNAL",pin:"",note:"Choose configured GPIO pin",kind:"signal"});
   else if(protocol==="I2C"){addConnectionRow({signal:"SCL",pin:"",note:"I2C clock",kind:"signal"});addConnectionRow({signal:"SDA",pin:"",note:"I2C data",kind:"signal"});}
   else if(protocol==="SPI"){addConnectionRow({signal:"SCLK",pin:"",note:"SPI clock",kind:"signal"});addConnectionRow({signal:"MOSI",pin:"",note:"SPI controller out",kind:"signal"});addConnectionRow({signal:"MISO",pin:"",note:"SPI controller in",kind:"signal"});addConnectionRow({signal:"CS",pin:"",note:"Chip select",kind:"signal"});}
   else {addConnectionRow({signal:"TX",pin:"",note:"Module TX → MCU RX",kind:"signal"});addConnectionRow({signal:"RX",pin:"",note:"Module RX → MCU TX",kind:"signal"});}
 }
 else if(type==="Buzzer"){
   addConnectionRow({signal:"CONTROL",pin:"",note:"GPIO/PWM; use a transistor if required",kind:"signal"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
 }
 else if(type==="Motor / Servo"){
   addConnectionRow({signal:protocol==="PWM"?"PWM_CONTROL":"CONTROL",pin:"",note:"Choose configured control pin",kind:"signal"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Common ground",kind:"ground"});
   addConnectionRow({signal:"POWER",pin:"",note:"Use a suitable external supply",kind:"power"});
 }
 else if(type==="Communication Module"){
   power();
   if(protocol==="UART"){addConnectionRow({signal:"TX",pin:"",note:"Module TX → MCU RX",kind:"signal"});addConnectionRow({signal:"RX",pin:"",note:"Module RX → MCU TX",kind:"signal"});}
   else if(protocol==="I2C"){addConnectionRow({signal:"SCL",pin:"",note:"I2C clock",kind:"signal"});addConnectionRow({signal:"SDA",pin:"",note:"I2C data",kind:"signal"});}
   else {addConnectionRow({signal:"SCLK",pin:"",note:"SPI clock",kind:"signal"});addConnectionRow({signal:"MOSI",pin:"",note:"SPI controller out",kind:"signal"});addConnectionRow({signal:"MISO",pin:"",note:"SPI controller in",kind:"signal"});addConnectionRow({signal:"CS",pin:"",note:"Chip select",kind:"signal"});}
 }
 else addConnectionRow();
}
function openComponentModal(c=null){
 const p=project();if(!p){alert("Create or select a project first.");return}
 editingComponentId=c?.id||null;
 $("componentModalTitle").textContent=c?"Edit Component":"Add Component";
 $("componentName").value=c?.name||"";
 $("componentType").value=c?.type||"Generic";
 refreshProtocolOptions(c?.protocol||"");
 $("connectionRows").innerHTML="";
 if(c?.connections?.length)c.connections.forEach(addConnectionRow);
 else applyComponentTemplate($("componentType").value,true);
 $("componentModal").classList.add("show")
}
function closeComponentModal(){$("componentModal").classList.remove("show");editingComponentId=null}
async function saveComponent(){
 const p=project();if(!p)return;const name=$("componentName").value.trim();if(!name){alert("Enter a component name.");return}
 const connections=[...$("connectionRows").querySelectorAll(".connection-row-wrap")].map(w=>({signal:w.querySelector(".c-signal").value.trim(),pin:w.querySelector(".c-pin").value.trim().toUpperCase(),note:w.querySelector(".c-note").value.trim(),kind:w.dataset.kind||"signal"})).filter(x=>x.signal||x.pin||x.note);
 const obj={id:editingComponentId||uid(),name,type:$("componentType").value,protocol:$("componentProtocol").value||"Custom",connections};
 if(editingComponentId){const i=p.components.findIndex(x=>x.id===editingComponentId);if(i>=0)p.components[i]=obj}else p.components.push(obj);
 await save();closeComponentModal();renderComponents();renderWiring()
}


async function exportActiveProject(){
 const p=project();
 if(!p)return;

 const safeName=(p.name||"NucleoPin Project").replace(/[<>:"/\\|?*]+/g,"_");
 const path=await saveDialog({
   defaultPath:`${safeName}.nucleopin.json`,
   filters:[{name:"NucleoPin Project",extensions:["json"]}]
 });
 if(!path)return;

 const payload={
   format:"NucleoPin Project",
   version:1,
   exportedAt:new Date().toISOString(),
   project:structuredClone(p)
 };

 await invoke("write_text_file",{path,text:JSON.stringify(payload,null,2)});
 showToast(`Exported ${p.name}`);
}

async function importProjectBackup(){
 const path=await open({
   multiple:false,
   filters:[{name:"NucleoPin Project",extensions:["json"]}]
 });
 if(!path)return;

 try{
   const payload=JSON.parse(await invoke("read_text_file",{path}));
   if(payload?.format!=="NucleoPin Project"||!payload.project||typeof payload.project!=="object"){
     throw new Error("This is not a NucleoPin project backup.");
   }

   const p=ensureShape(structuredClone(payload.project));
   p.id=uid();
   p.name=(p.name||"Imported Project")+" (Imported)";
   p.created=Date.now();
   p.lastOpened=Date.now();

   state.projects.push(p);
   activeProjectId=p.id;
   state.settings.lastProjectId=p.id;

   await save();
   render();

   if(currentIoc(p))await loadIoc({reason:"silent"});
   showToast(`Imported ${p.name}`);
 }catch(e){
   alert("Could not import this project backup.\\n\\n"+e);
 }
}

async function updateDisplayedVersion(){
 try{
   const version=await getVersion();

   const footer=$("appVersion");
   if(footer)footer.textContent=`NucleoPin v${version}`;

   const about=$("aboutVersion");
   if(about)about.textContent=`NucleoPin v${version}`;

   const welcome=$("welcomeVersion");
   if(welcome)welcome.textContent=`v${version}`;
 }catch(e){
   console.error("Could not read app version:",e);
 }
}

let pendingUpdate=null,updateCheckBusy=false;
function showUpdateAvailableModal(update){
 const modal=$("updateAvailableModal"),text=$("updateAvailableText");
 if(!modal||!text||!update)return;
 text.textContent=`NucleoPin ${update.version} is available. Updating is recommended before continuing.`;
 modal.hidden=false;
}
function hideUpdateAvailableModal(){const modal=$("updateAvailableModal");if(modal)modal.hidden=true;}
function setUpdateStatus(text){const el=$("updateStatus");if(el)el.textContent=text}
async function installPendingUpdate(){
 if(!pendingUpdate)return;
 try{
  hideUpdateAvailableModal();
  setUpdateStatus(`Installing NucleoPin ${pendingUpdate.version}...`);
  await pendingUpdate.downloadAndInstall((e)=>{
   if(e.event==="Started")setUpdateStatus(`Downloading NucleoPin ${pendingUpdate.version}...`);
   else if(e.event==="Finished")setUpdateStatus("Download complete · starting installer...");
  });
 }catch(e){console.error("Update installation failed:",e);setUpdateStatus("Update installation failed.");showToast("Could not install the update")}
}
async function checkForAppUpdate({manual=false}={}){
 if(updateCheckBusy)return; updateCheckBusy=true;
 const btn=$("checkForUpdates");if(btn)btn.disabled=true;
 if(manual)setUpdateStatus("Checking for updates...");
 try{
  const update=await check();pendingUpdate=update||null;
  if(update){
    setUpdateStatus(`NucleoPin ${update.version} is available.`);
    if(manual)showToast(`NucleoPin ${update.version} is available`,"Install Update",installPendingUpdate,12000);
    else showUpdateAvailableModal(update);
  }else{
    hideUpdateAvailableModal();
    setUpdateStatus("NucleoPin is up to date.");
    if(manual)showToast("You're using the latest version");
  }
 }catch(e){
  console.error("Update check failed:",e);
  if(manual){setUpdateStatus("Could not check for updates.");showToast("Could not check for updates")}
  else setUpdateStatus("Automatic update check unavailable.");
 }finally{updateCheckBusy=false;if(btn)btn.disabled=false}
}

const WELCOME_PREF_KEY="nucleopin.welcome.clean.hidden";

function readWelcomeSuppressed(){
 try{return localStorage.getItem(WELCOME_PREF_KEY)==="1"}catch{return false}
}

function applyWelcomeStartupPreference(){
 const overlay=$("welcomeOverlay");
 if(!overlay)return;

 const suppressed=readWelcomeSuppressed();
 $("welcomeDontShow").checked=suppressed;
 overlay.classList.toggle("dismissed",suppressed);
}

function closeWelcome(){
 const suppress=$("welcomeDontShow").checked;
 try{localStorage.setItem(WELCOME_PREF_KEY,suppress?"1":"0")}catch{}
 $("welcomeOverlay").classList.add("dismissed");
}

$("newProject").onclick=()=>newProject(true);
$("welcomeContinue").onclick=closeWelcome;
$("welcomeCreate").onclick=()=>{
 closeWelcome();
 newProject(true);
};

$("exportProject").onclick=exportActiveProject;
$("importProject").onclick=importProjectBackup;

$("aboutApp").onclick=()=>{
 $("aboutShowWelcome").checked=!readWelcomeSuppressed();
 $("aboutModal").hidden=false;
};
$("closeAbout").onclick=()=>{$("aboutModal").hidden=true};
$("checkForUpdates").onclick=()=>checkForAppUpdate({manual:true});
$("installAvailableUpdate").onclick=installPendingUpdate;
$("laterAvailableUpdate").onclick=hideUpdateAvailableModal;

$("aboutShowWelcome").onchange=()=>{
 const show=$("aboutShowWelcome").checked;
 try{localStorage.setItem(WELCOME_PREF_KEY,show?"0":"1")}catch{}
 $("welcomeDontShow").checked=!show;
 showToast(show?"Welcome screen enabled":"Welcome screen disabled");
};

$("showWelcomeNow").onclick=()=>{
 $("aboutModal").hidden=true;
 $("welcomeOverlay").classList.remove("dismissed");
};


for(const id of ["aboutModal","missingIocModal"]){
 const modal=$(id);
 if(modal){
   modal.addEventListener("click",e=>{
     if(e.target!==modal)return;
     modal.hidden=true;
     if(id==="missingIocModal")missingIocContext=null;
   });
 }
}

$("closeMissingIoc").onclick=()=>{
 $("missingIocModal").hidden=true;
 missingIocContext=null;
};

$("locateMissingIoc").onclick=async()=>{
 const ctx=missingIocContext;
 $("missingIocModal").hidden=true;
 missingIocContext=null;
 if(ctx)await locateIocForFile(ctx.projectId,ctx.fileIndex);
};
$("addIoc").onclick=addIoc;
$("openCubeMx").onclick=async()=>{
 const f=currentIoc(project());
 if(!f?.path){alert("Add or select an IOC file first.");return}
 try{
  await invoke("open_ioc_file",{path:f.path});
  watchStatus.textContent="Opened active IOC in CubeMX";showToast(`Opened ${fileName(f.path)} in CubeMX`);
 }catch(e){
  alert("Could not open the IOC file.\n\n"+e+"\n\nMake sure STM32CubeMX is installed and .ioc files are associated with STM32CubeMX in Windows.");
 }
};
$("refreshIoc").onclick=()=>loadIoc({reason:"manual"});$("renameProject").onclick=renameProject;$("removeProject").onclick=removeProject;search.oninput=renderProjects;
search.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&search.value){
   e.stopPropagation();
   search.value="";
   renderProjects();
 }
});
notes.oninput=()=>{const p=project();if(!p)return;p.notes=notes.value;clearTimeout(notesTimer);notesTimer=setTimeout(save,500)};
autoReload.onchange=async()=>{state.settings.autoReload=autoReload.checked;await save();watchStatus.textContent=autoReload.checked?"Auto reload enabled":"Auto reload disabled";showToast(autoReload.checked?"IOC auto reload enabled":"IOC auto reload disabled")};
$("addPinLabel").onclick=async()=>{const p=project();if(!p){alert("Select a project first.");return}const pin=$("pinLabelPin").value.trim().toUpperCase(),label=$("pinLabelName").value.trim();if(!/^P[A-H]\d+$/.test(pin)||!label){alert("Enter a valid MCU pin such as PA5 and a label.");return}p.pinLabels[pin]=label;$("pinLabelPin").value="";$("pinLabelName").value="";await save();renderLabels();renderWiring()};
$("addComponent").onclick=()=>openComponentModal();
$("componentType").addEventListener("change",()=>{refreshProtocolOptions();if(!editingComponentId)applyComponentTemplate($("componentType").value,true);});
$("componentProtocol").addEventListener("change",()=>{
 const selected=$("componentProtocol").value;
 refreshProtocolOptions(selected);
 if(!editingComponentId)applyComponentTemplate($("componentType").value,true);
 document.querySelectorAll("#connectionRows .pin-picker").forEach(p=>p.refreshRecommendations?.());
});
$("addConnectionRow").onclick=()=>addConnectionRow();$("closeComponentModal").onclick=closeComponentModal;$("cancelComponent").onclick=closeComponentModal;$("saveComponent").onclick=saveComponent;$("componentModal").onclick=e=>{if(e.target===$("componentModal"))closeComponentModal()};
$("runSmartCheck").onclick=executeSmartCheck;
$("clearChanges").onclick=async()=>{const p=project();if(!p)return;if(!confirm("Clear saved IOC change history for this project?"))return;p.changeHistory=[];await save();renderChangeHistory();};
$("copyWiring").onclick=async()=>{const rows=wiringRows();if(!rows.length)return;const text=["Component\tSignal\tMCU Pin\tProject Label / Note",...rows.map(r=>`${r.component}\t${r.signal}\t${r.pin}\t${r.label||r.note||""}`)].join("\n");await navigator.clipboard.writeText(text);setStatus("Wiring table copied")};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
 document.querySelectorAll(".tab-page").forEach(x=>x.classList.remove("active"));
 b.classList.add("active");
 document.querySelector(`[data-page="${b.dataset.tab}"]`).classList.add("active");
 if(b.dataset.tab==="check"&&currentIoc())executeSmartCheck();
});
document.querySelectorAll(".screen-nav").forEach(b=>b.addEventListener("click",()=>setScreen(b.dataset.screen)));
document.querySelectorAll("[data-jump-screen]").forEach(b=>b.addEventListener("click",()=>setScreen(b.dataset.jumpScreen)));
document.addEventListener("keydown",e=>{
 if(e.key!=="Escape")return;
 closeComponentModal();
 if($("aboutModal"))$("aboutModal").hidden=true;
 if($("missingIocModal"))$("missingIocModal").hidden=true;
 hideUpdateAvailableModal();
});
frame.addEventListener("load",publishWiringToVisualizer);
applyWelcomeStartupPreference();
updateDisplayedVersion();
initNamingGuide();
setScreen("dashboard");
watchTimer=setInterval(poll,3000);
load();
setTimeout(()=>checkForAppUpdate({manual:false}),4500);