/* global React, ReactDOM */
'use strict';

// ===== Utilidades de fecha =====
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseISO = (iso) => new Date(`${iso}T00:00:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const isWeekend = (d) => [0,6].includes(d.getDay()); // 0=Dom, 6=Sáb
const startOfWeekMon = (d) => { const x = new Date(d); const day = x.getDay(); const diff = (day===0? -6 : 1 - day); return addDays(x, diff); };
const endOfWeekMon = (d) => addDays(startOfWeekMon(d), 6);
const inSameISOWeek = (a,b) => sameDay(startOfWeekMon(a), startOfWeekMon(b));
const nextWeek = (d) => addDays(d, 7);
const prevWeek = (d) => addDays(d, -7);

// ===== Beep (WebAudio) =====
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    o.stop(ctx.currentTime + 0.08);
  } catch(e) { /* silencio si no disponible */ }
}

// ===== LocalStorage claves =====
const LS_CLIENTES = 'agenda.clientes';
const LS_PLAN     = 'agenda.plan';

// ===== Carga/normalización =====
function loadClientes() {
  try { return JSON.parse(localStorage.getItem(LS_CLIENTES) || '[]'); } catch { return []; }
}
function loadPlan() {
  try { return JSON.parse(localStorage.getItem(LS_PLAN) || '[]'); } catch { return []; }
}
function normalizeClientes(arr) {
  return (Array.isArray(arr)? arr : []).map(c => ({ id: String(c.id), nombre: String(c.nombre||'') }));
}
function normalizePlan(arr) {
  return (Array.isArray(arr)? arr : []).map(p => ({
    fecha: String(p.fecha),
    clienteIds: Array.isArray(p.clienteIds) ? p.clienteIds.map(String) : []
  }));
}

// ===== Expansión (28 días) en memoria (~3 meses) =====
function expandPlan28(planBase, months=3) {
  if (!Array.isArray(planBase)) return [];
  const today = new Date();
  const maxDate = addDays(today, Math.round(months*30));
  const out = [];
  for (const item of planBase) {
    const d0 = parseISO(item.fecha);
    let k = 0;
    while (true) {
      const d = addDays(d0, 28*k);
      if (d > maxDate) break;
      out.push({ fecha: toKey(d), clienteIds: item.clienteIds.slice() });
      k++;
    }
  }
  return out;
}

// ===== Índices útiles =====
function planByDate(plan) {
  const map = new Map();
  for (const p of plan) {
    const arr = map.get(p.fecha) || [];
    map.set(p.fecha, arr.concat(p.clienteIds));
  }
  return map;
}
function clientesById(clientes) {
  const map = new Map();
  for (const c of clientes) map.set(c.id, c);
  return map;
}
function nextVisitDateForClient(clientId, planMap, fromDate) {
  // Busca la primera fecha >= fromDate con ese cliente
  const searchHorizon = 200; // días
  for (let i=0;i<=searchHorizon;i++){
    const d = addDays(fromDate, i);
    const ids = planMap.get(toKey(d)) || [];
    if (ids.includes(clientId)) return d;
  }
  return null;
}

// ===== Etiqueta dinámica (prioridad visual) =====
function etiquetaDinamica(clientId, planMap, refDate) {
  const target = nextVisitDateForClient(clientId, planMap, refDate);
  if (!target) return 'Próxima visita';
  if (sameDay(target, refDate)) return 'Hoy';
  if (inSameISOWeek(target, refDate)) return 'Esta semana';
  if (inSameISOWeek(target, nextWeek(refDate))) return 'La semana que viene';
  return 'Próxima visita';
}
const chipStyle = (tag) => {
  // sin colores fijos; solo clases Tailwind bases
  const base = 'chip border';
  switch (tag) {
    case 'Hoy': return `${base} border-iosBlue text-iosBlue`;
    case 'Esta semana': return `${base} border-blue-400 text-blue-500`;
    case 'La semana que viene': return `${base} border-cyan-400 text-cyan-600`;
    default: return `${base} border-gray-300 text-gray-600`;
  }
};

// ===== App =====
function App(){
  const [clientes, setClientes] = React.useState(() => normalizeClientes(loadClientes()));
  const [planBase, setPlanBase] = React.useState(() => normalizePlan(loadPlan()));
  const [planMem, setPlanMem] = React.useState(() => expandPlan28(normalizePlan(loadPlan()), 3));
  const [view, setView] = React.useState('mes'); // 'mes' | 'semana' | 'dia'
  const [selected, setSelected] = React.useState(() => new Date());
  const [importOpen, setImportOpen] = React.useState(false);
  const [modalNota, setModalNota] = React.useState(null); // { tipo:'cliente'|'fuera', clienteId?, clienteNombre?, fecha? , texto? }
  // Notas:
  // - Por cliente (activa, arrastrada): Map clientId -> { clientId, texto, completed:false }
  // - Fuera de ruta: array { id, fechaKey, clienteNombre, texto, completed:false }
  const [notasCliente, setNotasCliente] = React.useState(new Map());
  const [notasFuera, setNotasFuera] = React.useState([]);

  const planMap = React.useMemo(() => planByDate(planMem), [planMem]);
  const cliMap  = React.useMemo(() => clientesById(clientes), [clientes]);

  // ---- helpers UI ----
  const goToday = () => setSelected(new Date());
  const goPrevMonth = () => { const d=new Date(selected); d.setMonth(d.getMonth()-1); setSelected(d); };
  const goNextMonth = () => { const d=new Date(selected); d.setMonth(d.getMonth()+1); setSelected(d); };
  const goPrevWeek  = () => setSelected(prevWeek(selected));
  const goNextWeek  = () => setSelected(nextWeek(selected));

  // ---- Importación ----
  function onImport({clientesJson, planJson}) {
    const c = normalizeClientes(clientesJson);
    const p = normalizePlan(planJson);
    localStorage.setItem(LS_CLIENTES, JSON.stringify(c));
    localStorage.setItem(LS_PLAN, JSON.stringify(p));
    setClientes(c);
    setPlanBase(p);
    setPlanMem(expandPlan28(p, 3)); // solo memoria
    setImportOpen(false);
  }

  // ---- Plan del día ----
  const hoyKey = toKey(selected);
  const idsHoy = planMap.get(hoyKey) || [];
  const clientesHoy = idsHoy.map(id => cliMap.get(id)).filter(Boolean);

  // ---- Notas visibles en Día ----
  const notasDiaCliente = clientesHoy
    .map(c => notasCliente.get(c.id))
    .filter(Boolean)
    .map(n => ({ ...n, clienteNombre: cliMap.get(n.clientId)?.nombre || n.clientId, etiqueta: etiquetaDinamica(n.clientId, planMap, selected) }));

  const notasDiaFuera = notasFuera.filter(n => n.fechaKey === hoyKey)
    .map(n => ({ ...n, etiqueta: 'Hoy' }));

  const notasDia = [...notasDiaCliente, ...notasDiaFuera];

  function crearOEditarNotaCliente(clienteId){
    const clienteNombre = cliMap.get(clienteId)?.nombre || clienteId;
    const existente = notasCliente.get(clienteId) || null;
    setModalNota({
      tipo: 'cliente',
      clienteId,
      clienteNombre,
      fecha: hoyKey,
      texto: existente?.texto || ''
    });
  }
  function crearNotaFuera(){
    if (isWeekend(selected)) return; // no crear en fin de semana
    setModalNota({ tipo:'fuera', fecha: hoyKey, clienteNombre:'', texto:'' });
  }
  function guardarModalNota(payload){
    if (payload.tipo === 'cliente') {
      // Una activa por cliente
      const next = new Map(notasCliente);
      next.set(payload.clienteId, { clientId: payload.clienteId, texto: payload.texto, completed:false });
      setNotasCliente(next);
    } else {
      // Fuera de ruta: una por cliente y día -> impedimos duplicados por (fechaKey, clienteNombre)
      const dup = notasFuera.some(n => n.fechaKey===payload.fecha && n.clienteNombre.trim().toLowerCase()===payload.clienteNombre.trim().toLowerCase());
      if (dup) { alert('Ya existe una nota para ese cliente en este día.'); return; }
      setNotasFuera(prev => prev.concat({
        id: Math.random().toString(36).slice(2),
        fechaKey: payload.fecha,
        clienteNombre: payload.clienteNombre.trim()||'Sin nombre',
        texto: payload.texto,
        completed:false
      }));
    }
    setModalNota(null);
  }
  function completarNota(nota){
    if (nota.clientId){ // por cliente: desaparece de hoy y futuras visitas
      const next = new Map(notasCliente);
      next.delete(nota.clientId);
      setNotasCliente(next);
    } else { // fuera de ruta: solo hoy
      setNotasFuera(prev => prev.filter(x => x.id !== nota.id));
    }
    beep();
  }
  function borrarNota(nota){
    if (nota.clientId){
      const next = new Map(notasCliente);
      next.delete(nota.clientId);
      setNotasCliente(next);
    } else {
      setNotasFuera(prev => prev.filter(x => x.id !== nota.id));
    }
  }
  function editarNota(nota){
    if (nota.clientId){
      setModalNota({ tipo:'cliente', clienteId: nota.clientId, clienteNombre: nota.clienteNombre, fecha: hoyKey, texto: nota.texto });
    } else {
      setModalNota({ tipo:'fuera', fecha: hoyKey, clienteNombre: nota.clienteNombre, texto: nota.texto, id: nota.id });
    }
  }

  function guardarEdicionFuera(id, texto, clienteNombre){
    setNotasFuera(prev => prev.map(n => n.id===id ? {...n, texto, clienteNombre: clienteNombre||n.clienteNombre} : n));
    setModalNota(null);
  }

  // ======= Render =======
  return (
    <div className="max-w-3xl mx-auto p-3 pb-24 no-select">
      {/* Barra superior */}
      <div className="flex items-center justify-between mb-3">
        <button className="px-3 py-1 rounded-md border border-iosBlue text-iosBlue" onClick={goToday}>Hoy</button>
        <div className="flex items-center gap-2">
          <button onClick={()=>setView('mes')}    className={`px-3 py-1 rounded-md ${view==='mes'?'bg-iosBlue text-white':'border text-iosBlue border-iosBlue'}`}>Mes</button>
          <button onClick={()=>setView('semana')} className={`px-3 py-1 rounded-md ${view==='semana'?'bg-iosBlue text-white':'border text-iosBlue border-iosBlue'}`}>Semana</button>
          <button onClick={()=>setView('dia')}    className={`px-3 py-1 rounded-md ${view==='dia'?'bg-iosBlue text-white':'border text-iosBlue border-iosBlue'}`}>Día</button>
        </div>
        <button className="px-3 py-1 rounded-md bg-iosBlue text-white" onClick={()=>setImportOpen(true)}>Importar</button>
      </div>

      {/* Encabezado de fecha / navegación contextual */}
      {view==='mes' && (
        <div className="flex items-center justify-between mb-2">
          <button onClick={goPrevMonth} className="text-iosBlue text-xl">‹</button>
          <div className="font-semibold">{selected.toLocaleDateString('es-ES', { month:'long', year:'numeric' })}</div>
          <button onClick={goNextMonth} className="text-iosBlue text-xl">›</button>
        </div>
      )}
      {view!=='mes' && (
        <div className="flex items-center justify-between mb-2">
          <button onClick={view==='semana'?goPrevWeek:()=>setSelected(addDays(selected,-1))} className="text-iosBlue text-xl">‹</button>
          <div className="font-semibold">
            {view==='semana'
              ? `${startOfWeekMon(selected).toLocaleDateString('es-ES')} – ${endOfWeekMon(selected).toLocaleDateString('es-ES')}`
              : selected.toLocaleDateString('es-ES', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
          </div>
          <button onClick={view==='semana'?goNextWeek:()=>setSelected(addDays(selected,1))} className="text-iosBlue text-xl">›</button>
        </div>
      )}

      {/* Contenido de vistas */}
      {view==='mes' && <VistaMes selected={selected} setSelected={setSelected} setView={setView} planMap={planMap} />}
      {view==='semana' && <VistaSemana selected={selected} setSelected={setSelected} planMap={planMap} notasCliente={notasCliente} cliMap={cliMap} />}
      {view==='dia' && (
        <VistaDia
          selected={selected}
          clientesHoy={clientesHoy}
          notasDia={notasDia}
          isWeekend={isWeekend(selected)}
          crearOEditarNotaCliente={crearOEditarNotaCliente}
          crearNotaFuera={crearNotaFuera}
          completarNota={completarNota}
          borrarNota={borrarNota}
          editarNota={editarNota}
        />
      )}

      {/* Modal Importar */}
      {importOpen && <ModalImportar onClose={()=>setImportOpen(false)} onImport={onImport} />}

      {/* Modal Nota */}
      {modalNota && (
        <ModalNota
          data={modalNota}
          onClose={()=>setModalNota(null)}
          onSave={(payload)=>{
            if (payload.tipo==='fuera' && modalNota.id){
              guardarEdicionFuera(modalNota.id, payload.texto, payload.clienteNombre);
            } else {
              guardarModalNota(payload);
            }
          }}
        />
      )}
    </div>
  );
}

// ===== Vista Mes =====
function VistaMes({ selected, setSelected, setView, planMap }){
  // construye cuadrícula 6x7 (lunes a domingo)
  const firstOfMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const start = startOfWeekMon(firstOfMonth);
  const days = Array.from({length:42}, (_,i)=> addDays(start, i));
  return (
    <div className="grid grid-cols-7 gap-1">
      {['L','M','X','J','V','S','D'].map(d=>(
        <div key={d} className="text-center text-xs text-gray-500 py-1">{d}</div>
      ))}
      {days.map(d=>{
        const key = toKey(d);
        const esFinde = isWeekend(d);
        const tienePlan = (planMap.get(key)||[]).length>0;
        const isThisMonth = d.getMonth()===selected.getMonth();
        return (
          <button
            key={key}
            onClick={()=>{
              if (esFinde) return; // "Día no laborable"
              setSelected(d); setView('dia');
            }}
            className={`h-16 rounded-md border flex flex-col items-center justify-between p-1
              ${isThisMonth?'bg-white':'bg-gray-50'}
              ${esFinde?'opacity-50':''}
            `}
          >
            <div className="self-start text-sm">{d.getDate()}</div>
            <div className="text-[10px]">
              {esFinde ? <span className="text-gray-400">Día no laborable</span> :
               tienePlan ? <span className="text-iosBlue">• plan</span> : <span className="text-gray-300">—</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ===== Vista Semana =====
function VistaSemana({ selected, setSelected, planMap, notasCliente, cliMap }){
  const start = startOfWeekMon(selected);
  const days = Array.from({length:7},(_,i)=> addDays(start,i));

  // swipe
  const wrapRef = React.useRef(null);
  React.useEffect(()=>{
    const el = wrapRef.current; if (!el) return;
    let x0=null,y0=null;
    const onStart = (e)=>{ const t=e.touches[0]; x0=t.clientX; y0=t.clientY; };
    const onEnd = (e)=>{ if(x0==null) return; const t=e.changedTouches[0]; const dx=t.clientX-x0; const dy=t.clientY-y0;
      if (Math.abs(dx)>60 && Math.abs(dy)<50){ if (dx<0) setSelected(nextWeek(selected)); else setSelected(prevWeek(selected)); }
      x0=y0=null;
    };
    el.addEventListener('touchstart', onStart, {passive:true});
    el.addEventListener('touchend', onEnd, {passive:true});
    return ()=>{ el.removeEventListener('touchstart', onStart); el.removeEventListener('touchend', onEnd); };
  }, [selected,setSelected]);

  // "Notas de la semana": notas por cliente cuya próxima visita caiga en esta semana
  const notasSemana = [];
  for (const [clientId, nota] of notasCliente.entries()){
    // próxima visita desde el lunes de esta semana
    const target = nextVisitDateForClient(clientId, planMap, start);
    if (target && target<=endOfWeekMon(selected) && target>=start){
      notasSemana.push({
        clientId,
        clienteNombre: cliMap.get(clientId)?.nombre || clientId,
        texto: nota.texto,
        etiqueta: etiquetaDinamica(clientId, planMap, target)
      });
    }
  }

  return (
    <div ref={wrapRef} className="space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {days.map(d=>{
          const key = toKey(d);
          const esFinde = isWeekend(d);
          const tienePlan = (planMap.get(key)||[]).length>0;
          return (
            <button key={key}
              onClick={()=> setSelected(d)}
              className={`h-16 rounded-md border p-1 flex flex-col items-center justify-between ${sameDay(d,selected)?'border-iosBlue':''} ${esFinde?'opacity-50':''}`}
            >
              <div className="text-sm">{d.toLocaleDateString('es-ES',{weekday:'short'})}</div>
              <div className="text-lg font-semibold">{d.getDate()}</div>
              <div className="text-[10px]">{esFinde ? 'Día no laborable' : (tienePlan?'• plan':'—')}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-2">
        <div className="font-semibold mb-2">Notas de la semana</div>
        {notasSemana.length===0 ? (
          <div className="text-sm text-gray-500">Sin notas</div>
        ) : (
          <ul className="space-y-2">
            {notasSemana.map((n,i)=>(
              <li key={i} className="border rounded-md p-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{n.clienteNombre}</div>
                  <span className={chipStyle(n.etiqueta)}>{n.etiqueta}</span>
                </div>
                <div className="text-sm text-gray-700 mt-1">{n.texto}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ===== Vista Día =====
function VistaDia({ selected, clientesHoy, notasDia, isWeekend, crearOEditarNotaCliente, crearNotaFuera, completarNota, borrarNota, editarNota }){
  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">{isWeekend ? 'Día no laborable' : 'Día laborable'}</div>

      {/* Plan del día */}
      <div>
        <div className="font-semibold mb-2">Plan del día</div>
        {clientesHoy.length===0 ? (
          <div className="text-sm text-gray-500">Sin clientes planificados</div>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {clientesHoy.map(c=>(
              <li key={c.id}>
                <button
                  className="w-full border rounded-md p-2 text-left"
                  onClick={()=> !isWeekend && crearOEditarNotaCliente(c.id)}
                  disabled={isWeekend}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.nombre}</span>
                    <span className="text-iosBlue">+ nota</span>
                  </div>
                  {isWeekend && <div className="text-xs text-gray-400">Día no laborable</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Notas</div>
          <button onClick={crearNotaFuera} className="px-3 py-1 rounded-md border border-iosBlue text-iosBlue" disabled={isWeekend}>
            Añadir nota fuera de ruta
          </button>
        </div>
        {notasDia.length===0 ? (
          <div className="text-sm text-gray-500">Sin notas para hoy</div>
        ) : (
          <ul className="space-y-2">
            {notasDia.map(n=>(
              <li key={n.id || n.clientId} className="border rounded-md p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" onChange={()=>completarNota(n)} />
                    <div className="font-medium">{n.clienteNombre}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={chipStyle(n.etiqueta)}>{n.etiqueta}</span>
                    <button onClick={()=>editarNota(n)} className="text-xl">✏️</button>
                    <button onClick={()=>borrarNota(n)} className="text-xl">🗑️</button>
                  </div>
                </div>
                <div className="text-sm text-gray-700 mt-1">{n.texto}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ===== Modal Importar =====
function ModalImportar({ onClose, onImport }){
  const [clientesTxt, setClientesTxt] = React.useState('[\\n  { "id": "1030755", "nombre": "BAR A MOTORA" }\\n]');
  const [planTxt, setPlanTxt] = React.useState('[\\n  { "fecha": "2025-09-29", "clienteIds": ["1030755","459565"] }\\n]');
  const [err, setErr] = React.useState('');

  function confirmar(){
    try{
      const c = JSON.parse(clientesTxt);
      const p = JSON.parse(planTxt);
      if (!Array.isArray(c) || !Array.isArray(p)) throw new Error('Formato inválido');
      onImport({ clientesJson:c, planJson:p });
    } catch(e){
      setErr('JSON inválido. Revisa el formato.');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-3 z-50">
      <div className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Importar datos</div>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-sm font-medium mb-1">clientes.json</div>
            <textarea className="w-full h-40 border rounded-md p-2 font-mono text-xs" value={clientesTxt} onChange={e=>setClientesTxt(e.target.value)} />
          </div>
          <div>
            <div className="text-sm font-medium mb-1">plan.json</div>
            <textarea className="w-full h-40 border rounded-md p-2 font-mono text-xs" value={planTxt} onChange={e=>setPlanTxt(e.target.value)} />
          </div>
        </div>
        {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 rounded-md border">Cancelar</button>
          <button onClick={confirmar} className="px-3 py-1 rounded-md bg-iosBlue text-white">Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ===== Modal Nota (cliente / fuera de ruta) =====
function ModalNota({ data, onClose, onSave }){
  const [texto, setTexto] = React.useState(data.texto||'');
  const [clienteNombre, setClienteNombre] = React.useState(data.clienteNombre||'');

  const esCliente = data.tipo==='cliente';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-3 z-50">
      <div className="bg-white w-full max-w-xl rounded-t-2xl sm:rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">
            {esCliente ? `Nota · ${data.clienteNombre}` : 'Nota fuera de ruta'}
          </div>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>

        {!esCliente && (
          <div className="mb-3">
            <div className="text-sm font-medium">Cliente</div>
            <input className="w-full border rounded-md p-2" value={clienteNombre} onChange={e=>setClienteNombre(e.target.value)} placeholder="Nombre del cliente" />
          </div>
        )}

        <div>
          <div className="text-sm font-medium">Texto</div>
          <textarea className="w-full h-28 border rounded-md p-2" value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Escribe la nota..." />
        </div>

        {/* Chips de prioridad visual (solo UI; la etiqueta final es dinámica según visita/tiempo) */}
        <div className="mt-3 flex items-center gap-2 text-xs">
          {['Hoy','Esta semana','La semana que viene','Próxima visita'].map(t=>(
            <span key={t} className={chipStyle(t)}>{t}</span>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 rounded-md border">Cancelar</button>
          <button
            onClick={()=> onSave(esCliente
              ? { tipo:'cliente', clienteId: data.clienteId, texto }
              : (data.id
                  ? { tipo:'fuera', id:data.id, texto, clienteNombre }
                  : { tipo:'fuera', texto, clienteNombre }
                )
            )}
            className="px-3 py-1 rounded-md bg-iosBlue text-white"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Montaje =====
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
