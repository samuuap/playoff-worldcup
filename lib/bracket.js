// Lógica pura del cuadro, reutilizada por el bracket, la clasificación y el admin.

export const ISO = {
  'Alemania':'de','Paraguay':'py','Francia':'fr','Suecia':'se','Sudáfrica':'za','Canadá':'ca',
  'Países Bajos':'nl','Marruecos':'ma','Portugal':'pt','Croacia':'hr','España':'es','Austria':'at',
  'Estados Unidos':'us','Bosnia':'ba','Bélgica':'be','Senegal':'sn','Brasil':'br','Japón':'jp',
  'Costa de Marfil':'ci','Noruega':'no','México':'mx','Ecuador':'ec','Inglaterra':'gb-eng',
  'R.D. Congo':'cd','Argentina':'ar','Cabo Verde':'cv','Australia':'au','Egipto':'eg',
  'Suiza':'ch','Argelia':'dz','Colombia':'co','Ghana':'gh'
};

// Disposición simétrica: izquierda -> centro (final) -> derecha
export const LAYOUT = [
  { side:'left',   head:'16avos',  ids:['R32-01','R32-02','R32-03','R32-04','R32-05','R32-06','R32-07','R32-08'] },
  { side:'left',   head:'8vos',    ids:['R16-01','R16-02','R16-03','R16-04'] },
  { side:'left',   head:'Cuartos', ids:['QF-1','QF-2'] },
  { side:'left',   head:'Semis',   ids:['SF-1'] },
  { side:'center' },
  { side:'right',  head:'Semis',   ids:['SF-2'] },
  { side:'right',  head:'Cuartos', ids:['QF-3','QF-4'] },
  { side:'right',  head:'8vos',    ids:['R16-05','R16-06','R16-07','R16-08'] },
  { side:'right',  head:'16avos',  ids:['R32-09','R32-10','R32-11','R32-12','R32-13','R32-14','R32-15','R32-16'] },
];

export function kickMs(m){ return new Date(m.kickoff_at).getTime(); }
export function isLocked(m){ return Date.now() >= kickMs(m); }
export function flagAbbr(team){
  return (team || '').replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ ]/g,'').trim().slice(0,3).toUpperCase();
}

// Participantes según las PREDICCIONES del usuario (cuadro propio).
export function participants(m, picks){
  if (!m) return [null, null];
  if (m.round === 'R32') return [m.team_a, m.team_b];
  return [ picks[m.feeder_a] || null, picks[m.feeder_b] || null ];
}

// Participantes según los RESULTADOS reales (para el panel de admin).
export function actualParticipants(m, matches){
  if (!m) return [null, null];
  if (m.round === 'R32') return [m.team_a, m.team_b];
  return [ matches[m.feeder_a]?.actual_winner || null, matches[m.feeder_b]?.actual_winner || null ];
}

// Equipos REALMENTE eliminados: el que NO ganó en cada partido ya resuelto.
// Sirve para tachar a ese equipo en todas las rondas donde aún aparezca.
export function eliminatedTeams(matches, order){
  const out = new Set();
  for (const id of order) {
    const m = matches[id];
    if (!m || !m.actual_winner) continue;
    for (const t of actualParticipants(m, matches)) {
      if (t && t !== m.actual_winner) out.add(t);
    }
  }
  return out;
}

// Tras cambiar un pick, elimina en cascada los picks superiores que dejan de ser válidos.
export function revalidate(matches, order, picks){
  const next = { ...picks };
  for (const rd of ['R16','QF','SF','F']) {
    for (const id of order) {
      const m = matches[id];
      if (!m || m.round !== rd) continue;
      const parts = participants(m, next);
      if (next[id] && !parts.includes(next[id])) delete next[id];
    }
  }
  return next;
}

// ENTRADA TARDÍA — "bloqueo de rama completa".
// Si un usuario fue habilitado tarde (lateAt), no puntúa ninguna ranura cuya RAMA
// (la propia ranura o cualquiera de las que la alimentan, hacia abajo) ya tuviera
// un resultado conocido ANTES de que entrara. Así no cobra por información que ya
// existía cuando se sentó a hacer el cuadro. Devuelve el Set de ids contaminadas.
export function taintedSet(matches, order, lateAt){
  if (!lateAt) return new Set();
  const t = new Date(lateAt).getTime();
  const resolvedEarly = new Set();
  for (const id of order) {
    const m = matches[id];
    if (m && m.result_set_at && new Date(m.result_set_at).getTime() < t) resolvedEarly.add(id);
  }
  // De abajo (R32) hacia arriba (F): una ranura se contamina si ella o un alimentador lo está.
  const tainted = new Set();
  for (const rd of ['R32','R16','QF','SF','F']) {
    for (const id of order) {
      const m = matches[id];
      if (!m || m.round !== rd) continue;
      if (resolvedEarly.has(id) ||
          (m.feeder_a && tainted.has(m.feeder_a)) ||
          (m.feeder_b && tainted.has(m.feeder_b))) tainted.add(id);
    }
  }
  return tainted;
}

export function computeScore(matches, order, picks, tainted = new Set()){
  // Mapa "partido -> su siguiente" (el partido al que alimenta)
  const parent = {};
  for (const id of order) {
    const m = matches[id];
    if (m.feeder_a) parent[m.feeder_a] = id;
    if (m.feeder_b) parent[m.feeder_b] = id;
  }
  let pts = 0, hit = 0, lock = 0;
  for (const id of order) {
    const m = matches[id];
    if (isLocked(m)) lock++;
    if (m.points === 0) continue;
    if (tainted.has(id)) continue; // entrada tardía: rama ya decidida, no puntúa
    if (m.conditional) {
      // Acierto si predijo bien el SIGUIENTE partido de ese equipo (no el propio).
      const pm = parent[id] ? matches[parent[id]] : null;
      if (pm && pm.actual_winner && picks[parent[id]] === pm.actual_winner) { pts += m.points; hit++; }
    } else {
      if (m.actual_winner && picks[id] === m.actual_winner) { pts += m.points; hit++; }
    }
  }
  return { pts, hit, lock };
}

export function countdownLabel(m){
  const d = kickMs(m) - Date.now();
  if (d <= 0) return { text: '● Cerrado', locked: true };
  const s = Math.floor(d/1000), dd = Math.floor(s/86400), hh = Math.floor(s%86400/3600),
        mm = Math.floor(s%3600/60), ss = s%60;
  const text = 'Cierra en ' + (dd>0 ? `${dd}d ${hh}h` : hh>0 ? `${hh}h ${String(mm).padStart(2,'0')}m` : `${mm}:${String(ss).padStart(2,'0')}`);
  return { text, locked: false };
}

// Cierre global = el primer partido en cerrarse (todos iguales en modelo global).
export function deadlineOf(matches, order){
  let min = null;
  for (const id of order) {
    const t = kickMs(matches[id]);
    if (!isNaN(t) && (min === null || t < min)) min = t;
  }
  return min === null ? null : new Date(min);
}

export function fmtDeadline(d){
  if (!d) return '';
  return d.toLocaleString('es-ES', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
}