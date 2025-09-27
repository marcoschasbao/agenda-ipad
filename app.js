const { useState, useMemo, useRef } = React;

// === Agenda iPad — app.js (v8) ===
// - Tap en "Plan del día": modal rápida para crear nota (título = cliente).
// - Prioridades: Hoy / Esta semana / La semana que viene / Próxima visita (chips + actualización automática).
// - Unicidad: 1 nota por cliente y día.
// - Repetir plan: ciclo de 28 días durante ~3 meses (en memoria) hasta nuevo JSON.
// - Notas ligadas al cliente: aparecen en futuras visitas hasta completarlas (checkbox + sonido + desaparecen).
// - Deshabilitar sábados y domingos ("Día no laborable").
// - Semana: muestra prioridad y permite deslizar para cambiar semana.

function App() {
  const WEEK_STARTS_ON = 1; // Lunes
  const locale = "es-ES";

  const today = useMemo(() => stripTime(new Date()), []);
  const [currentView, setCurrentView] = useState("month");
  const [viewDate, setViewDate] = useState(() => stripTime(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);

  const [itemsByDate, setItemsByDate] = useState({});
  const [showEditor, setShowEditor] = useState(false);
  const [errorNew, setErrorNew] = useState("");
  const [errorEdit, setErrorEdit] = useState("");

  // Modal Importar
  const [showImport, setShowImport] = useState(false);

  // Quick modal desde Plan del día
  const [quick, setQuick] = useState({ open:false, clienteId:"", clienteNombre:"", texto:"", prioridad:"hoy" });

  // borrador NUEVA nota
  const [draft, setDraft] = useState({ mode: "lista", clienteId: "", cliente: "", texto: "", prioridad: "hoy" });
  // borrador EDICIÓN
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ mode: "lista", clienteId: "", cliente: "", texto: "", prioridad: "hoy" });

  const canSaveNew = useMemo(() => {
    if (draft.mode === "lista") return !!draft.clienteId;
    return (draft.cliente || "").trim().length > 0;
  }, [draft]);
  const canSaveEdit = useMemo(() => {
    if (editDraft.mode === "lista") return !!editDraft.clienteId;
    return (editDraft.cliente || "").trim().length > 0;
  }, [editDraft]);
  const idSeq = useRef(1);

  // Datos desde localStorage
  const clientsData = useMemo(() => readClientsFromLocalStorage(), []);
  const clientsById = clientsData.clientsById || {};

  const rawPlanByDate = useMemo(() => readPlanByDateFromLocalStorage(), []);
  const planByDate = useMemo(() => expandPlan(rawPlanByDate, { months: 3, stepDays: 28 }), [rawPlanByDate]);
  const planDatesSorted = useMemo(() => Object.keys(planByDate).sort(), [planByDate]);

  // Navegación y etiquetas
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const headerLabel = useMemo(()=>{
    if (currentView==="month") return formatMonthYear(viewDate, locale);
    if (currentView==="week"){ const s=startOfWeek(viewDate,1), e=endOfWeek(viewDate,1); return formatWeekRange(s,e,locale); }
    return formatDay(viewDate, locale);
  }, [currentView, viewDate]);

  const monthMatrix = useMemo(()=>buildMonthMatrix(year, month, WEEK_STARTS_ON),[year,month]);
  const weekRow = useMemo(()=>buildWeekRow(viewDate, WEEK_STARTS_ON), [viewDate]);
  const currentKey = useMemo(()=>ymd(viewDate), [viewDate]);
  const itemsToday = (itemsByDate[currentKey] || []).filter(x=>!x.completed);
  const plannedIdsForDay = planByDate[currentKey] || [];

  // Notas arrastradas a futuras visitas (solo con clienteId y no completadas)
  const carriedNotes = useMemo(()=>{
    if (!plannedIdsForDay.length) return [];
    const res = [];
    for (const k of Object.keys(itemsByDate)){
      if (k >= currentKey) continue; // solo pasadas
      const arr = itemsByDate[k]||[];
      for (const it of arr){
        if (it.completed) continue;
        if (!it.clienteId) continue; // solo ligadas a cliente
        if (plannedIdsForDay.includes(it.clienteId)) res.push({ ...it, __origin:k });
      }
    }
    return res;
  }, [itemsByDate, plannedIdsForDay, currentKey]);

  // Lista notas de la semana (orden por cercanía)
  const notesOfWeek = useMemo(()=>{
    const all=[]; const ref=viewDate;
    for (const d of weekRow){ const k=ymd(d); const arr=(itemsByDate[k]||[]).filter(x=>!x.completed); for (const it of arr) all.push({...it, date:d}); }
    all.sort((a,b)=>{ const da=(stripTime(a.date)-ref)/86400000, db=(stripTime(b.date)-ref)/86400000; const ad=Math.abs(da), bd=Math.abs(db); if(ad!==bd) return ad-bd; if(da!==db) return da-db; return 0;});
    return all;
  }, [itemsByDate, weekRow, viewDate]);

  // Helpers selector día
  const plannedOptions = useMemo(()=>{
    const opts = plannedIdsForDay.map(id => ({ value:id, label: (clientsById[id] && clientsById[id].nombre) || `ID ${id}` }));
    // Si estamos editando y el cliente no está en plan, lo incluimos arriba
    if (editingId){
      const cur = (itemsToday.find(x=>x.id===editingId)) || null;
      const curId = cur && cur.clienteId || null;
      const curLabel = cur ? (cur.cliente || (cur.clienteId && clientsById[cur.clienteId] && clientsById[cur.clienteId].nombre) || (cur.clienteId?`ID ${cur.clienteId}`:"")) : "";
      if (curId && !opts.some(o=>o.value===curId)) opts.unshift({ value: curId, label: curLabel });
      if (!curId && curLabel && !opts.some(o=>o.label===curLabel)) opts.unshift({ value: `__legacy__:${curLabel}`, label: curLabel });
    }
    return uniqBy(opts, o=>o.value);
  }, [plannedIdsForDay, clientsById, editingId, itemsToday]);

  // Gestos (día y semana)
  const tX = useRef(0), tY = useRef(0);
  const onTouchStart = (e)=>{ if(!e.touches || !e.touches.length) return; tX.current=e.touches[0].clientX; tY.current=e.touches[0].clientY; };
  const onTouchEndDay = (e)=>{ if(!e.changedTouches || !e.changedTouches.length) return; const dx=e.changedTouches[0].clientX-tX.current; const dy=e.changedTouches[0].clientY-tY.current; if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*1.3){ const step = dx<0?1:-1; const nd=skipWeekends(addDays(viewDate, step)); setViewDate(nd); setSelectedDate(nd);} };
  const onTouchEndWeek = (e)=>{ if(!e.changedTouches || !e.changedTouches.length) return; const dx=e.changedTouches[0].clientX-tX.current; const dy=e.changedTouches[0].clientY-tY.current; if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*1.3){ const nd=addDays(viewDate, dx<0?7:-7); setViewDate(nd);} };

  // Navegación
  const goPrev = ()=>{
    if(currentView==="month") setViewDate(addMonths(viewDate,-1));
    else if(currentView==="week") setViewDate(addDays(viewDate,-7));
    else { const nd=skipWeekends(addDays(viewDate,-1)); setViewDate(nd); setSelectedDate(nd);} };
  const goNext = ()=>{
    if(currentView==="month") setViewDate(addMonths(viewDate,1));
    else if(currentView==="week") setViewDate(addDays(viewDate,7));
    else { const nd=skipWeekends(addDays(viewDate,1)); setViewDate(nd); setSelectedDate(nd);} };
  const goToday = ()=>{ const d=skipWeekends(today); setViewDate(d); setSelectedDate(d); };
  const onPick = (day)=>{ if(isWeekend(day)) return; setSelectedDate(day); setViewDate(day); if(currentView!=="day") setCurrentView("day"); };

  // CRUD notas
  const addItemFor = (key, item)=> setItemsByDate(prev=>({ ...prev, [key]: [ ...(prev[key]||[]), item ] }));
  const replaceItemsAt = (key, mapper)=> setItemsByDate(prev=>({ ...prev, [key]: (prev[key]||[]).map(mapper) }));
  const removeItemAt = (key, id)=> setItemsByDate(prev=>({ ...prev, [key]: (prev[key]||[]).filter(x=>x.id!==id) }));

  // Unicidad por cliente/día (id o nombre si no hay id)
  const hasDuplicateForDay = (key, clienteId, clienteName, ignoreId=null)=>{
    const norm = uniqueKey(clienteId, clienteName);
    const arr = itemsByDate[key]||[];
    return arr.some(x=> x.id!==ignoreId && uniqueKey(x.clienteId, x.cliente)===norm);
  };

  // Completar (checkbox)
  const playDing = ()=>{ try{ const C=(window.AudioContext||window.webkitAudioContext); if(!C) return; const ctx=new C(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime+0.25); o.stop(ctx.currentTime+0.25);}catch(_){} };
  const completeNote = (originKey, id)=>{
    setItemsByDate(prev=>({ ...prev, [originKey]: (prev[originKey]||[]).map(x=> x.id===id? {...x, completed:true}: x) }));
    playDing();
  };

  // Abrir nuevo: si no hay plan, forzamos "fuera de ruta"
  const openNew = ()=>{
    setErrorNew("");
    if ((plannedIdsForDay||[]).length===0) {
      setDraft({ mode:"custom", clienteId:"", cliente:"", texto:"", prioridad:"hoy" });
    } else {
      setDraft({ mode:"lista", clienteId:"", cliente:"", texto:"", prioridad:"hoy" });
    }
    setShowEditor(true);
  };
  const cancelNew = ()=>{ setShowEditor(false); setErrorNew(""); };
  const saveNew = ()=>{
    setErrorNew("");
    const key = currentKey;
    if (draft.mode==="lista"){
      if (!draft.clienteId){ setErrorNew("Selecciona un cliente del plan o usa ‘Fuera de ruta’."); return; }
      const nombreTry = (clientsById[draft.clienteId] && clientsById[draft.clienteId].nombre) || "";
      if (hasDuplicateForDay(key, draft.clienteId, nombreTry)) { setErrorNew("Ya existe una nota para ese cliente hoy."); return; }
      const id = String(idSeq.current++);
      const nombre = nombreTry || `ID ${draft.clienteId}`;
      addItemFor(key, { id, clienteId: draft.clienteId, cliente: nombre, texto: draft.texto, fueraRuta: false, prioridad: draft.prioridad||"hoy", anchorDate: key, completed:false });
    } else {
      const nombre = (draft.cliente||"").trim();
      if (!nombre){ setErrorNew("Indica un cliente (fuera de ruta) o cambia a lista."); return; }
      if (hasDuplicateForDay(key, null, nombre)) { setErrorNew("Ya existe una nota para ese cliente hoy."); return; }
      const id = String(idSeq.current++);
      addItemFor(key, { id, clienteId: null, cliente: nombre, texto: draft.texto, fueraRuta: true, prioridad: draft.prioridad||"hoy", anchorDate: key, completed:false });
    }
    setShowEditor(false);
  };

  const startEdit = (it, originKey=null)=>{
    setErrorEdit("");
    setEditingId(it.id);
    setEditDraft({ mode: it.fueraRuta?"custom":"lista", clienteId: it.clienteId||"", cliente: it.cliente||"", texto: it.texto||"", prioridad: it.prioridad||"hoy", __origin: originKey||currentKey });
  };
  const cancelEdit = ()=>{ setEditingId(null); setErrorEdit(""); };
  const saveEdit = ()=>{
    setErrorEdit("");
    const key = editDraft.__origin || currentKey;
    if (editDraft.mode==="lista"){
      if (!editDraft.clienteId){ setErrorEdit("Selecciona un cliente del plan o usa ‘Fuera de ruta’."); return; }
      const nombreTry = (clientsById[editDraft.clienteId] && clientsById[editDraft.clienteId].nombre) || "";
      if (hasDuplicateForDay(key, editDraft.clienteId, nombreTry, editingId)) { setErrorEdit("Ya existe una nota para ese cliente en ese día."); return; }
      replaceItemsAt(key, (x)=> x.id!==editingId ? x : {
        ...x,
        clienteId: editDraft.clienteId,
        cliente: nombreTry || `ID ${editDraft.clienteId}`,
        texto: editDraft.texto,
        fueraRuta: false,
        prioridad: editDraft.prioridad||x.prioridad||"hoy",
      });
    } else {
      const nombre = (editDraft.cliente||"").trim();
      if (!nombre){ setErrorEdit("Indica un cliente (fuera de ruta) o cambia a lista."); return; }
      if (hasDuplicateForDay(key, null, nombre, editingId)) { setErrorEdit("Ya existe una nota para ese cliente en ese día."); return; }
      replaceItemsAt(key, (x)=> x.id!==editingId ? x : {
        ...x,
        clienteId: null,
        cliente: nombre,
        texto: editDraft.texto,
        fueraRuta: true,
        prioridad: editDraft.prioridad||x.prioridad||"hoy",
      });
    }
    setEditingId(null);
  };
  const deleteItem = (originKey, id)=> removeItemAt(originKey, id);

  // Tap en plan del día (sin texto extra)
  const onPlanClientClick = (clienteId)=>{
    const key=currentKey; const nombre = (clientsById[clienteId] && clientsById[clienteId].nombre) || `ID ${clienteId}`;
    const dup = (itemsByDate[key]||[]).find(x=> !x.completed && uniqueKey(x.clienteId, x.cliente)===uniqueKey(clienteId, nombre));
    if (dup){ startEdit(dup, key); return; }
    setQuick({ open:true, clienteId, clienteNombre:nombre, texto:"", prioridad:"hoy" });
  };
  const cancelQuick = ()=> setQuick(q=>({...q, open:false}));
  const saveQuick = ({texto, prioridad})=>{
    const key=currentKey; const nombre = quick.clienteNombre; const clienteId = quick.clienteId;
    if (hasDuplicateForDay(key, clienteId, nombre)) { setQuick(q=>({...q, open:false})); return; }
    const id = String(idSeq.current++);
    addItemFor(key, { id, clienteId, cliente: nombre, texto: texto||"", fueraRuta: false, prioridad: prioridad||"hoy", anchorDate: key, completed:false });
    setQuick(q=>({...q, open:false}));
  };

  const nonWorking = isWeekend(viewDate);

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={goPrev} aria-label="Anterior" className="h-10 w-10 rounded-2xl border text-xl leading-none hover:bg-gray-50 active:scale-[0.98]">‹</button>
            <button onClick={goNext} aria-label="Siguiente" className="h-10 w-10 rounded-2xl border text-xl leading-none hover:bg-gray-50 active:scale-[0.98]">›</button>
          </div>
          <h1 className="text-base sm:text-lg md:text-xl font-semibold capitalize select-none">{headerLabel}</h1>
          <div className="flex items-center gap-2">
            <div className="hidden sm:grid grid-cols-3 rounded-2xl border overflow-hidden text-sm">
              {[{key:"month",label:"Mes"},{key:"week",label:"Semana"},{key:"day",label:"Día"}].map(v=>
                <button key={v.key} onClick={()=>setCurrentView(v.key)} className={["px-3 py-1.5 font-medium", currentView===v.key?"bg-blue-600 text-white":"bg-white hover:bg-gray-50"].join(" ")} aria-pressed={currentView===v.key}>{v.label}</button>
              )}
            </div>
            <button onClick={goToday} className="h-10 px-3 rounded-2xl border font-medium hover:bg-gray-50 active:scale-[0.98]">Hoy</button>
            <button onClick={()=>{ setShowImport(true); }} className="h-10 px-3 rounded-2xl border font-medium hover:bg-gray-50 active:scale-[0.98]" title="Pegar clientes.json y plan.json">Importar</button>
          </div>
        </div>
        <div className="sm:hidden max-w-3xl mx-auto px-4 pb-3">
          <div className="grid grid-cols-3 rounded-2xl border overflow-hidden text-sm">
            {[{key:"month",label:"Mes"},{key:"week",label:"Semana"},{key:"day",label:"Día"}].map(v=>
              <button key={v.key} onClick={()=>setCurrentView(v.key)} className={["px-3 py-2 font-medium", currentView===v.key?"bg-blue-600 text-white":"bg-white hover:bg-gray-50"].join(" ")} aria-pressed={currentView===v.key}>{v.label}</button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="max-w-3xl mx-auto w-full px-2 sm:px-4 py-4 grow">
        {(currentView==="month" || currentView==="week") && (
          <div className="grid grid-cols-7 text-center text-xs sm:text-sm font-medium text-gray-500 select-none">
            {weekdayLabels(locale, WEEK_STARTS_ON).map(d=> <div key={d} className="py-2">{d}</div>)}
          </div>
        )}

        {/* MES */}
        {currentView==="month" && (
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {monthMatrix.map((week, wi)=>
              <React.Fragment key={wi}>
                {week.map(day=>{
                  const inCurrent = day.getMonth()===month;
                  const isToday = isSameDay(day, today);
                  const isSelected = isSameDay(day, selectedDate);
                  const weekend = isWeekend(day);
                  return (
                    <button key={ymd(day)} onClick={()=>onPick(day)} disabled={weekend}
                      className={["aspect-square w-full rounded-2xl border text-sm sm:text-base flex items-center justify-center select-none","transition-transform active:scale-[0.98]", inCurrent?"bg-white":"bg-gray-50 text-gray-300", isSelected?"bg-blue-600 text-white border-blue-600":"", (!isSelected&&isToday)?"ring-2 ring-blue-500":"", weekend?"opacity-40 cursor-not-allowed":"hover:bg-gray-50"].join(" ")}
                      aria-disabled={weekend} aria-pressed={isSelected} aria-current={isToday?"date":undefined}
                      title={new Intl.DateTimeFormat(locale,{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(day)}>
                      <span className="tabular-nums font-medium">{day.getDate()}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            )}
          </div>
        )}

        {/* SEMANA */}
        {currentView==="week" && (
          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEndWeek}>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {weekRow.map(day=>{
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selectedDate);
                const weekend = isWeekend(day);
                return (
                  <button key={ymd(day)} onClick={()=>onPick(day)} disabled={weekend}
                    className={["aspect-square w-full rounded-2xl border text-base flex items-center justify-center select-none","transition-transform active:scale-[0.98]","bg-white", isSelected?"bg-blue-600 text-white border-blue-600":"", (!isSelected&&isToday)?"ring-2 ring-blue-500":"", weekend?"opacity-40 cursor-not-allowed":"hover:bg-gray-50"].join(" ")}
                    aria-disabled={weekend} aria-pressed={isSelected} aria-current={isToday?"date":undefined}>
                    <div className="flex flex-col items-center leading-tight">
                      <span className="text-xs text-gray-500 font-medium">{new Intl.DateTimeFormat(locale,{weekday:"short"}).format(day)}</span>
                      <span className="tabular-nums font-semibold text-lg">{day.getDate()}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Notas de la semana</h2>
                <span className="text-xs text-gray-500">{notesOfWeek.length}</span>
              </div>
              <ul className="border-t divide-y">
                {notesOfWeek.length ? (
                  notesOfWeek.map((it,i)=>
                    <li key={it.id+"-"+ymd(it.date)+"-"+i} className="px-4 py-2 text-sm flex items-start gap-2">
                      <span className="shrink-0 w-16 text-xs text-gray-500">{formatShortDate(it.date)}</span>
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {it.cliente|| (it.clienteId?(`ID ${it.clienteId}`):"(Sin cliente)")}
                          <PriorityBadge item={it} planByDate={planByDate} planDatesSorted={planDatesSorted} />
                          {it.fueraRuta && <span className="text-[10px] px-1.5 py-0.5 rounded-full border">Fuera de ruta</span>}
                        </div>
                        <div className="text-gray-600">{it.texto||"(Sin descripción)"}</div>
                      </div>
                    </li>
                  )
                ) : (
                  <li className="px-4 py-3 text-sm text-gray-400">Sin notas esta semana.</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* DÍA */}
        {currentView==="day" && (
          <div className="space-y-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEndDay}>
            <div className="px-4 py-4 rounded-2xl border flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-blue-600 text-white grid place-items-center text-lg font-bold">{viewDate.getDate()}</div>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500 font-medium">{new Intl.DateTimeFormat(locale,{weekday:"long"}).format(viewDate)}</span>
                <span className="text-base font-semibold">{formatDayNoWeekday(viewDate, locale)}</span>
              </div>
            </div>

            {nonWorking && (
              <div className="px-4 py-3 rounded-2xl border bg-gray-50 text-gray-700">Día no laborable</div>
            )}

            {/* Plan del día */}
            <div className="rounded-2xl border overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Plan del día</h2>
                <span className="text-xs text-gray-500">{plannedIdsForDay.length} clientes</span>
              </div>
              <ul className="border-t divide-y">
                {plannedIdsForDay.length ? (
                  plannedIdsForDay.map(id=> (
                    <li key={id} className="px-4 py-2">
                      <button onClick={()=>!nonWorking && onPlanClientClick(id)} disabled={nonWorking} className="w-full text-left text-sm flex items-center justify-between gap-2 hover:bg-gray-50 rounded-xl px-2 py-1.5 active:scale-[0.99] disabled:opacity-50">
                        <span>{(clientsById[id] && clientsById[id].nombre) || `ID ${id}`}</span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="px-4 py-3 text-sm text-gray-400">Sin plan para este día.</li>
                )}
              </ul>
            </div>

            {/* Notas */}
            <div className="rounded-2xl border overflow-hidden flex flex-col">
              <div className="px-4 py-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Notas</h2>
                <button onClick={openNew} disabled={nonWorking} className="h-9 px-3 rounded-2xl border font-medium hover:bg-gray-50 disabled:opacity-50">+ Nueva nota</button>
              </div>

              {showEditor && !nonWorking && (
                <div className="px-4 pb-4 space-y-2 border-t">
                  {/* Selector (solo plan del día) o fuera de ruta */}
                  <div className="flex gap-2 items-center">
                    {draft.mode === "lista" ? (
                      plannedOptions.length ? (
                        <select value={draft.clienteId} onChange={(e)=>setDraft(d=>({...d, clienteId:e.target.value }))} className="h-9 rounded-2xl border px-3 flex-1">
                          <option value="" disabled>Selecciona cliente del plan</option>
                          {plannedOptions.map(o=> <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <div className="text-sm text-gray-500">Sin plan para este día. Usa “Fuera de ruta”.</div>
                      )
                    ) : (
                      <input value={draft.cliente} onChange={(e)=>setDraft(d=>({...d, cliente:e.target.value }))} placeholder="Cliente (fuera de ruta)" className="h-9 rounded-2xl border px-3 flex-1" />
                    )}

                    <button
                      onClick={()=> setDraft(d=> ({...d, mode: d.mode==="lista"?"custom":"lista"}))}
                      className={"h-9 px-3 rounded-2xl border" + (plannedOptions.length===0 && draft.mode!=="custom"?" opacity-60 cursor-not-allowed":"")}
                      disabled={plannedOptions.length===0 && draft.mode!=="custom"}
                      title={draft.mode==="lista"?"Crear fuera de ruta":"Volver a lista"}
                    >
                      {draft.mode==="lista"?"Fuera de ruta":"Lista clientes"}
                    </button>
                  </div>

                  {/* Prioridad */}
                  <PriorityChips value={draft.prioridad} onChange={(p)=>setDraft(d=>({...d, prioridad:p }))} />

                  <textarea value={draft.texto} onChange={(e)=>setDraft(d=>({...d, texto:e.target.value }))} placeholder="Descripción" className="w-full min-h-[80px] rounded-2xl border p-3" />
                  {errorNew && <div className="text-sm text-red-600">{errorNew}</div>}
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelNew} className="h-9 px-3 rounded-2xl border">Cancelar</button>
                    <button onClick={saveNew} disabled={!canSaveNew} className="h-9 px-3 rounded-2xl border bg-blue-600 text-white border-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">Guardar</button>
                  </div>
                </div>
              )}

              <div className="border-t min-h-[120px] max-h-[50vh] overflow-y-auto overscroll-contain">
                <ul className="divide-y">
                  {/* Notas del día */}
                  {itemsToday.length===0 && carriedNotes.length===0 && (
                    <li className="px-4 py-6 text-sm text-gray-400">Sin notas. Pulsa “+ Nueva nota”.</li>
                  )}

                  {itemsToday.length>0 && itemsToday
                    .slice()
                    .sort((a,b)=> priorityWeight(getPriorityLabelNow(a, planByDate, planDatesSorted)) - priorityWeight(getPriorityLabelNow(b, planByDate, planDatesSorted)))
                    .map(it=>
                      <li key={it.id} className="px-4 py-3 space-y-2">
                        {editingId===it.id ? (
                          <div className="space-y-2">
                            <div className="flex gap-2 items-center">
                              {editDraft.mode === "lista" ? (
                                plannedOptions.length ? (
                                  <select value={editDraft.clienteId} onChange={(e)=>setEditDraft(d=>({...d, clienteId:e.target.value }))} className="h-9 rounded-2xl border px-3 flex-1">
                                    <option value="" disabled>Selecciona cliente del plan</option>
                                    {plannedOptions.map(o=> <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                ) : (
                                  <div className="text-sm text-gray-500">Sin plan para este día. Usa “Fuera de ruta”.</div>
                                )
                              ) : (
                                <input value={editDraft.cliente} onChange={(e)=>setEditDraft(d=>({...d, cliente:e.target.value }))} placeholder="Cliente (fuera de ruta)" className="h-9 rounded-2xl border px-3 flex-1" />
                              )}

                              <button
                                onClick={()=> setEditDraft(d=> ({...d, mode: d.mode==="lista"?"custom":"lista"}))}
                                className={"h-9 px-3 rounded-2xl border" + (plannedOptions.length===0 && editDraft.mode!=="custom"?" opacity-60 cursor-not-allowed":"")}
                                disabled={plannedOptions.length===0 && editDraft.mode!=="custom"}
                                title={editDraft.mode==="lista"?"Crear fuera de ruta":"Volver a lista"}
                              >
                                {editDraft.mode==="lista"?"Fuera de ruta":"Lista clientes"}
                              </button>
                            </div>

                            <PriorityChips value={editDraft.prioridad} onChange={(p)=>setEditDraft(d=>({...d, prioridad:p }))} />

                            <textarea value={editDraft.texto} onChange={(e)=>setEditDraft(d=>({...d, texto:e.target.value }))} placeholder="Descripción" className="w-full min-h-[80px] rounded-2xl border p-3" />
                            {errorEdit && <div className="text-sm text-red-600">{errorEdit}</div>}
                            <div className="flex justify-end gap-2">
                              <button onClick={cancelEdit} className="h-9 px-3 rounded-2xl border">Cancelar</button>
                              <button onClick={saveEdit} disabled={!canSaveEdit} className="h-9 px-3 rounded-2xl border bg-blue-600 text-white border-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">Guardar</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <input type="checkbox" onChange={()=>completeNote(currentKey, it.id)} className="mt-1.5" />
                            <div className="flex-1">
                              <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                                <span>{it.cliente || (it.clienteId?(`ID ${it.clienteId}`):"(Sin cliente)")}</span>
                                {it.fueraRuta && <span className="text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wide">Fuera de ruta</span>}
                                <PriorityBadge item={it} planByDate={planByDate} planDatesSorted={planDatesSorted} />
                              </div>
                              <div className="text-sm text-gray-600 whitespace-pre-wrap">{it.texto||"(Sin descripción)"}</div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={()=>startEdit(it, currentKey)} className="h-8 px-2 rounded-2xl border text-xs">✏️</button>
                              <button onClick={()=>deleteItem(currentKey, it.id)} className="h-8 px-2 rounded-2xl border text-xs">🗑️</button>
                            </div>
                          </div>
                        )}
                      </li>
                    )}

                  {/* Notas arrastradas desde días anteriores para clientes del plan */}
                  {carriedNotes.length>0 && carriedNotes
                    .slice()
                    .sort((a,b)=> priorityWeight(getPriorityLabelNow(a, planByDate, planDatesSorted)) - priorityWeight(getPriorityLabelNow(b, planByDate, planDatesSorted)))
                    .map(it=>
                      <li key={it.id+"@"+it.__origin} className="px-4 py-3 space-y-1 bg-[rgba(0,0,0,0.015)]">
                        <div className="flex items-start gap-3">
                          <input type="checkbox" onChange={()=>completeNote(it.__origin, it.id)} className="mt-1.5" />
                          <div className="flex-1">
                            <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                              <span>{it.cliente || (it.clienteId?(`ID ${it.clienteId}`):"(Sin cliente)")}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full border">De {formatShortDate(parseIso(it.anchorDate||it.__origin))}</span>
                              <PriorityBadge item={it} planByDate={planByDate} planDatesSorted={planDatesSorted} />
                            </div>
                            <div className="text-sm text-gray-600 whitespace-pre-wrap">{it.texto||"(Sin descripción)"}</div>
                          </div>
                        </div>
                      </li>
                    )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="h-6" />

      {/* Modal Importar JSON */}
      {showEditor === false && (
        <ImportModal
          open={showImport}
          onClose={()=>setShowImport(false)}
          onSaved={()=>{ window.location.reload(); }}
        />
      )}

      {/* Modal rápida desde Plan del día */}
      {quick.open && (
        <QuickNoteModal
          open={quick.open}
          clienteNombre={quick.clienteNombre}
          onCancel={cancelQuick}
          onSave={saveQuick}
        />
      )}
    </div>
  );
}

function PriorityChips({ value, onChange }){
  const opts = [
    {k:"hoy", label:"Hoy", cls:"bg-red-50 text-red-700 border-red-200"},
    {k:"esta_semana", label:"Esta semana", cls:"bg-orange-50 text-orange-700 border-orange-200"},
    {k:"la_semana_que_viene", label:"La semana que viene", cls:"bg-yellow-50 text-yellow-700 border-yellow-200"},
    {k:"proxima_visita", label:"Próxima visita", cls:"bg-indigo-50 text-indigo-700 border-indigo-200"},
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map(o=>
        <button key={o.k} onClick={()=>onChange(o.k)}
          className={["px-3 py-1.5 rounded-2xl border text-xs", o.cls, value===o.k?"ring-2 ring-offset-1":""].join(" ")}> {o.label} </button>
      )}
    </div>
  );
}

function PriorityBadge({ item, planByDate, planDatesSorted }){
  const meta = getPriorityMeta(item, planByDate, planDatesSorted);
  if (!meta) return null;
  const { label, cls, dueText } = meta;
  return <span className={["text-[10px] px-2 py-0.5 rounded-full border", cls].join(" ")}>{label}{dueText?` (${dueText})`:""}</span>;
}

function QuickNoteModal({ open, clienteNombre, onCancel, onSave }){
  const [texto, setTexto] = useState("");
  const [prioridad, setPrioridad] = useState("hoy");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-3">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold truncate">Nueva nota — {clienteNombre}</h3>
          <button onClick={onCancel} className="h-9 px-3 rounded-2xl border">Cerrar</button>
        </div>
        <div className="p-4 space-y-3">
          <PriorityChips value={prioridad} onChange={setPrioridad} />
          <textarea value={texto} onChange={(e)=>setTexto(e.target.value)} placeholder="Escribe la nota..." className="w-full min-h-[120px] rounded-2xl border p-3" />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCancel} className="h-9 px-3 rounded-2xl border">Cancelar</button>
            <button onClick={()=>onSave({texto, prioridad})} className="h-9 px-3 rounded-2xl border bg-blue-600 text-white border-blue-600">Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal independiente para importar JSON
function ImportModal({ open, onClose, onSaved }){
  const [clientsJsonText, setClientsJsonText] = useState("");
  const [planJsonText, setPlanJsonText] = useState("");
  const [error, setError] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-3">
      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold">Importar datos (pegar JSON)</h3>
          <button onClick={onClose} className="h-9 px-3 rounded-2xl border">Cerrar</button>
        </div>
        <div className="grid md:grid-cols-2 gap-4 p-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">clientes.json</label>
            <textarea value={clientsJsonText} onChange={(e)=>setClientsJsonText(e.target.value)} placeholder='[\n  {"id":"1030755","nombre":"BAR A MOTORA"}\n]' className="min-h-[180px] rounded-2xl border p-3 font-mono text-xs"></textarea>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">plan.json</label>
            <textarea value={planJsonText} onChange={(e)=>setPlanJsonText(e.target.value)} placeholder='[\n  {"fecha":"2025-09-29","clienteIds":["1030755","459565"]}\n]' className="min-h-[180px] rounded-2xl border p-3 font-mono text-xs"></textarea>
          </div>
        </div>
        {error && <div className="px-4 pb-2 text-sm text-red-600">{error}</div>}
        <div className="px-4 pb-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-2xl border">Cancelar</button>
          <button onClick={()=>{
            try{
              const rawClients = parseJsonSafe(clientsJsonText);
              const rawPlan = parseJsonSafe(planJsonText);
              if (!rawClients || !Array.isArray(rawClients)) throw new Error("clientes.json inválido");
              if (!rawPlan || !Array.isArray(rawPlan)) throw new Error("plan.json inválido");
              const normClients = normalizeClients(rawClients);
              const normPlan = normalizePlan(rawPlan);
              localStorage.setItem("agenda.version","8");
              localStorage.setItem("agenda.clientes", JSON.stringify(normClients));
              localStorage.setItem("agenda.plan", JSON.stringify(normPlan));
              onClose(); onSaved && onSaved();
            } catch(err){ setError(err && err.message || String(err)); }
          }} className="h-9 px-3 rounded-2xl border bg-blue-600 text-white border-blue-600">Validar y guardar</button>
        </div>
      </div>
    </div>
  );
}

// === Prioridad: helpers ===
function getPriorityMeta(item, planByDate, planDatesSorted){
  const label = getPriorityLabelNow(item, planByDate, planDatesSorted);
  const clsMap = {
    "Hoy": "bg-red-50 text-red-700 border-red-200",
    "Esta semana": "bg-orange-50 text-orange-700 border-orange-200",
    "La semana que viene": "bg-yellow-50 text-yellow-700 border-yellow-200",
    "Próxima visita": "bg-indigo-50 text-indigo-700 border-indigo-200",
  };
  const meta = { label, cls: clsMap[label]||"border-gray-200 text-gray-600" };
  if (label==="Próxima visita"){
    const due = nextVisitDate(item.clienteId, item.anchorDate||ymd(new Date()), planByDate, planDatesSorted);
    meta.dueText = due ? formatShortDate(new Date(due)) : undefined;
  }
  return meta;
}

function getPriorityLabelNow(item, planByDate, planDatesSorted){
  const now = stripTime(new Date());
  const anchorIso = item.anchorDate || ymd(now);
  const anchor = parseIso(anchorIso);
  const p = item.prioridad || "hoy";
  if (p === "hoy"){
    return "Hoy";
  }
  if (p === "esta_semana"){
    if (isSameWeek(now, anchor)){
      return isSameIso(ymd(now), anchorIso) ? "Hoy" : "Esta semana";
    }
    return "Esta semana";
  }
  if (p === "la_semana_que_viene"){
    const target = addDays(anchor, 7);
    if (isSameWeek(now, target)){
      return isSameIso(ymd(now), ymd(target)) ? "Hoy" : "Esta semana";
    }
    return now < target ? "La semana que viene" : "Esta semana";
  }
  if (p === "proxima_visita"){
    const next = nextVisitDate(item.clienteId, anchorIso, planByDate, planDatesSorted);
    if (!next) return "Próxima visita";
    const nextDate = parseIso(next);
    if (isSameIso(ymd(now), next)) return "Hoy";
    if (isSameWeek(now, nextDate)) return "Esta semana";
    return "Próxima visita";
  }
  return "";
}

function priorityWeight(label){
  // Menor = más urgente
  return label==="Hoy"?0 : label==="Esta semana"?1 : label==="La semana que viene"?2 : 3;
}

function nextVisitDate(clienteId, afterIso, planByDate, planDatesSorted){
  if (!clienteId) return null;
  for (const iso of planDatesSorted){
    if (iso > afterIso){
      const ids = planByDate[iso]||[];
      if (ids.includes(clienteId)) return iso;
    }
  }
  return null;
}

// === Helpers & datos ===
function weekdayLabels(locale="es-ES", weekStartsOn=1){ const base=["L","M","X","J","V","S","D"]; if(weekStartsOn===1) return base; const i=weekStartsOn%7; return base.slice(i).concat(base.slice(0,i)); }
function buildMonthMatrix(year, month, weekStartsOn=1){ const first=new Date(year,month,1); const off=mod(first.getDay()-weekStartsOn,7); const start=stripTime(new Date(year,month,1-off)); const weeks=[]; let cur=new Date(start); for(let w=0;w<6;w++){ const row=[]; for(let d=0;d<7;d++){ row.push(new Date(cur)); cur.setDate(cur.getDate()+1);} weeks.push(row);} return weeks; }
function buildWeekRow(anchor, weekStartsOn=1){ const s=startOfWeek(anchor,weekStartsOn); const arr=[]; for(let i=0;i<7;i++){ const d=new Date(s); d.setDate(s.getDate()+i); arr.push(d);} return arr; }
function startOfWeek(date, weekStartsOn=1){ const d=stripTime(date); const diff=mod(d.getDay()-weekStartsOn,7); d.setDate(d.getDate()-diff); return d; }
function endOfWeek(date, weekStartsOn=1){ const s=startOfWeek(date,weekStartsOn); const e=new Date(s); e.setDate(s.getDate()+6); return e; }
function isSameWeek(a,b){ const sa=startOfWeek(a,1).getTime(); const sb=startOfWeek(b,1).getTime(); return sa===sb; }
function isWeekend(d){ const g=d.getDay(); return g===0 || g===6; }
function skipWeekends(d){ let nd=stripTime(d); while(isWeekend(nd)){ nd=addDays(nd, (nd.getDay()===6?2:-1)); } return nd; }
function stripTime(d){ const nd=new Date(d); nd.setHours(0,0,0,0); return nd; }
function addDays(d,n){ const nd=new Date(d); nd.setDate(nd.getDate()+n); return stripTime(nd); }
function addMonths(d,n){ const nd=new Date(d); nd.setMonth(nd.getMonth()+n,1); return stripTime(nd); }
function mod(n,m){ return ((n%m)+m)%m; }
function ymd(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
function parseIso(s){ const [Y,M,D]=s.split('-').map(n=>parseInt(n,10)); return new Date(Y, M-1, D); }
function isSameIso(aIso, bIso){ return aIso===bIso; }
function monthName(date, locale="es-ES", variant="long"){ return new Intl.DateTimeFormat(locale,{month:variant}).format(date); }
function formatMonthYear(date, locale="es-ES"){ return `${capitalize(monthName(date,locale,"long"))} ${date.getFullYear()}`; }
function formatWeekRange(s,e,locale="es-ES"){ const sameM=s.getMonth()===e.getMonth(); const sameY=s.getFullYear()===e.getFullYear(); const sd=s.getDate(), ed=e.getDate(); const sm=monthName(s,locale,"short"), em=monthName(e,locale,"short"); if(sameM) return `${sd}–${ed} ${sm} ${s.getFullYear()}`; if(sameY) return `${sd} ${sm} – ${ed} ${em} ${s.getFullYear()}`; return `${sd} ${sm} ${s.getFullYear()} – ${ed} ${em} ${e.getFullYear()}`; }
function formatDay(date, locale="es-ES"){ const wd=new Intl.DateTimeFormat(locale,{weekday:"short"}).format(date); const m=monthName(date,locale,"long"); return `${wd} ${String(date.getDate()).padStart(2,"0")} ${m} ${date.getFullYear()}`; }
function formatDayNoWeekday(date, locale="es-ES"){ const m=monthName(date,locale,"long"); return `${String(date.getDate()).padStart(2,"0")} ${m} ${date.getFullYear()}`; }
function formatShortDate(date){ return new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'2-digit',month:'short'}).format(date); }
function capitalize(s){ return s? s.charAt(0).toUpperCase()+s.slice(1):s; }

function readClientsFromLocalStorage(){ try{ if(typeof window==="undefined") return {clientNames:[],clientsById:{}}; const s=localStorage.getItem("agenda.clientes"); if(!s) return {clientNames:[],clientsById:{}}; const arr=JSON.parse(s); if(!Array.isArray(arr)) return {clientNames:[],clientsById:{}}; const names=[]; const byId={}; const seen=new Set(); for(const it of arr){ if(!it||typeof it.id!=="string"||typeof it.nombre!=="string") continue; byId[it.id]={id:it.id,nombre:it.nombre}; if(!seen.has(it.nombre)){ names.push(it.nombre); seen.add(it.nombre);} } return {clientNames:names, clientsById:byId}; } catch(_){ return {clientNames:[],clientsById:{}}; } }
function readPlanByDateFromLocalStorage(){ const out={}; try{ if(typeof window==="undefined") return out; const s=localStorage.getItem("agenda.plan"); if(!s) return out; const arr=JSON.parse(s); if(!Array.isArray(arr)) return out; for(const it of arr){ if(!it||typeof it.fecha!=="string"||!Array.isArray(it.clienteIds)) continue; const uniq=[]; const seen=new Set(); for(const c of it.clienteIds){ const id=String(c); if(!id||seen.has(id)) continue; seen.add(id); uniq.push(id);} out[it.fecha]=uniq; } } catch(_){ } return out; }

function expandPlan(planByDate, {months=3, stepDays=28}={}){
  // Genera ~3 meses hacia delante con ciclo 28 días.
  const out = JSON.parse(JSON.stringify(planByDate||{}));
  const todayIso = ymd(new Date());
  const horizon = ymd(addDays(parseIso(todayIso), months*31));
  const baseDates = Object.keys(planByDate||{}).sort();
  for (const iso of baseDates){
    const base = parseIso(iso);
    let k=1;
    while(true){
      const nd = addDays(base, stepDays*k);
      const ndIso = ymd(nd);
      if (ndIso>horizon) break;
      const src = planByDate[iso]||[];
      out[ndIso] = uniqArr((out[ndIso]||[]).concat(src));
      k++;
    }
  }
  return out;
}

function uniqArr(arr){ const s=new Set(); const out=[]; for(const x of arr){ if(s.has(x)) continue; s.add(x); out.push(x);} return out; }

function parseJsonSafe(txt){ try{return JSON.parse(txt);}catch{ return null; } }
function isIsoDate(s){ return typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function normalizeClients(arr){ if(!Array.isArray(arr)) throw new Error("clientes.json debe ser un array"); const out=[]; const seen=new Set(); for(const it of arr){ if(!it||typeof it.id!=="string"||typeof it.nombre!=="string") throw new Error("clientes.json: cada elemento necesita id y nombre (strings)"); const id=it.id.trim(), nombre=it.nombre.trim(); if(!id||!nombre) throw new Error("clientes.json: id/nombre vacío"); if(seen.has(id)) continue; seen.add(id); out.push({id,nombre}); } return out; }
function normalizePlan(arr){ if(!Array.isArray(arr)) throw new Error("plan.json debe ser un array"); const out=[]; for(const it of arr){ if(!it||!isIsoDate(it.fecha)||!Array.isArray(it.clienteIds)) throw new Error("plan.json: requiere fecha YYYY-MM-DD y clienteIds (array)"); const fecha=it.fecha; const clienteIds=it.clienteIds.map(c=>String(c)).filter(Boolean); out.push({fecha, clienteIds}); } return out; }

// util: clave única para deduplicar por cliente en un día
function uniqueKey(clienteId, clienteName){ return clienteId? `id:${clienteId}` : `name:${(clienteName||"").trim().toLowerCase()}`; }
function uniqBy(arr, getKey){ const seen=new Set(); const out=[]; for(const x of arr){ const k=getKey(x); if(seen.has(k)) continue; seen.add(k); out.push(x);} return out; }

// Tests simples (no cambiar)
if (!window.__agendaTestsRan){
  try{
    const mm=buildMonthMatrix(2025,8,1); console.assert(mm.length===6 && mm.every(r=>r.length===7), 'Mes 6x7');
    const s=startOfWeek(new Date(2025,8,26),1), e=endOfWeek(new Date(2025,8,26),1); console.assert(s.getDay()===1 && (e-s)/86400000===6,'Semana lun-dom');
    console.assert(formatShortDate(new Date(2025,8,26)).length>0,'formatShortDate');
    const ep=expandPlan({"2025-09-29":["1","2"]},{months:1,stepDays:28}); console.assert(Object.keys(ep).length>=2,'expandPlan');
    console.assert(isIsoDate('2025-09-27') && !isIsoDate('27-09-2025'), 'isIsoDate formato');
    // tests extra
    console.assert(isWeekend(new Date(2025,8,27))===true && isWeekend(new Date(2025,8,29))===false, 'isWeekend');
    const sk = skipWeekends(new Date(2025,8,28)); console.assert(sk.getDay()===1 || sk.getDay()===5, 'skipWeekends avanza/salta');
    window.__agendaTestsRan=true;
  }catch(err){ console.warn('Tests fallaron', err); }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
