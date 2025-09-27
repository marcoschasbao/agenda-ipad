const { useState, useMemo, useRef } = React;

// === Agenda iPad — reglas nuevas ===
// - Selector de clientes (modo lista) SOLO muestra clientes del plan del día.
// - Día sin plan: editor abre en "Fuera de ruta" (sin selector).
// - Edición: si la nota tiene cliente fuera del plan, el selector lo incluye temporalmente.
// - Unicidad: SOLO 1 nota por cliente y día (por id; si no hay id, por nombre en minúsculas).

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

  // borrador NUEVA nota
  const [draft, setDraft] = useState({ mode: "lista", clienteId: "", cliente: "", texto: "" });
  // borrador EDICIÓN
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ mode: "lista", clienteId: "", cliente: "", texto: "" });

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
  const { clientNames, clientsById } = useMemo(() => readClientsFromLocalStorage(), []);
  const planByDate = useMemo(() => readPlanByDateFromLocalStorage(), []);

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
  const items = itemsByDate[currentKey] || [];
  const plannedIdsForDay = planByDate[currentKey] || [];

  // Lista notas de la semana (orden por cercanía)
  const notesOfWeek = useMemo(()=>{
    const all=[]; const ref=viewDate;
    for (const d of weekRow){ const k=ymd(d); const arr=itemsByDate[k]||[]; for (const it of arr) all.push({...it, date:d}); }
    all.sort((a,b)=>{ const da=(stripTime(a.date)-ref)/86400000, db=(stripTime(b.date)-ref)/86400000; const ad=Math.abs(da), bd=Math.abs(db); if(ad!==bd) return ad-bd; if(da!==db) return da-db; return 0;});
    return all;
  }, [itemsByDate, weekRow, viewDate]);

  // Helpers selector día
  const plannedOptions = useMemo(()=>{
    const opts = plannedIdsForDay.map(id => ({ value:id, label: clientsById[id]?.nombre || `ID ${id}` }));
    // Si estamos editando y el cliente no está en plan, lo incluimos arriba
    if (editingId){
      const cur = (items.find(x=>x.id===editingId)) || null;
      const curId = cur?.clienteId || null;
      const curLabel = cur ? (cur.cliente || clientsById[cur.clienteId]?.nombre || (cur.clienteId?`ID ${cur.clienteId}`:"")) : "";
      if (curId && !opts.some(o=>o.value===curId)) opts.unshift({ value: curId, label: curLabel });
      if (!curId && curLabel && !opts.some(o=>o.label===curLabel)) opts.unshift({ value: `__legacy__:${curLabel}`, label: curLabel });
    }
    return uniqBy(opts, o=>o.value);
  }, [plannedIdsForDay, clientsById, editingId, items]);

  // Gestos día
  const tX = useRef(0), tY = useRef(0);
  const onTouchStart = (e)=>{ if(!e.touches?.length) return; tX.current=e.touches[0].clientX; tY.current=e.touches[0].clientY; };
  const onTouchEnd = (e)=>{ if(!e.changedTouches?.length) return; const dx=e.changedTouches[0].clientX-tX.current; const dy=e.changedTouches[0].clientY-tY.current; if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*1.3){ const nd=addDays(viewDate, dx<0?1:-1); setViewDate(nd); setSelectedDate(nd);} };

  // Navegación
  const goPrev = ()=>{ if(currentView==="month") setViewDate(addMonths(viewDate,-1)); else if(currentView==="week") setViewDate(addDays(viewDate,-7)); else { const nd=addDays(viewDate,-1); setViewDate(nd); setSelectedDate(nd);} };
  const goNext = ()=>{ if(currentView==="month") setViewDate(addMonths(viewDate,1)); else if(currentView==="week") setViewDate(addDays(viewDate,7)); else { const nd=addDays(viewDate,1); setViewDate(nd); setSelectedDate(nd);} };
  const goToday = ()=>{ setViewDate(today); setSelectedDate(today); };
  const onPick = (day)=>{ setSelectedDate(day); setViewDate(day); if(currentView!=="day") setCurrentView("day"); };

  // CRUD notas
  const addItemFor = (key, item)=> setItemsByDate(prev=>({ ...prev, [key]: [ ...(prev[key]||[]), item ] }));
  const replaceItemsFor = (key, mapper)=> setItemsByDate(prev=>({ ...prev, [key]: (prev[key]||[]).map(mapper) }));
  const removeItemFor = (key, id)=> setItemsByDate(prev=>({ ...prev, [key]: (prev[key]||[]).filter(x=>x.id!==id) }));

  // Unicidad por cliente/día (id o nombre si no hay id)
  const hasDuplicateForDay = (key, clienteId, clienteName, ignoreId=null)=>{
    const norm = uniqueKey(clienteId, clienteName);
    const arr = itemsByDate[key]||[];
    return arr.some(x=> x.id!==ignoreId && uniqueKey(x.clienteId, x.cliente)===norm);
  };

  // Abrir nuevo: si no hay plan, forzamos "fuera de ruta"
  const openNew = ()=>{
    setErrorNew("");
    if ((planByDate[currentKey]||[]).length===0) {
      setDraft({ mode:"custom", clienteId:"", cliente:"", texto:"" });
    } else {
      setDraft({ mode:"lista", clienteId:"", cliente:"", texto:"" });
    }
    setShowEditor(true);
  };
  const cancelNew = ()=>{ setShowEditor(false); setErrorNew(""); };
  const saveNew = ()=>{
    setErrorNew("");
    const key = currentKey;
    if (draft.mode==="lista"){
      if (!draft.clienteId){ setErrorNew("Selecciona un cliente del plan o usa ‘Fuera de ruta’."); return; }
      if (hasDuplicateForDay(key, draft.clienteId, clientsById[draft.clienteId]?.nombre||"")) { setErrorNew("Ya existe una nota para ese cliente hoy."); return; }
      const id = String(idSeq.current++);
      const nombre = clientsById[draft.clienteId]?.nombre || `ID ${draft.clienteId}`;
      addItemFor(key, { id, clienteId: draft.clienteId, cliente: nombre, texto: draft.texto, fueraRuta: false });
    } else {
      const nombre = (draft.cliente||"").trim();
      if (!nombre){ setErrorNew("Indica un cliente (fuera de ruta) o cambia a lista."); return; }
      if (hasDuplicateForDay(key, null, nombre)) { setErrorNew("Ya existe una nota para ese cliente hoy."); return; }
      const id = String(idSeq.current++);
      addItemFor(key, { id, clienteId: null, cliente: nombre, texto: draft.texto, fueraRuta: true });
    }
    setShowEditor(false);
  };

  const startEdit = (it)=>{
    setErrorEdit("");
    setEditingId(it.id);
    setEditDraft({ mode: it.fueraRuta?"custom":"lista", clienteId: it.clienteId||"", cliente: it.cliente||"", texto: it.texto||"" });
  };
  const cancelEdit = ()=>{ setEditingId(null); setErrorEdit(""); };
  const saveEdit = ()=>{
    setErrorEdit("");
    const key = currentKey;
    if (editDraft.mode==="lista"){
      if (!editDraft.clienteId){ setErrorEdit("Selecciona un cliente del plan o usa ‘Fuera de ruta’."); return; }
      if (hasDuplicateForDay(key, editDraft.clienteId, clientsById[editDraft.clienteId]?.nombre||"", editingId)) { setErrorEdit("Ya existe una nota para ese cliente hoy."); return; }
      replaceItemsFor(key, (x)=> x.id!==editingId ? x : {
        ...x,
        clienteId: editDraft.clienteId,
        cliente: clientsById[editDraft.clienteId]?.nombre || `ID ${editDraft.clienteId}`,
        texto: editDraft.texto,
        fueraRuta: false,
      });
    } else {
      const nombre = (editDraft.cliente||"").trim();
      if (!nombre){ setErrorEdit("Indica un cliente (fuera de ruta) o cambia a lista."); return; }
      if (hasDuplicateForDay(key, null, nombre, editingId)) { setErrorEdit("Ya existe una nota para ese cliente hoy."); return; }
      replaceItemsFor(key, (x)=> x.id!==editingId ? x : {
        ...x,
        clienteId: null,
        cliente: nombre,
        texto: editDraft.texto,
        fueraRuta: true,
      });
    }
    setEditingId(null);
  };
  const deleteItem = (id)=> removeItemFor(currentKey, id);

  const isSameDay = (a,b)=> !!a && !!b && ymd(a)===ymd(b);

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
                  return (
                    <button key={ymd(day)} onClick={()=>onPick(day)}
                      className={["aspect-square w-full rounded-2xl border text-sm sm:text-base flex items-center justify-center select-none","transition-transform active:scale-[0.98]", inCurrent?"bg-white":"bg-gray-50 text-gray-300", isSelected?"bg-blue-600 text-white border-blue-600":"", (!isSelected&&isToday)?"ring-2 ring-blue-500":"", "hover:bg-gray-50"].join(" ")}
                      aria-pressed={isSelected} aria-current={isToday?"date":undefined}
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
          <>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {weekRow.map(day=>{
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selectedDate);
                return (
                  <button key={ymd(day)} onClick={()=>onPick(day)}
                    className={["aspect-square w-full rounded-2xl border text-base flex items-center justify-center select-none","transition-transform active:scale-[0.98]","bg-white", isSelected?"bg-blue-600 text-white border-blue-600":"", (!isSelected&&isToday)?"ring-2 ring-blue-500":"", "hover:bg-gray-50"].join(" ")}
                    aria-pressed={isSelected} aria-current={isToday?"date":undefined}>
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
                        <div className="font-medium">
                          {it.cliente|| (it.clienteId?(`ID ${it.clienteId}`):"(Sin cliente)")}
                          {it.fueraRuta && <span className="text-[10px] px-1.5 py-0.5 rounded-full border ml-1">Fuera de ruta</span>}
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
          </>
        )}

        {/* DÍA */}
        {currentView==="day" && (
          <div className="space-y-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="px-4 py-4 rounded-2xl border flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-blue-600 text-white grid place-items-center text-lg font-bold">{viewDate.getDate()}</div>
              <div className="flex flex-col">
                <span className="text-sm text-gray-500 font-medium">{new Intl.DateTimeFormat(locale,{weekday:"long"}).format(viewDate)}</span>
                <span className="text-base font-semibold">{formatDayNoWeekday(viewDate, locale)}</span>
              </div>
            </div>

            {/* Plan del día */}
            <div className="rounded-2xl border overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Plan del día</h2>
                <span className="text-xs text-gray-500">{plannedIdsForDay.length} clientes</span>
              </div>
              <ul className="border-t divide-y">
                {plannedIdsForDay.length ? (
                  plannedIdsForDay.map(id=> <li key={id} className="px-4 py-2 text-sm">{(clientsById[id]||{}).nombre || `ID ${id}`}</li>)
                ) : (
                  <li className="px-4 py-3 text-sm text-gray-400">Sin plan para este día.</li>
                )}
              </ul>
            </div>

            {/* Notas */}
            <div className="rounded-2xl border overflow-hidden flex flex-col">
              <div className="px-4 py-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Notas</h2>
                <button onClick={openNew} className="h-9 px-3 rounded-2xl border font-medium hover:bg-gray-50">+ Nueva nota</button>
              </div>

              {showEditor && (
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
                  {items.length ? (
                    items.map(it=>
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

                            <textarea value={editDraft.texto} onChange={(e)=>setEditDraft(d=>({...d, texto:e.target.value }))} placeholder="Descripción" className="w-full min-h-[80px] rounded-2xl border p-3" />
                            {errorEdit && <div className="text-sm text-red-600">{errorEdit}</div>}
                            <div className="flex justify-end gap-2">
                              <button onClick={cancelEdit} className="h-9 px-3 rounded-2xl border">Cancelar</button>
                              <button onClick={saveEdit} disabled={!canSaveEdit} className="h-9 px-3 rounded-2xl border bg-blue-600 text-white border-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">Guardar</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="shrink-0 h-2.5 w-2.5 rounded-full bg-blue-600 mt-2" />
                            <div className="flex-1">
                              <div className="text-sm font-medium flex items-center gap-2">
                                <span>{it.cliente || (it.clienteId?(`ID ${it.clienteId}`):"(Sin cliente)")}</span>
                                {it.fueraRuta && <span className="text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wide">Fuera de ruta</span>}
                              </div>
                              <div className="text-sm text-gray-600 whitespace-pre-wrap">{it.texto||"(Sin descripción)"}</div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={()=>startEdit(it)} className="h-8 px-2 rounded-2xl border text-xs">✏️</button>
                              <button onClick={()=>deleteItem(it.id)} className="h-8 px-2 rounded-2xl border text-xs">🗑️</button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  ) : (
                    <li className="px-4 py-6 text-sm text-gray-400">Sin notas. Pulsa “+ Nueva nota”.</li>
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
          onSaved={()=>{ /* refrescar selectores si cambia localStorage */ window.location.reload(); }}
        />
      )}
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
              localStorage.setItem("agenda.version","2");
              localStorage.setItem("agenda.clientes", JSON.stringify(normClients));
              localStorage.setItem("agenda.plan", JSON.stringify(normPlan));
              onClose(); onSaved && onSaved();
            } catch(err){ setError(err?.message || String(err)); }
          }} className="h-9 px-3 rounded-2xl border bg-blue-600 text-white border-blue-600">Validar y guardar</button>
        </div>
      </div>
    </div>
  );
}

// === Helpers & datos ===
function weekdayLabels(locale="es-ES", weekStartsOn=1){ const base=["L","M","X","J","V","S","D"]; if(weekStartsOn===1) return base; const i=weekStartsOn%7; return base.slice(i).concat(base.slice(0,i)); }
function buildMonthMatrix(year, month, weekStartsOn=1){ const first=new Date(year,month,1); const off=mod(first.getDay()-weekStartsOn,7); const start=stripTime(new Date(year,month,1-off)); const weeks=[]; let cur=new Date(start); for(let w=0;w<6;w++){ const row=[]; for(let d=0;d<7;d++){ row.push(new Date(cur)); cur.setDate(cur.getDate()+1);} weeks.push(row);} return weeks; }
function buildWeekRow(anchor, weekStartsOn=1){ const s=startOfWeek(anchor,weekStartsOn); const arr=[]; for(let i=0;i<7;i++){ const d=new Date(s); d.setDate(s.getDate()+i); arr.push(d);} return arr; }
function startOfWeek(date, weekStartsOn=1){ const d=stripTime(date); const diff=mod(d.getDay()-weekStartsOn,7); d.setDate(d.getDate()-diff); return d; }
function endOfWeek(date, weekStartsOn=1){ const s=startOfWeek(date,weekStartsOn); const e=new Date(s); e.setDate(s.getDate()+6); return e; }
function stripTime(d){ const nd=new Date(d); nd.setHours(0,0,0,0); return nd; }
function addDays(d,n){ const nd=new Date(d); nd.setDate(nd.getDate()+n); return stripTime(nd); }
function addMonths(d,n){ const nd=new Date(d); nd.setMonth(nd.getMonth()+n,1); return stripTime(nd); }
function mod(n,m){ return ((n%m)+m)%m; }
function ymd(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
function monthName(date, locale="es-ES", variant="long"){ return new Intl.DateTimeFormat(locale,{month:variant}).format(date); }
function formatMonthYear(date, locale="es-ES"){ return `${capitalize(monthName(date,locale,"long"))} ${date.getFullYear()}`; }
function formatWeekRange(s,e,locale="es-ES"){ const sameM=s.getMonth()===e.getMonth(); const sameY=s.getFullYear()===e.getFullYear(); const sd=s.getDate(), ed=e.getDate(); const sm=monthName(s,locale,"short"), em=monthName(e,locale,"short"); if(sameM) return `${sd}–${ed} ${sm} ${s.getFullYear()}`; if(sameY) return `${sd} ${sm} – ${ed} ${em} ${s.getFullYear()}`; return `${sd} ${sm} ${s.getFullYear()} – ${ed} ${em} ${e.getFullYear()}`; }
function formatDay(date, locale="es-ES"){ const wd=new Intl.DateTimeFormat(locale,{weekday:"short"}).format(date); const m=monthName(date,locale,"long"); return `${wd} ${String(date.getDate()).padStart(2,"0")} ${m} ${date.getFullYear()}`; }
function formatDayNoWeekday(date, locale="es-ES"){ const m=monthName(date,locale,"long"); return `${String(date.getDate()).padStart(2,"0")} ${m} ${date.getFullYear()}`; }
function formatShortDate(date){ return new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'2-digit',month:'short'}).format(date); }
function capitalize(s){ return s? s.charAt(0).toUpperCase()+s.slice(1):s; }

function defaultClients(){ return ["Bar Cafetería Sol","Restaurante Mar","Pub Atlántico","La Terraza","Hotel Ría"]; }
function readClientsFromLocalStorage(){ try{ if(typeof window==="undefined") return {clientNames:[],clientsById:{}}; const s=localStorage.getItem("agenda.clientes"); if(!s) return {clientNames:[],clientsById:{}}; const arr=JSON.parse(s); if(!Array.isArray(arr)) return {clientNames:[],clientsById:{}}; const names=[]; const byId={}; const seen=new Set(); for(const it of arr){ if(!it||typeof it.id!=="string"||typeof it.nombre!=="string") continue; byId[it.id]={id:it.id,nombre:it.nombre}; if(!seen.has(it.nombre)){ names.push(it.nombre); seen.add(it.nombre);} } return {clientNames:names, clientsById:byId}; } catch(_){ return {clientNames:[],clientsById:{}}; } }
function readPlanByDateFromLocalStorage(){ const out={}; try{ if(typeof window==="undefined") return out; const s=localStorage.getItem("agenda.plan"); if(!s) return out; const arr=JSON.parse(s); if(!Array.isArray(arr)) return out; for(const it of arr){ if(!it||typeof it.fecha!=="string"||!Array.isArray(it.clienteIds)) continue; const uniq=[]; const seen=new Set(); for(const c of it.clienteIds){ const id=String(c); if(!id||seen.has(id)) continue; seen.add(id); uniq.push(id);} out[it.fecha]=uniq; } } catch(_){ } return out; }

function parseJsonSafe(txt){ try{return JSON.parse(txt);}catch{ return null; } }
function isIsoDate(s){ return typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function normalizeClients(arr){ if(!Array.isArray(arr)) throw new Error("clientes.json debe ser un array"); const out=[]; const seen=new Set(); for(const it of arr){ if(!it||typeof it.id!=="string"||typeof it.nombre!=="string") throw new Error("clientes.json: cada elemento necesita id y nombre (strings)"); const id=it.id.trim(), nombre=it.nombre.trim(); if(!id||!nombre) throw new Error("clientes.json: id/nombre vacío"); if(seen.has(id)) continue; seen.add(id); out.push({id,nombre}); } return out; }
function normalizePlan(arr){ if(!Array.isArray(arr)) throw new Error("plan.json debe ser un array"); const out=[]; for(const it of arr){ if(!it||!isIsoDate(it.fecha)||!Array.isArray(it.clienteIds)) throw new Error("plan.json: requiere fecha YYYY-MM-DD y clienteIds (array)"); const fecha=it.fecha; const clienteIds=it.clienteIds.map(c=>String(c)).filter(Boolean); out.push({fecha, clienteIds}); } return out; }

// util: clave única para deduplicar por cliente en un día
function uniqueKey(clienteId, clienteName){ return clienteId? `id:${clienteId}` : `name:${(clienteName||"").trim().toLowerCase()}`; }
function uniqBy(arr, getKey){ const seen=new Set(); const out=[]; for(const x of arr){ const k=getKey(x); if(seen.has(k)) continue; seen.add(k); out.push(x);} return out; }

// Tests simples
if (!window.__agendaTestsRan){
  try{
    const mm=buildMonthMatrix(2025,8,1); console.assert(mm.length===6 && mm.every(r=>r.length===7), 'Mes 6x7');
    const s=startOfWeek(new Date(2025,8,26),1), e=endOfWeek(new Date(2025,8,26),1); console.assert(s.getDay()===1 && (e-s)/86400000===6,'Semana lun-dom');
    console.assert(formatShortDate(new Date(2025,8,26)).length>0,'formatShortDate');
    console.assert(Array.isArray(defaultClients())&&defaultClients().length>=5,'defaultClients');
    const u=uniqBy([{v:1},{v:1},{v:2}], x=>x.v); console.assert(u.length===2,'uniqBy');
    console.assert(uniqueKey('123','X')!==uniqueKey(null,'x'),'uniqueKey id vs name');
    console.assert(isIsoDate('2025-09-27') && !isIsoDate('27-09-2025'), 'isIsoDate formato');
    window.__agendaTestsRan=true;
  }catch(err){ console.warn('Tests fallaron', err); }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
