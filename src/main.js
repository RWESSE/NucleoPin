import { invoke } from "@tauri-apps/api/core";
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

const ensureShape=p=>{p.pinLabels??={};p.components??=[];p.notes??="";p.iocFiles??=[];p.changeHistory??=[];p.lastPinSnapshot??={};return p};

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
 projectList.innerHTML="";const q=search.value.trim().toLowerCase();
 const rows=state.projects
   .filter(p=>!q||p.name.toLowerCase().includes(q)||p.iocFiles.some(f=>f.path.toLowerCase().includes(q)))
   .sort((a,b)=>(b.lastOpened||b.created||0)-(a.lastOpened||a.created||0));
 if(!rows.length){projectList.innerHTML='<div style="font-size:10px;color:#8292aa;padding:8px 3px">No matching projects.</div>';return}
 rows.forEach(p=>{const b=document.createElement("button");b.className="project-row"+(p.id===activeProjectId?" active":"");const af=currentIoc(p);
 b.innerHTML=`<div class="name">${esc(p.name)}</div><div class="meta">${p.iocFiles.length} IOC · ${p.components.length} component${p.components.length===1?"":"s"}${af?` · ${esc(fileName(af.path))}`:""}</div>`;b.onclick=async()=>{activeProjectId=p.id;state.settings.lastProjectId=p.id;await save();render();currentIoc()?await loadIoc({reason:"silent"}):clearVisual()};projectList.appendChild(b)})
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

    if(component.type==="OLED Display"){
      const scl=conns.find(c=>String(c.signal||"").toUpperCase().includes("SCL"));
      const sda=conns.find(c=>String(c.signal||"").toUpperCase().includes("SDA"));

      if(!scl || !sda){
        issues.push(classifyIssue("error",`${component.name} is missing I²C SCL or SDA`,"An I²C OLED normally needs both clock and data connections.", "",component.name));
      }

      for(const [name,conn,expected] of [["SCL",scl,"SCL"],["SDA",sda,"SDA"]]){
        if(!conn?.pin)continue;
        const pin=String(conn.pin).toUpperCase();
        const sig=cfg[pin]?.signal||"";
        if(sig && !sig.toUpperCase().includes(expected)){
          issues.push(classifyIssue(
            "warning",
            `${component.name} ${name} does not match IOC function`,
            `${pin} is configured as ${sig}, not an I²C ${name} function.`,
            pin,component.name
          ));
        }
      }
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
 p.components.forEach(c=>{const row=document.createElement("div");row.className="component-row";const chips=c.connections.map(x=>`<span class="connection-chip">${esc(x.signal||"?")} → ${esc(x.pin||"?")}</span>`).join("");row.innerHTML=`<div class="label">${esc(c.name)} <span class="badge">${esc(c.type)}</span></div><div>${chips}</div><button class="remove-x">×</button>`;row.onclick=e=>{if(e.target.classList.contains("remove-x")){
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
function render(){renderProjects();renderIocs();renderLabels();renderComponents();renderWiring();renderPeripherals();renderChangeHistory();renderDetails();publishWiringToVisualizer()}
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

function makePinPicker(selected=""){
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
   const items=allItems().filter(item=>{
     const hay=`${item.pin} ${item.label||""} ${item.signal||""}`.toLowerCase();
     return !q||hay.includes(q);
   }).slice(0,40);

   menu.innerHTML="";
   if(!items.length){
     const empty=document.createElement("div");
     empty.className="pin-picker-empty";
     empty.textContent="No configured IOC pin matches";
     menu.appendChild(empty);
   }else{
     items.forEach(item=>{
       const b=document.createElement("button");
       b.type="button";
       b.className="pin-picker-item";
       b.dataset.pin=item.pin;
       b.innerHTML=`<b>${esc(item.pin)}</b><span>${esc(item.label||"(no label)")}</span><small>${esc(item.signal||"")}</small>`;
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

 const picker=makePinPicker(data.pin||"");
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
 remove.onclick=()=>wrap.remove();
 $("connectionRows").appendChild(wrap);
 updateInfo();
}

function applyComponentTemplate(type,force=false){
 const root=$("connectionRows");
 if(!force&&root.children.length){
   if(!confirm(`Replace the current connections with the ${type} template?`))return;
 }
 root.innerHTML="";

 if(type==="LED"){
   addConnectionRow({signal:"ANODE / GPIO",pin:"",note:"330 Ω series resistor between GPIO and LED anode",kind:"signal"});
   addConnectionRow({signal:"CATHODE",pin:"GND",note:"LED cathode to GND",kind:"ground"});
 }else if(type==="Push Button"){
   addConnectionRow({signal:"BUTTON_SIGNAL",pin:"",note:"GPIO input; internal pull-up recommended",kind:"signal"});
   addConnectionRow({signal:"OTHER_SIDE",pin:"GND",note:"Button connects input to GND when pressed",kind:"ground"});
 }else if(type==="OLED Display"){
   addConnectionRow({signal:"VCC",pin:"3V3",note:"Confirm module supply voltage",kind:"power"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
   addConnectionRow({signal:"SCL",pin:"",note:"Choose configured I2C SCL pin",kind:"signal"});
   addConnectionRow({signal:"SDA",pin:"",note:"Choose configured I2C SDA pin",kind:"signal"});
 }else if(type==="Sensor"){
   addConnectionRow({signal:"VCC",pin:"3V3",note:"Confirm sensor supply voltage",kind:"power"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
   addConnectionRow({signal:"SIGNAL",pin:"",note:"Choose configured signal pin",kind:"signal"});
 }else if(type==="Buzzer"){
   addConnectionRow({signal:"CONTROL",pin:"",note:"Use a transistor driver if buzzer current exceeds GPIO capability",kind:"signal"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
 }else if(type==="Motor / Servo"){
   addConnectionRow({signal:"CONTROL",pin:"",note:"Choose configured PWM/control pin",kind:"signal"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Common ground",kind:"ground"});
   addConnectionRow({signal:"POWER",pin:"",note:"Use suitable external power supply",kind:"power"});
 }else if(type==="Communication Module"){
   addConnectionRow({signal:"VCC",pin:"3V3",note:"Confirm module supply voltage",kind:"power"});
   addConnectionRow({signal:"GND",pin:"GND",note:"Ground",kind:"ground"});
   addConnectionRow({signal:"TX / SDA / MOSI",pin:"",note:"Choose configured communication pin",kind:"signal"});
   addConnectionRow({signal:"RX / SCL / MISO",pin:"",note:"Choose configured communication pin",kind:"signal"});
 }else{
   addConnectionRow();
 }
}

function openComponentModal(c=null){
 const p=project();if(!p){alert("Create or select a project first.");return}
 editingComponentId=c?.id||null;
 $("componentModalTitle").textContent=c?"Edit Component":"Add Component";
 $("componentName").value=c?.name||"";
 $("componentType").value=c?.type||"Generic";
 $("connectionRows").innerHTML="";
 if(c?.connections?.length)c.connections.forEach(addConnectionRow);
 else applyComponentTemplate($("componentType").value,true);
 $("componentModal").classList.add("show")
}
function closeComponentModal(){$("componentModal").classList.remove("show");editingComponentId=null}
async function saveComponent(){
 const p=project();if(!p)return;const name=$("componentName").value.trim();if(!name){alert("Enter a component name.");return}
 const connections=[...$("connectionRows").querySelectorAll(".connection-row-wrap")].map(w=>({signal:w.querySelector(".c-signal").value.trim(),pin:w.querySelector(".c-pin").value.trim().toUpperCase(),note:w.querySelector(".c-note").value.trim(),kind:w.dataset.kind||"signal"})).filter(x=>x.signal||x.pin||x.note);
 const obj={id:editingComponentId||uid(),name,type:$("componentType").value,connections};
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



let pendingUpdate=null,updateCheckBusy=false;
function setUpdateStatus(text){const el=$("updateStatus");if(el)el.textContent=text}
async function installPendingUpdate(){
 if(!pendingUpdate)return;
 try{
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
  if(update){setUpdateStatus(`NucleoPin ${update.version} is available.`);showToast(`NucleoPin ${update.version} is available`,"Install Update",installPendingUpdate,12000)}
  else{setUpdateStatus("NucleoPin is up to date.");if(manual)showToast("You're using the latest version")}
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
notes.oninput=()=>{const p=project();if(!p)return;p.notes=notes.value;clearTimeout(notesTimer);notesTimer=setTimeout(save,500)};
autoReload.onchange=async()=>{state.settings.autoReload=autoReload.checked;await save();watchStatus.textContent=autoReload.checked?"Auto reload enabled":"Auto reload disabled";showToast(autoReload.checked?"IOC auto reload enabled":"IOC auto reload disabled")};
$("addPinLabel").onclick=async()=>{const p=project();if(!p){alert("Select a project first.");return}const pin=$("pinLabelPin").value.trim().toUpperCase(),label=$("pinLabelName").value.trim();if(!/^P[A-H]\d+$/.test(pin)||!label){alert("Enter a valid MCU pin such as PA5 and a label.");return}p.pinLabels[pin]=label;$("pinLabelPin").value="";$("pinLabelName").value="";await save();renderLabels();renderWiring()};
$("addComponent").onclick=()=>openComponentModal();$("componentType").addEventListener("change",()=>{if(!editingComponentId)applyComponentTemplate($("componentType").value);});$("addConnectionRow").onclick=()=>addConnectionRow();$("closeComponentModal").onclick=closeComponentModal;$("cancelComponent").onclick=closeComponentModal;$("saveComponent").onclick=saveComponent;$("componentModal").onclick=e=>{if(e.target===$("componentModal"))closeComponentModal()};
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
document.addEventListener("keydown",e=>{
 if(e.key!=="Escape")return;
 closeComponentModal();
 if($("aboutModal"))$("aboutModal").hidden=true;
 if($("missingIocModal"))$("missingIocModal").hidden=true;
});
frame.addEventListener("load",publishWiringToVisualizer);
applyWelcomeStartupPreference();
watchTimer=setInterval(poll,3000);
load();
setTimeout(()=>checkForAppUpdate({manual:false}),4500);
