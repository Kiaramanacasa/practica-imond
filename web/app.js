/* =====================================================================
   EcoBottle AR: tablero web
   ---------------------------------------------------------------------
   Esta página NO calcula medidas. Los marts de dw/mart/ (generados por
   sql/04_marts.sql) traen precalculadas todas las combinaciones de
   filtros (período, canal y provincia). Al cambiar un filtro, la página
   busca la fila que corresponde y la dibuja.

   Lo único que hace JavaScript es: elegir filas, dar formato a los
   números y convertir valores en posiciones de pantalla (por ejemplo,
   el "nivel" 0 a 1 en la altura del agua, o la escala de un eje).
   ===================================================================== */

const MARTS = [
  "mart_ventas", "mart_productos", "mart_estados", "mart_usuarios", "mart_trafico",
  "mart_nps", "mart_pagos", "mart_entregas", "mart_compras_estado_cliente",
  "mart_clientes", "mart_periodo",
];
const RUTA_MARTS = "../dw/mart/";
const SIN_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ONLINE = "Tienda Online", TIENDAS = "Tiendas Físicas";

let D = {};          // marts cargados
const estado = { tab: "resumen", anio: "Todo", mes: "", canal: "Todos", provincia: "Todas" };

/* ---------------------------------------------------------------------
   Lectura de los CSV
   --------------------------------------------------------------------- */
function parseCSV(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  const [cabecera, ...datos] = filas.filter(f => f.length > 1 || f[0] !== "");
  const esNumero = /^-?\d+(\.\d+)?$/;
  const TEXTO = new Set(["periodo"]);   // "2024" es un período, no un número
  return datos.map(f => Object.fromEntries(
    cabecera.map((col, j) => [col, f[j] === "" ? null : (!TEXTO.has(col) && esNumero.test(f[j]) ? Number(f[j]) : f[j])])
  ));
}

async function cargarMarts() {
  const embebidos = window.__MARTS__;
  const textos = await Promise.all(MARTS.map(async nombre => {
    if (embebidos && embebidos[nombre]) return embebidos[nombre];
    const resp = await fetch(RUTA_MARTS + nombre + ".csv");
    if (!resp.ok) throw new Error(`No se encontró ${RUTA_MARTS}${nombre}.csv (${resp.status})`);
    return resp.text();
  }));
  return Object.fromEntries(MARTS.map((n, i) => [n, parseCSV(textos[i])]));
}

/* ---------------------------------------------------------------------
   Selección de filas (lo único que "hace" la página con los datos)
   --------------------------------------------------------------------- */
const periodo = () => estado.mes || estado.anio;

/** Fila exacta de un mart para los filtros dados. */
function fila(mart, filtros) {
  return D[mart].find(r => Object.entries(filtros).every(([k, v]) => r[k] === v)) || null;
}
/** Todas las filas que coinciden con los filtros. */
function filas(mart, filtros) {
  return D[mart].filter(r => Object.entries(filtros).every(([k, v]) => r[k] === v));
}
/** Filas mensuales de un mart (del año elegido, si hay uno). */
function meses(mart, filtros = {}) {
  return filas(mart, { periodo_tipo: "mes", ...filtros })
    .filter(r => estado.anio === "Todo" || r.periodo.startsWith(estado.anio))
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}
const ctx = (extra = {}) => ({ periodo: periodo(), canal: estado.canal, provincia: estado.provincia, ...extra });

/* ---------------------------------------------------------------------
   Formato
   --------------------------------------------------------------------- */
const fmt1 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
// Montos: en millones desde $1 M; por debajo, en miles, para no mostrar "$0,55 M"
function monto(v, decimales) {
  if (v == null) return "–";
  if (Math.abs(v) >= 1e6) return `$${(decimales === 2 ? fmt2 : fmt1).format(v / 1e6)} M`;
  if (Math.abs(v) >= 1e3) return `$${fmt1.format(v / 1e3)} mil`;
  return `$${fmt0.format(v)}`;
}
const millones = v => monto(v, 1);
const millones2 = v => monto(v, 2);
const pesos = v => v == null ? "–" : `$${fmt0.format(v)}`;
const pct = v => v == null ? "–" : `${fmt1.format(v)} %`;
const entero = v => v == null ? "–" : fmt0.format(v);
const dec = v => v == null ? "–" : fmt1.format(v);
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const corto = c => (c === ONLINE ? "Online" : c === TIENDAS ? "Tiendas físicas" : c);

function etiquetaPeriodo(p) {
  if (p === "Todo") return "todo el período";
  if (/^\d{4}$/.test(p)) return p;
  const [a, m] = p.split("-").map(Number);
  return `${MESES_LARGOS[m - 1]} de ${a}`;
}
const mesCorto = p => MESES[Number(p.slice(5, 7)) - 1];
function fechaLarga(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES_LARGOS[m - 1]} de ${a}`;
}

/* ---------------------------------------------------------------------
   Utilidades de pantalla
   --------------------------------------------------------------------- */
const $ = id => document.getElementById(id);
const tooltip = $("tooltip");
function mostrarTooltip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const r = tooltip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
  const top = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
const ocultarTooltip = () => { tooltip.hidden = true; };
function conTooltip(el, html) {
  el.__tip = html;
  if (el.__conTip) return;
  el.__conTip = true;
  el.addEventListener("pointermove", e => mostrarTooltip(typeof el.__tip === "function" ? el.__tip() : el.__tip, e.clientX, e.clientY));
  el.addEventListener("pointerleave", ocultarTooltip);
  el.addEventListener("focus", () => {
    const r = el.getBoundingClientRect();
    mostrarTooltip(typeof el.__tip === "function" ? el.__tip() : el.__tip, r.left + r.width / 2, r.top);
  });
  el.addEventListener("blur", ocultarTooltip);
}
/** Ejecuta fn en el próximo cuadro (para que las transiciones arranquen). */
const despues = fn => requestAnimationFrame(() => requestAnimationFrame(fn));
/** Escala de un eje: el máximo "redondo" que entra en la pantalla. */
function topeEje(max) {
  if (!max) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= max) return k * p;
  return 10 * p;
}

/* ---------------------------------------------------------------------
   Botella SVG con capas que se pueden volver a llenar
   viewBox 100 x 266: el agua va de y=256 (fondo) a y=64 (hombros).
   --------------------------------------------------------------------- */
const FONDO = 256, ALTO_UTIL = 192;
const CUERPO = "M38,20 L62,20 L62,40 C62,52 90,56 90,76 L90,238 Q90,256 72,256 L28,256 Q10,256 10,238 L10,76 C10,56 38,52 38,40 Z";
let idBotella = 0;
function ola(yTope, amplitud = 3.5) {
  let d = `M-100,${yTope}`;
  for (let x = -100; x < 200; x += 50) d += ` q12.5,${-amplitud} 25,0 t25,0`;
  return d + " L200,262 L-100,262 Z";
}
/**
 * Crea una botella. capas: [{color}] de atrás hacia adelante (la primera es
 * la de más arriba). Devuelve el SVG y una función para fijar los niveles.
 */
function crearBotella({ colores, tapa = "var(--tinta)", burbujas = 0 }) {
  const id = `bt${++idBotella}`;
  const capas = colores.map((c, i) => `
    <g class="capa" style="transform:translateY(${ALTO_UTIL + 12}px)">
      <path class="ola" d="${ola(FONDO - ALTO_UTIL)}" fill="${c}" style="animation-duration:${3.2 + i * 1.3}s;animation-delay:-${i * 0.7}s"/>
    </g>`).join("");
  let circulos = "";
  for (let i = 0; i < burbujas; i++) {
    const x = 20 + ((i * 37) % 60), r = 1.2 + (i % 4) * 0.8;
    circulos += `<circle class="burbuja" cx="${x}" cy="250" r="${r}" style="animation-duration:${4 + (i % 5) * 1.1}s;animation-delay:-${(i * 0.83) % 6}s"/>`;
  }
  const svg = `
  <svg viewBox="0 -4 100 266" aria-hidden="true" focusable="false">
    <defs><clipPath id="${id}"><path d="${CUERPO}"/></clipPath></defs>
    <rect class="tapa" x="34" y="-2" width="32" height="24" rx="5" fill="${tapa}"/>
    <rect x="34" y="6" width="32" height="2.5" fill="rgba(255,255,255,.25)"/>
    <rect x="34" y="13" width="32" height="2.5" fill="rgba(255,255,255,.25)"/>
    <path d="${CUERPO}" fill="var(--vidrio)"/>
    <g clip-path="url(#${id})">${capas}${circulos}</g>
    <path d="${CUERPO}" fill="none" stroke="var(--vidrio-borde)" stroke-width="2.5"/>
    <path d="M20,92 L20,226" stroke="rgba(255,255,255,.45)" stroke-width="5" stroke-linecap="round"/>
  </svg>`;
  return svg;
}
/** Fija los niveles (0 a 1) de las capas de una botella ya insertada. */
function llenarBotella(svgEl, niveles, tapa) {
  svgEl.querySelectorAll(".capa").forEach((g, i) => {
    const n = Math.max(0, Math.min(1, niveles[i] ?? 0));
    g.style.transform = `translateY(${(1 - n) * ALTO_UTIL}px)`;
  });
  if (tapa) svgEl.querySelector(".tapa").setAttribute("fill", tapa);
}

/* ---------------------------------------------------------------------
   Sparkline y gráfico de línea
   --------------------------------------------------------------------- */
function chispa(valores, marcado = -1) {
  const v = valores.filter(x => x != null);
  if (v.length < 2) return "";
  const min = Math.min(...v), max = Math.max(...v), W = 100, H = 30;
  const x = i => (i * W) / (valores.length - 1);
  const y = val => H - 3 - ((val - min) / (max - min || 1)) * (H - 6);
  const d = valores.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(val).toFixed(2)}`).join(" ");
  const punto = marcado >= 0 ? `<circle cx="${x(marcado)}" cy="${y(valores[marcado])}" r="2.6"/>` : "";
  return `<svg class="chispa" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="${d} L${W},${H} L0,${H} Z"/><path class="trazo" d="${d}"/>${punto}</svg>`;
}

/**
 * Línea con área. puntos: [{periodo, valor, tip, clase}]
 * opciones: {min, max, pasos, formato, ref: {valor, texto}, onClick}
 */
function graficoLinea(cont, puntos, op) {
  if (!puntos.length) { cont.innerHTML = `<p class="sin-datos">No hay datos para esta selección.</p>`; return; }
  // el ancho del dibujo sigue al del contenedor, así el texto queda a tamaño real
  const W = Math.max(480, Math.round(cont.clientWidth || 760)), H = op.alto || 260, m = { t: 22, r: 16, b: 40, l: 46 };
  const min = op.min ?? 0;
  const max = op.max ?? topeEje(Math.max(...puntos.map(p => p.valor)));
  const pasos = op.pasos || 5;
  const n = puntos.length;
  const x = i => n === 1 ? (m.l + W - m.r) / 2 : m.l + (i * (W - m.l - m.r)) / (n - 1);
  const y = v => m.t + ((max - v) * (H - m.t - m.b)) / (max - min);
  const linea = puntos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const area = `${linea} L${x(n - 1)},${y(min)} L${x(0)},${y(min)} Z`;
  let grilla = "";
  for (let k = 0; k <= pasos; k++) {
    const v = min + ((max - min) * k) / pasos;
    grilla += `<line class="l-grilla" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="l-eje" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${op.eje ? op.eje(v) : fmt0.format(v)}</text>`;
  }
  const salto = n > 14 ? 2 : 1;
  const ejeX = puntos.map((p, i) => (i % salto && i !== n - 1) ? "" :
    `<text class="l-eje" x="${x(i)}" y="${H - m.b + 18}" text-anchor="middle">${mesCorto(p.periodo)}</text>`
    + (p.periodo.endsWith("-01") || i === 0 ? `<text class="l-eje fuerte" x="${x(i)}" y="${H - m.b + 33}" text-anchor="middle">${p.periodo.slice(0, 4)}</text>` : "")
  ).join("");
  const gid = `g${++idBotella}`;
  const ref = op.ref && op.ref.valor != null ? `
    <line class="l-ref" x1="${m.l}" x2="${W - m.r}" y1="${y(op.ref.valor)}" y2="${y(op.ref.valor)}"/>` : "";
  const notas = puntos.map((p, i) => p.nota ? `<text class="l-nota" x="${x(i)}" y="${y(p.valor) + (p.notaAbajo ? 22 : -12)}" text-anchor="middle" fill="${p.notaColor || "var(--tinta)"}">${p.nota}</text>` : "").join("");
  cont.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${op.titulo || ""}">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--agua-online)" stop-opacity=".45"/>
          <stop offset="1" stop-color="var(--agua-tiendas)" stop-opacity=".06"/>
        </linearGradient>
        <clipPath id="${gid}c"><rect x="0" y="0" width="${SIN_MOVIMIENTO ? W : 0}" height="${H}"/></clipPath>
      </defs>
      ${grilla}
      <g clip-path="url(#${gid}c)"><path d="${area}" fill="url(#${gid})"/><path class="l-trazo" d="${linea}"/></g>
      ${ref}${notas}
      ${puntos.map((p, i) => `<circle class="l-punto ${p.clase || ""}" cx="${x(i)}" cy="${y(p.valor)}" r="${n > 14 ? 4.5 : 5.5}" tabindex="0" data-i="${i}" aria-label="${p.aria || ""}"/>`).join("")}
      ${ejeX}
    </svg>`;
  cont.querySelectorAll(".l-punto").forEach(c => {
    const p = puntos[Number(c.dataset.i)];
    conTooltip(c, p.tip);
    if (op.onClick) {
      c.addEventListener("click", () => op.onClick(p));
      c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); op.onClick(p); } });
    }
  });
  const rect = cont.querySelector(`#${gid}c rect`);
  if (!SIN_MOVIMIENTO) {
    const inicio = performance.now(), dur = 1100;
    const paso = t => {
      const k = Math.max(0, Math.min(1, (t - inicio) / dur));
      rect.setAttribute("width", W * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
}

/* ---------------------------------------------------------------------
   Encabezados de los paneles: a qué filtros responde cada gráfico
   --------------------------------------------------------------------- */
const NOMBRES_FILTRO = { periodo: "Período", canal: "Canal", provincia: "Provincia" };
function prepararPaneles() {
  document.querySelectorAll(".panel").forEach(panel => {
    const responde = panel.dataset.responde.split(" ").filter(Boolean);
    const extra = document.createElement("div");
    extra.className = "panel-extra";
    extra.innerHTML = `<div class="chips">${Object.entries(NOMBRES_FILTRO).map(([k, v]) =>
      `<span class="chip ${responde.includes(k) ? "si" : ""}" title="${responde.includes(k) ? "Responde" : "No responde"} al filtro de ${v.toLowerCase()}">${v}</span>`).join("")}</div>`;
    panel.querySelector(".panel-cabeza").appendChild(extra);
    const aviso = document.createElement("p");
    aviso.className = "aviso-filtro";
    aviso.hidden = true;
    panel.querySelector(".panel-cabeza").after(aviso);
  });
}
function actualizarAvisos() {
  const activos = {
    periodo: periodo() !== "Todo",
    canal: estado.canal !== "Todos",
    provincia: estado.provincia !== "Todas",
  };
  document.querySelectorAll(".panel").forEach(panel => {
    const responde = panel.dataset.responde.split(" ").filter(Boolean);
    const ignorados = Object.keys(activos).filter(k => activos[k] && !responde.includes(k));
    const aviso = panel.querySelector(".aviso-filtro");
    aviso.hidden = !ignorados.length;
    if (ignorados.length) aviso.textContent = responde.length
      ? `Este gráfico no se filtra por ${ignorados.map(k => NOMBRES_FILTRO[k].toLowerCase()).join(" ni por ")}: esos datos no existen en su mart.`
      : "Es una foto del período completo: no responde a los filtros.";
  });
}

/* ---------------------------------------------------------------------
   Filtros
   --------------------------------------------------------------------- */
function armarFiltros() {
  const anios = ["Todo", ...new Set(filas("mart_ventas", { periodo_tipo: "anio" }).map(r => r.periodo))].sort((a, b) => a === "Todo" ? -1 : b === "Todo" ? 1 : a.localeCompare(b));
  segmentado("anio", anios.map(a => [a, a === "Todo" ? "Todo" : a]));
  segmentado("canal", [["Todos", "Todos"], [ONLINE, "Online"], [TIENDAS, "Tiendas físicas"]]);
  const provincias = filas("mart_ventas", { periodo: "Todo", canal: "Todos" })
    .filter(r => r.provincia !== "Todas").sort((a, b) => a.ranking_provincia - b.ranking_provincia).map(r => r.provincia);
  $("f-provincia").innerHTML = ["Todas", ...provincias].map(p => `<option value="${p}">${p === "Todas" ? "Todas las provincias" : p}</option>`).join("");
  $("f-provincia").addEventListener("change", e => cambiar({ provincia: e.target.value }));
  $("f-mes").addEventListener("change", e => cambiar({ mes: e.target.value }));
  $("restablecer").addEventListener("click", () => cambiar({ anio: "Todo", mes: "", canal: "Todos", provincia: "Todas" }));
}
function segmentado(nombre, opciones) {
  const cont = document.querySelector(`.segmentado[data-filtro="${nombre}"]`);
  cont.innerHTML = opciones.map(([v, t]) => `<button type="button" data-valor="${v}" aria-pressed="false">${t}</button>`).join("");
  cont.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const cambio = { [nombre]: b.dataset.valor };
    if (nombre === "anio") cambio.mes = "";
    cambiar(cambio);
  });
}
function sincronizarFiltros() {
  document.querySelectorAll(".segmentado").forEach(seg => {
    const valor = estado[seg.dataset.filtro];
    seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.valor === valor)));
    seg.classList.toggle("activo", valor !== "Todo" && valor !== "Todos");
  });
  const mesesDisponibles = filas("mart_ventas", { periodo_tipo: "mes", canal: "Todos", provincia: "Todas" })
    .map(r => r.periodo).filter(p => estado.anio === "Todo" || p.startsWith(estado.anio)).sort();
  const sel = $("f-mes");
  sel.innerHTML = `<option value="">Todos los meses</option>` +
    mesesDisponibles.map(p => `<option value="${p}">${capital(etiquetaPeriodo(p))}</option>`).join("");
  sel.value = estado.mes;
  sel.classList.toggle("activo", !!estado.mes);
  $("f-provincia").value = estado.provincia;
  $("f-provincia").classList.toggle("activo", estado.provincia !== "Todas");
  $("restablecer").disabled = estado.anio === "Todo" && !estado.mes && estado.canal === "Todos" && estado.provincia === "Todas";

  const partes = [`<strong>${capital(etiquetaPeriodo(periodo()))}</strong>`];
  partes.push(estado.canal === "Todos" ? "todos los canales" : corto(estado.canal).toLowerCase());
  partes.push(estado.provincia === "Todas" ? "todas las provincias" : estado.provincia);
  document.querySelectorAll(".estado-filtros").forEach(p => { p.innerHTML = `Mostrando: ${partes.join(", ")}.`; });
}
function cambiar(cambios) {
  Object.assign(estado, cambios);
  if (cambios.mes && !cambios.anio) estado.anio = cambios.mes.slice(0, 4);
  ocultarTooltip();
  dibujar();
}

/* ---------------------------------------------------------------------
   Pestañas
   --------------------------------------------------------------------- */
const TABS = ["resumen", "operacion", "clientes"];
function mostrarTab(tab, enfocar = false) {
  if (!TABS.includes(tab)) tab = "resumen";
  estado.tab = tab;
  document.querySelectorAll(".pestanas button").forEach(b => {
    const activa = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(activa));
    b.tabIndex = activa ? 0 : -1;
  });
  document.querySelectorAll(".pagina").forEach(p => { p.hidden = p.id !== `pag-${tab}`; });
  // guarda la pestaña en el link (#resumen); algunos visores embebidos no lo permiten
  try { if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`); } catch (e) { /* sin historial */ }
  dibujar();
  if (enfocar) $(`tab-${tab}`).focus();
}
function armarPestanas() {
  const botones = [...document.querySelectorAll(".pestanas button")];
  botones.forEach((b, i) => {
    b.addEventListener("click", () => {
      mostrarTab(b.dataset.tab);
      const tope = $("portada").offsetHeight;
      if (window.scrollY > tope) window.scrollTo({ top: tope, behavior: SIN_MOVIMIENTO ? "auto" : "smooth" });
    });
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const j = (i + (e.key === "ArrowRight" ? 1 : -1) + botones.length) % botones.length;
      mostrarTab(botones[j].dataset.tab, true);
    });
  });
  window.addEventListener("hashchange", () => mostrarTab(location.hash.slice(1)));
}

/* ---------------------------------------------------------------------
   KPIs
   --------------------------------------------------------------------- */
function tarjetas(cont, items) {
  cont.innerHTML = items.map(k => `
    <div class="kpi">
      <span class="kpi-nombre">${k.nombre}</span>
      <span class="kpi-valor">${k.valor}</span>
      ${k.nota ? `<span class="kpi-nota">${k.nota}</span>` : ""}
      ${k.serie ? chispa(k.serie, k.marcado ?? -1) : ""}
    </div>`).join("");
}
/** Valores mensuales de una columna y posición del mes elegido, para la sparkline. */
function serie(filasMes, col) {
  return { serie: filasMes.map(r => r[col]), marcado: estado.mes ? filasMes.findIndex(r => r.periodo === estado.mes) : -1 };
}

/* =====================================================================
   PESTAÑA 1: Resumen comercial
   ===================================================================== */
function dibujarResumen() {
  const v = fila("mart_ventas", ctx());
  const u = fila("mart_usuarios", { periodo: periodo() });
  const n = fila("mart_nps", { periodo: periodo(), canal: estado.canal });
  const mesesV = meses("mart_ventas", { canal: estado.canal, provincia: estado.provincia });
  const mesesU = meses("mart_usuarios");
  const mesesN = meses("mart_nps", { canal: estado.canal });

  // Botella grande
  const fig = $("botella-total");
  if (!fig.querySelector("svg")) {
    fig.innerHTML = crearBotella({ colores: ["var(--agua-tiendas)", "var(--agua-online)"], burbujas: 12 }) + `<figcaption></figcaption>`;
  }
  const svg = fig.querySelector("svg");
  despues(() => llenarBotella(svg, v ? [v.nivel_total, v.nivel_total_online] : [0, 0]));
  fig.querySelector("figcaption").innerHTML = v ? `
    <span class="cifra">${millones(v.ventas)}</span>
    <span>Es el <b>${pct(v.pct_del_total)}</b> de todo lo que vendió EcoBottle en el período.</span>
    <span class="capa-dato"><i style="background:var(--agua-online)"></i>Online: <b>${millones(v.ventas_online)}</b></span>
    <span class="capa-dato"><i style="background:var(--agua-tiendas)"></i>Tiendas físicas: <b>${millones(v.ventas_tiendas)}</b></span>`
    : `<span>No hay ventas para esta selección.</span>`;

  tarjetas($("kpis-resumen"), [
    { nombre: "Total ventas", valor: millones2(v?.ventas), ...serie(mesesV, "ventas") },
    { nombre: "Ticket promedio", valor: pesos(v?.ticket_promedio), nota: v ? `${entero(v.pedidos_venta)} pedidos que son venta` : "", ...serie(mesesV, "ticket_promedio") },
    { nombre: "Usuarios activos", valor: entero(u?.usuarios_activos), nota: u ? `${entero(u.usuarios_identificados)} identificados y ${entero(u.usuarios_anonimos)} anónimos` : "", ...serie(mesesU, "usuarios_activos") },
    { nombre: "NPS", valor: dec(n?.nps), nota: n ? `${entero(n.respuestas)} respuestas${estado.provincia !== "Todas" ? ", sin filtro de provincia" : ""}` : "", ...serie(mesesN, "nps") },
  ]);

  dibujarGondola(mesesV);

  dibujarUsuarios(u, mesesU);

  dibujarProvincias();
  dibujarProductos();

  const t = fila("mart_ventas", { periodo: "Todo", canal: "Todos", provincia: "Todas" });
  const mejor = filas("mart_ventas", { periodo_tipo: "mes", canal: "Todos", provincia: "Todas" }).find(r => r.es_mejor_mes);
  const lider = fila("mart_ventas", { periodo: "Todo", canal: "Todos", ranking_provincia: 1 });
  $("hallazgos-resumen").innerHTML = hallazgos([
    ["Ventas", `<strong>${capital(etiquetaPeriodo(mejor.periodo))} fue el mejor mes:</strong> ${millones(mejor.ventas)}, un ${pct(mejor.pct_vs_promedio)} más que un mes promedio (${millones(mejor.promedio_mensual)}).`],
    ["Canales", `<strong>La tienda online genera el ${pct(t.pct_online)} de las ventas</strong> y vende más que las cuatro tiendas físicas juntas.`],
    ["Provincias", `<strong>${lider.provincia} lidera con el ${pct(lider.pct_provincia)}</strong> de las ventas del período.`],
  ]);
}

function dibujarGondola(mesesV) {
  const cont = $("gondola");
  if (!mesesV.length) { cont.innerHTML = `<p class="sin-datos">No hay ventas para esta selección.</p>`; cont.dataset.claves = ""; $("leyenda-gondola").innerHTML = ""; return; }
  const claves = mesesV.map(r => r.periodo).join();
  if (cont.dataset.claves !== claves) {
    cont.dataset.claves = claves;
    cont.style.setProperty("--meses", mesesV.length);
    cont.innerHTML = mesesV.map(r => `
      <button type="button" class="mes-botella" role="listitem" data-periodo="${r.periodo}">
        ${crearBotella({ colores: ["var(--agua-tiendas)", "var(--agua-online)"] })}
        <span class="mes-nombre">${mesCorto(r.periodo)}</span>
        <span class="mes-anio">${r.periodo.slice(2, 4)}</span>
      </button>`).join("") + `<div class="linea-promedio"></div>`;
    cont.querySelectorAll(".mes-botella").forEach(b => b.addEventListener("click", () =>
      cambiar({ mes: estado.mes === b.dataset.periodo ? "" : b.dataset.periodo })));
  }
  cont.classList.toggle("con-seleccion", !!estado.mes);
  cont.querySelectorAll(".mes-botella").forEach(b => {
    const r = mesesV.find(x => x.periodo === b.dataset.periodo);
    b.classList.toggle("elegido", r.periodo === estado.mes);
    b.querySelector(".corona")?.remove();
    if (r.es_mejor_mes) b.insertAdjacentHTML("beforeend", `<span class="corona">Récord</span>`);
    b.setAttribute("aria-label", `${capital(etiquetaPeriodo(r.periodo))}: ${millones(r.ventas)}. Tocar para filtrar.`);
    b.setAttribute("aria-pressed", String(r.periodo === estado.mes));
    despues(() => llenarBotella(b.querySelector("svg"), [r.nivel_mes, r.nivel_mes_online], r.es_mejor_mes ? "var(--sol)" : "var(--tinta)"));
    conTooltip(b, `<strong>${capital(etiquetaPeriodo(r.periodo))}</strong>
      Ventas: ${millones(r.ventas)}<br>Online: ${millones(r.ventas_online)}<br>Tiendas físicas: ${millones(r.ventas_tiendas)}<br>
      Pedidos: ${entero(r.pedidos_venta)}<br>Frente al promedio: ${r.pct_vs_promedio > 0 ? "+" : ""}${pct(r.pct_vs_promedio)}`);
  });
  const ubicar = () => {
    const svg = cont.querySelector(".mes-botella svg");
    const linea = cont.querySelector(".linea-promedio");
    if (!svg || !linea) return;
    const rc = cont.getBoundingClientRect(), rs = svg.getBoundingClientRect();
    const escala = rs.height / 266;
    linea.style.top = `${rs.top - rc.top + (FONDO - mesesV[0].nivel_promedio * ALTO_UTIL + 4) * escala}px`;
  };
  ubicar();
  if (!cont.__resize) { cont.__resize = true; window.addEventListener("resize", () => cont.__ubicar?.()); }
  cont.__ubicar = ubicar;
  $("leyenda-gondola").innerHTML = `
    <span><i style="background:var(--agua-online)"></i>Online</span>
    <span><i style="background:var(--agua-tiendas)"></i>Tiendas físicas</span>
    <span><i class="raya"></i>Mes promedio de ene 2024 a sep 2025 para este canal y provincia: ${millones(mesesV[0].promedio_mensual)}</span>`;
}

/**
 * Columnas apiladas por mes. capas: [{col, color}] de abajo hacia arriba;
 * col es la columna del mart con el nivel (0 a 1) de esa capa.
 * total: columna con el nivel de la columna entera.
 */
function columnasApiladas(cont, mesesF, { total, capas, tip, salto = 1 }) {
  if (!mesesF.length) { cont.innerHTML = `<p class="sin-datos">No hay datos para esta selección.</p>`; cont.dataset.claves = ""; return; }
  const claves = mesesF.map(r => r.periodo).join() + capas.map(c => c.col).join();
  if (cont.dataset.claves !== claves) {
    cont.dataset.claves = claves;
    cont.innerHTML = mesesF.map((r, i) => `
      <button type="button" class="columna" data-periodo="${r.periodo}">
        <span class="columna-barras"><span class="barra barra-apilada">
          ${capas.map(c => `<span data-col="${c.col}" style="background:${c.color}"></span>`).join("")}
        </span></span>
        <span class="columna-nombre">${i % salto ? "&nbsp;" : mesCorto(r.periodo) + (r.periodo.endsWith("-01") || i === 0 ? ` ${r.periodo.slice(2, 4)}` : "")}</span>
      </button>`).join("");
    cont.querySelectorAll(".columna").forEach(c => c.addEventListener("click", () =>
      cambiar({ mes: estado.mes === c.dataset.periodo ? "" : c.dataset.periodo })));
  }
  cont.classList.toggle("con-seleccion", !!estado.mes);
  cont.querySelectorAll(".columna").forEach(c => {
    const r = mesesF.find(x => x.periodo === c.dataset.periodo);
    c.classList.toggle("elegido", r.periodo === estado.mes);
    c.setAttribute("aria-label", `${capital(etiquetaPeriodo(r.periodo))}. Tocar para filtrar.`);
    const barra = c.querySelector(".barra");
    despues(() => {
      barra.style.height = `${r[total] * 100}%`;
      barra.querySelectorAll("[data-col]").forEach(sp => { sp.style.flexGrow = r[sp.dataset.col]; });
    });
    conTooltip(c, tip(r));
  });
}

function dibujarUsuarios(u, mesesU) {
  $("usuarios-resumen").innerHTML = u ? `
    <div><i style="background:var(--agua-online)"></i><b>Identificados</b> ${entero(u.usuarios_identificados)} (${pct(u.pct_identificados)})</div>
    <div><i style="background:var(--agua-tiendas)"></i><b>Anónimos</b> ${entero(u.usuarios_anonimos)} (${pct(u.pct_anonimos)})</div>
    <div><b>Total</b> ${entero(u.usuarios_activos)}</div>` : "";
  columnasApiladas($("columnas-usuarios"), mesesU, {
    total: "nivel_mes",
    capas: [{ col: "nivel_mes_identificados", color: "var(--agua-online)" }, { col: "nivel_mes_anonimos", color: "var(--agua-tiendas)" }],
    salto: mesesU.length > 12 ? 3 : 1,
    tip: r => `<strong>${capital(etiquetaPeriodo(r.periodo))}</strong>Total: ${entero(r.usuarios_activos)}<br>Identificados: ${entero(r.usuarios_identificados)} (${pct(r.pct_identificados)})<br>Anónimos: ${entero(r.usuarios_anonimos)} (${pct(r.pct_anonimos)})<br>Sesiones: ${entero(r.sesiones)}`,
  });
  $("leyenda-usuarios").innerHTML = `<span><i style="background:var(--agua-online)"></i>Identificados: clientes que iniciaron sesión</span><span><i style="background:var(--agua-tiendas)"></i>Anónimos: cada visita sin sesión</span>`;
}

function dibujarProvincias() {
  const ol = $("provincias");
  const provs = filas("mart_ventas", { periodo: periodo(), canal: estado.canal })
    .filter(r => r.provincia !== "Todas").sort((a, b) => a.ranking_provincia - b.ranking_provincia);
  if (!provs.length) { ol.innerHTML = `<li class="sin-datos">No hay ventas para esta selección.</li>`; return; }
  const claves = provs.map(p => p.provincia).join();
  if (ol.dataset.claves !== claves) {
    ol.dataset.claves = claves;
    ol.innerHTML = provs.map(p => `
      <li><button type="button" class="cano-fila" data-provincia="${p.provincia}">
        <span class="cano-rank"></span>
        <span><span class="cano-top"><span>${p.provincia}</span><span class="cano-dato"></span></span>
        <span class="cano" style="display:block"><span class="cano-agua" style="display:block"></span></span></span>
      </button></li>`).join("");
    ol.querySelectorAll(".cano-fila").forEach(b => b.addEventListener("click", () =>
      cambiar({ provincia: estado.provincia === b.dataset.provincia ? "Todas" : b.dataset.provincia })));
  }
  ol.classList.toggle("con-seleccion", estado.provincia !== "Todas");
  ol.querySelectorAll(".cano-fila").forEach(b => {
    const p = provs.find(x => x.provincia === b.dataset.provincia);
    b.classList.toggle("elegido", p.provincia === estado.provincia);
    b.setAttribute("aria-pressed", String(p.provincia === estado.provincia));
    b.querySelector(".cano-rank").textContent = p.ranking_provincia;
    b.querySelector(".cano-dato").textContent = `${millones(p.ventas)} (${pct(p.pct_provincia)})`;
    despues(() => { b.querySelector(".cano-agua").style.width = `${p.nivel_provincia * 100}%`; });
    conTooltip(b, `<strong>${p.provincia}</strong>Ventas: ${millones(p.ventas)}<br>Pedidos: ${entero(p.pedidos_venta)}<br>Ticket promedio: ${pesos(p.ticket_promedio)}<br>Peso en la selección: ${pct(p.pct_provincia)}`);
  });
}

function dibujarProductos() {
  const COLORES = ["var(--agua-online)", "var(--agua-tiendas)"];
  const todos = meses("mart_productos", { canal: estado.canal, provincia: estado.provincia });
  const productos = [...new Set(D.mart_productos.map(r => r.producto))].sort().reverse();
  const periodos = [...new Set(todos.map(r => r.periodo))];

  // Resumen del período elegido
  const actual = filas("mart_productos", ctx()).sort((a, b) => a.ranking - b.ranking);
  $("producto-resumen").innerHTML = actual.length ? actual.map(r => `
    <div><span class="puesto ${r.ranking === 1 ? "primero" : ""}">Puesto ${r.ranking}</span>
      <i style="background:${COLORES[productos.indexOf(r.producto)]}"></i>
      <b>${r.producto}</b> ${millones(r.ventas)} (${pct(r.pct_del_periodo)}), ${entero(r.unidades)} unidades</div>`).join("")
    : `<p class="sin-datos">No hay ventas para esta selección.</p>`;

  const cont = $("columnas-productos");
  const claves = periodos.join();
  if (cont.dataset.claves !== claves) {
    cont.dataset.claves = claves;
    cont.innerHTML = periodos.map(p => `
      <button type="button" class="columna" data-periodo="${p}">
        <span class="columna-barras">${productos.map((pr, i) => `<span class="barra" data-producto="${pr}" style="background:${COLORES[i]}"></span>`).join("")}</span>
        <span class="columna-nombre">${mesCorto(p)}${p.endsWith("-01") || p === periodos[0] ? ` ${p.slice(2, 4)}` : ""}</span>
      </button>`).join("");
    cont.querySelectorAll(".columna").forEach(c => c.addEventListener("click", () =>
      cambiar({ mes: estado.mes === c.dataset.periodo ? "" : c.dataset.periodo })));
  }
  cont.classList.toggle("con-seleccion", !!estado.mes);
  cont.querySelectorAll(".columna").forEach(c => {
    const delMes = todos.filter(r => r.periodo === c.dataset.periodo);
    c.classList.toggle("elegido", c.dataset.periodo === estado.mes);
    c.querySelectorAll(".barra").forEach(b => {
      const r = delMes.find(x => x.producto === b.dataset.producto);
      b.innerHTML = r && r.ranking === 1 ? `<span class="gota-ganador"></span>` : "";
      despues(() => { b.style.height = `${(r ? r.nivel_mes : 0) * 100}%`; });
    });
    conTooltip(c, `<strong>${capital(etiquetaPeriodo(c.dataset.periodo))}</strong>` +
      delMes.sort((a, b) => a.ranking - b.ranking).map(r => `${r.ranking}. ${r.producto}: ${millones(r.ventas)} (${pct(r.pct_del_periodo)})`).join("<br>"));
  });
  $("leyenda-productos").innerHTML = productos.map((p, i) => `<span><i style="background:${COLORES[i]}"></i>${p}</span>`).join("")
    + `<span><i style="background:var(--sol);border-radius:50% 50% 50% 50% / 60% 60% 40% 40%"></i>Ganador del mes</span>`;
}

/* =====================================================================
   PESTAÑA 2: Clientes y operación
   ===================================================================== */
function dibujarOperacion() {
  const u = fila("mart_usuarios", { periodo: periodo() });
  const pg = fila("mart_pagos", ctx({ metodo: "Todos" }));
  const en = fila("mart_entregas", ctx());
  const mesesU = meses("mart_usuarios");
  const mesesP = meses("mart_pagos", { canal: estado.canal, provincia: estado.provincia, metodo: "Todos" });
  const mesesE = meses("mart_entregas", { canal: estado.canal, provincia: estado.provincia });

  tarjetas($("kpis-operacion"), [
    { nombre: "Sesiones", valor: entero(u?.sesiones), nota: "Solo se filtra por período", ...serie(mesesU, "sesiones") },
    { nombre: "Sesiones identificadas", valor: pct(u?.pct_identificadas), nota: u ? `${entero(u.sesiones_identificadas)} con cliente logueado` : "", ...serie(mesesU, "pct_identificadas") },
    { nombre: "Pagos fallidos", valor: pct(pg?.tasa_fallos), nota: pg ? `${entero(pg.fallidos)} de ${entero(pg.pagos)} pagos` : "Sin pagos en la selección", ...serie(mesesP, "tasa_fallos") },
    { nombre: "Días promedio de entrega", valor: dec(en?.dias_promedio), nota: en ? `${entero(en.envios_entregados)} envíos entregados` : "Sin envíos en la selección", ...serie(mesesE, "dias_promedio") },
  ]);

  // Tráfico por origen y dispositivo
  const COL_DISP = { Celular: "var(--agua-online)", Computadora: "var(--agua-tiendas)", Tablet: "var(--sol)" };
  const DISP_OSCURO = { Computadora: true, Tablet: true };
  const traf = filas("mart_trafico", { periodo: periodo() });
  const origenes = [...new Set(traf.map(r => r.origen))];
  const disp = Object.keys(COL_DISP);
  $("leyenda-trafico").innerHTML = disp.map(d => `<span><i style="background:${COL_DISP[d]}"></i>${d}</span>`).join("");
  apiladas($("trafico"), origenes.map(o => {
    const partes = traf.filter(r => r.origen === o);
    return {
      clave: o, titulo: o, dato: `${entero(partes[0].sesiones_origen)} sesiones`, ancho: partes[0].nivel_origen,
      segmentos: disp.map(d => { const p = partes.find(x => x.dispositivo === d); return { valor: p ? p.pct_del_origen : 0, color: COL_DISP[d], texto: p && p.pct_del_origen >= 12 ? pct(p.pct_del_origen) : "", oscuro: !!DISP_OSCURO[d] }; }),
      tip: `<strong>${o}</strong>Campaña: ${partes[0].campania}<br>` + partes.map(p => `${p.dispositivo}: ${entero(p.sesiones)} (${pct(p.pct_del_origen)})`).join("<br>"),
    };
  }));

  // Pagos por medio
  const pagos = filas("mart_pagos", ctx()).filter(r => r.metodo !== "Todos").sort((a, b) => b.pagos - a.pagos);
  const ulp = $("pagos");
  const gota = `<svg viewBox="0 0 20 26" aria-hidden="true"><path d="M10 1 C10 1 2 11 2 16.5 A8 8 0 0 0 18 16.5 C18 11 10 1 10 1Z"/></svg>`;
  ulp.innerHTML = pagos.length ? pagos.map(p => `
    <li class="${p.fallidos > 0 ? "gotea" : "sin-fallos"}">
      <span class="nombre">${p.metodo}</span>
      <span class="pista"><span class="cuerpo" data-ancho="${p.nivel * 100}"><b>${entero(p.pagos)}</b></span></span>
      <span class="fallo">${gota}${pct(p.tasa_fallos)}</span>
    </li>`).join("") : `<li class="sin-datos">No hay pagos para esta selección.</li>`;
  ulp.querySelectorAll("li").forEach((li, i) => pagos[i] && conTooltip(li,
    `<strong>${pagos[i].metodo}</strong>${entero(pagos[i].pagos)} pagos<br>${entero(pagos[i].fallidos)} fallidos (${pct(pagos[i].tasa_fallos)})`));
  despues(() => ulp.querySelectorAll(".cuerpo").forEach(c => { c.style.width = `${Math.max(8, c.dataset.ancho)}%`; }));

  // Entregas por provincia
  const ent = filas("mart_entregas", { periodo: periodo(), canal: estado.canal }).filter(r => r.provincia !== "Todas")
    .sort((a, b) => b.dias_promedio - a.dias_promedio);
  const prom = fila("mart_entregas", { periodo: periodo(), canal: estado.canal, provincia: "Todas" });
  const cont = $("columnas-entregas");
  const TOPE = 8; // eje fijo en días
  cont.classList.toggle("con-seleccion", estado.provincia !== "Todas");
  cont.innerHTML = ent.length ? ent.map(r => `
    <button type="button" class="columna ${r.es_mas_lenta ? "lenta" : ""} ${r.provincia === estado.provincia ? "elegido" : ""}" data-provincia="${r.provincia}">
      <span class="columna-barras"><span class="barra" data-alto="${(r.dias_promedio / TOPE) * 100}" style="max-width:64px;background:${r.es_mas_lenta ? "var(--alerta)" : "var(--agua-online)"}"><span class="barra-valor">${dec(r.dias_promedio)}</span></span></span>
      <span class="columna-nombre">${r.provincia}</span>
    </button>`).join("") + (prom ? `<div class="linea-ref"><span>Promedio: ${dec(prom.dias_promedio)} días</span></div>` : "")
    : `<p class="sin-datos">No hay envíos para esta selección.</p>`;
  const barras = cont.querySelector(".columna-barras"), ref = cont.querySelector(".linea-ref");
  if (barras && ref) {
    const rc = cont.getBoundingClientRect(), rb = barras.getBoundingClientRect();
    ref.style.top = `${rb.bottom - rc.top - (prom.dias_promedio / TOPE) * rb.height}px`;
  }
  cont.querySelectorAll(".columna").forEach(c => {
    const r = ent.find(x => x.provincia === c.dataset.provincia);
    c.addEventListener("click", () => cambiar({ provincia: estado.provincia === r.provincia ? "Todas" : r.provincia }));
    conTooltip(c, `<strong>${r.provincia}</strong>${dec(r.dias_promedio)} días promedio<br>${entero(r.envios_entregados)} envíos entregados${r.es_mas_lenta ? "<br>La más lenta de la selección" : ""}`);
  });
  despues(() => cont.querySelectorAll(".barra").forEach(b => { b.style.height = `${b.dataset.alto}%`; }));

  // NPS por canal
  const COL_NPS = { pct_promotores: "var(--agua-online)", pct_pasivos: "var(--agua-tiendas)", pct_detractores: "var(--alerta)" };
  const npsCanales = [fila("mart_nps", { periodo: periodo(), canal: ONLINE }), fila("mart_nps", { periodo: periodo(), canal: TIENDAS }), fila("mart_nps", { periodo: periodo(), canal: "Todos" })].filter(Boolean);
  $("leyenda-nps").innerHTML = `<span><i style="background:${COL_NPS.pct_promotores}"></i>Promotores (9 a 10)</span><span><i style="background:${COL_NPS.pct_pasivos}"></i>Pasivos (7 a 8)</span><span><i style="background:${COL_NPS.pct_detractores}"></i>Detractores (0 a 6)</span>`;
  apiladas($("nps-canales"), npsCanales.map(r => ({
    clave: r.canal, titulo: r.canal === "Todos" ? "Todos los canales" : r.canal, dato: `NPS ${dec(r.nps)}`, ancho: 1,
    elegido: estado.canal !== "Todos" && r.canal === estado.canal, atenuado: estado.canal !== "Todos" && r.canal !== estado.canal,
    segmentos: Object.keys(COL_NPS).map(k => ({ valor: r[k], color: COL_NPS[k], texto: r[k] >= 10 ? pct(r[k]) : "", oscuro: k === "pct_pasivos" })),
    tip: `<strong>${r.canal === "Todos" ? "Todos los canales" : r.canal}</strong>NPS: ${dec(r.nps)}<br>Promotores: ${pct(r.pct_promotores)}<br>Pasivos: ${pct(r.pct_pasivos)}<br>Detractores: ${pct(r.pct_detractores)}<br>${entero(r.respuestas)} respuestas`,
  })));

  // NPS mes a mes
  const mesesN = meses("mart_nps", { canal: estado.canal });
  const npsSel = fila("mart_nps", { periodo: estado.anio, canal: estado.canal });
  const minimo = mesesN.find(r => r.es_minimo);
  graficoLinea($("linea-nps"), mesesN.map(r => ({
    periodo: r.periodo, valor: r.nps,
    clase: [r.es_minimo ? "minimo" : "", r.periodo === estado.mes ? "elegido" : ""].join(" "),
    nota: r === minimo ? `${mesCorto(r.periodo)} ${r.periodo.slice(0, 4)}: ${dec(r.nps)}` : "", notaAbajo: true, notaColor: "var(--alerta)",
    tip: `<strong>${capital(etiquetaPeriodo(r.periodo))}</strong>NPS: ${dec(r.nps)}<br>Promotores: ${pct(r.pct_promotores)}<br>Pasivos: ${pct(r.pct_pasivos)}<br>Detractores: ${pct(r.pct_detractores)}<br>${entero(r.respuestas)} respuestas`,
    aria: `${etiquetaPeriodo(r.periodo)}: NPS ${dec(r.nps)}`,
  })), { min: 0, max: 60, pasos: 6, alto: 280, ref: { valor: npsSel?.nps }, titulo: "NPS mensual",
    onClick: p => cambiar({ mes: estado.mes === p.periodo ? "" : p.periodo }) });
  const lineaNps = $("linea-nps");
  if (npsSel) lineaNps.insertAdjacentHTML("beforeend", `<div class="leyenda"><span><i class="raya"></i>NPS de ${etiquetaPeriodo(estado.anio)}: ${dec(npsSel.nps)}</span><span><i style="background:var(--alerta);border-radius:50%"></i>Mes más bajo</span></div>`);

  // Hallazgos (período completo)
  const pTodo = filas("mart_pagos", { periodo: "Todo", canal: "Todos", provincia: "Todas" }).filter(r => r.metodo !== "Todos").sort((a, b) => b.tasa_fallos - a.tasa_fallos);
  const ads = fila("mart_trafico", { periodo: "Todo", origen: "Anuncios", dispositivo: "Celular" });
  const e24 = fila("mart_entregas", { periodo: "2024", canal: "Todos", provincia: "Todas" });
  const e25 = fila("mart_entregas", { periodo: "2025", canal: "Todos", provincia: "Todas" });
  const lenta = fila("mart_entregas", { periodo: "2025", canal: "Todos", es_mas_lenta: 1 });
  $("hallazgos-operacion").innerHTML = hallazgos([
    ["Pagos", `<strong>${pTodo[0].metodo} falla en el ${pct(pTodo[0].tasa_fallos)} de los cobros,</strong> más del doble que ${pTodo[1].metodo.toLowerCase()} (${pct(pTodo[1].tasa_fallos)}).`],
    ["Marketing", ads ? `<strong>El ${pct(ads.pct_del_origen)} del tráfico de anuncios llega desde el celular:</strong> la experiencia mobile es clave para las campañas.` : ""],
    ["Entregas", `<strong>Los envíos bajaron de ${dec(e24?.dias_promedio)} a ${dec(e25?.dias_promedio)} días en 2025,</strong> pero ${lenta?.provincia} sigue siendo la provincia más lenta.`],
  ]);
}

/** Barras horizontales apiladas. items: [{titulo, dato, ancho (0-1), segmentos:[{valor, color, texto}], tip}] */
function apiladas(ul, items) {
  ul.innerHTML = items.length ? items.map(it => `
    <li class="${it.elegido ? "elegido" : ""} ${it.atenuado ? "atenuado" : ""}" tabindex="0">
      <div class="fila-titulo"><span>${it.titulo}</span><span>${it.dato}</span></div>
      <div class="apilada-pista"><div class="apilada" data-ancho="${it.ancho * 100}">
        ${it.segmentos.map(s => `<span data-crece="${s.valor}" class="${s.oscuro ? "oscuro" : ""}" style="background:${s.color}">${s.texto || ""}</span>`).join("")}
      </div></div>
    </li>`).join("") : `<li class="sin-datos">No hay datos para esta selección.</li>`;
  ul.querySelectorAll("li").forEach((li, i) => items[i] && conTooltip(li, items[i].tip));
  despues(() => {
    ul.querySelectorAll(".apilada").forEach(a => { a.style.width = `${a.dataset.ancho}%`; });
    ul.querySelectorAll("[data-crece]").forEach(s => { s.style.flexGrow = s.dataset.crece; });
  });
}

/* =====================================================================
   PESTAÑA 3: Ventas netas y clientes
   ===================================================================== */
function dibujarClientes() {
  const v = fila("mart_ventas", ctx());
  const mesesV = meses("mart_ventas", { canal: estado.canal, provincia: estado.provincia });
  const per = D.mart_periodo[0];

  tarjetas($("kpis-clientes"), [
    { nombre: "Venta neta", valor: millones2(v?.venta_neta), nota: "Productos más envíos, sin IVA", ...serie(mesesV, "venta_neta") },
    { nombre: "IVA", valor: millones2(v?.iva), nota: v ? `$${fmt0.format(v.iva_de_100)} de cada $100 vendidos` : "", ...serie(mesesV, "iva") },
    { nombre: "Envíos", valor: millones2(v?.envios), nota: v ? `$${fmt0.format(v.envio_de_100)} de cada $100 vendidos` : "", ...serie(mesesV, "envios") },
    { nombre: "Pedidos que son venta", valor: pct(v?.pct_pedidos_venta), nota: v ? `${entero(v.pedidos_venta)} de ${entero(v.pedidos_totales)} pedidos` : "", ...serie(mesesV, "pct_pedidos_venta") },
    { nombre: "Clientes recurrentes", valor: pct(per.pct_clientes_recurrentes), nota: "Período completo, sin filtros" },
  ]);

  // Estados
  const COL_EST = { Entregado: "var(--agua-online)", Pagado: "var(--agua-tiendas)", Cancelado: "var(--alerta)", Reembolsado: "var(--alerta-suave)", Creado: "var(--tinta-suave)" };
  const est = filas("mart_estados", ctx()).sort((a, b) => a.orden - b.orden);
  const ule = $("estados");
  ule.innerHTML = est.length ? est.map(e => `
    <li tabindex="0">
      <span class="nombre"><i style="background:${e.es_venta ? "var(--agua-online)" : "var(--linea)"}"></i>${e.estado}</span>
      <span class="pista"><span class="cuerpo" data-ancho="${e.nivel * 72}" style="background:${COL_EST[e.estado]}"></span>
      <span class="dato"><b>${entero(e.pedidos)}</b> (${pct(e.pct_pedidos)})<br>${millones(e.monto)}</span></span>
    </li>`).join("") : `<li class="sin-datos">No hay pedidos para esta selección.</li>`;
  ule.querySelectorAll("li").forEach((li, i) => est[i] && conTooltip(li,
    `<strong>${est[i].estado}</strong>${entero(est[i].pedidos)} pedidos (${pct(est[i].pct_pedidos)})<br>Monto: ${millones(est[i].monto)}<br>${est[i].es_venta ? "Cuenta como venta" : "No cuenta como venta"}`));
  despues(() => ule.querySelectorAll(".cuerpo").forEach(c => { c.style.width = `${c.dataset.ancho}%`; }));

  // Canales: dos botellas
  const duelo = $("duelo-canales");
  const canales = [ONLINE, TIENDAS].map(c => fila("mart_ventas", { periodo: periodo(), canal: c, provincia: estado.provincia }));
  if (!duelo.querySelector(".duelo-item")) {
    duelo.innerHTML = [ONLINE, TIENDAS].map((c, i) => `
      <button type="button" class="duelo-item" data-canal="${c}">
        ${crearBotella({ colores: [i === 0 ? "var(--agua-online)" : "var(--agua-tiendas)"] })}
        <div class="duelo-nombre">${corto(c)}</div>
        <div class="duelo-dato"></div>
      </button>`).join("");
    duelo.querySelectorAll(".duelo-item").forEach(b => b.addEventListener("click", () =>
      cambiar({ canal: estado.canal === b.dataset.canal ? "Todos" : b.dataset.canal })));
  }
  duelo.classList.toggle("con-seleccion", estado.canal !== "Todos");
  duelo.querySelectorAll(".duelo-item").forEach((b, i) => {
    const r = canales[i];
    b.classList.toggle("elegido", b.dataset.canal === estado.canal);
    b.setAttribute("aria-pressed", String(b.dataset.canal === estado.canal));
    despues(() => llenarBotella(b.querySelector("svg"), [r ? r.nivel_canal : 0]));
    b.querySelector(".duelo-dato").innerHTML = r
      ? `<strong>${millones(r.ventas)}</strong><br>${pct(r.pct_canal)} de las ventas<br>Ticket: ${pesos(r.ticket_promedio)}`
      : "Sin ventas";
  });

  // Qué hay dentro de cada venta, mes a mes
  columnasApiladas($("columnas-neta"), mesesV, {
    total: "nivel_mes",
    capas: [
      { col: "nivel_mes_productos", color: "var(--agua-online)" },
      { col: "nivel_mes_envios", color: "var(--agua-tiendas)" },
      { col: "nivel_mes_iva", color: "var(--sol)" },
    ],
    tip: r => `<strong>${capital(etiquetaPeriodo(r.periodo))}</strong>Total cobrado: ${millones(r.ventas)}<br>Productos: ${millones(r.productos)}<br>Envíos: ${millones(r.envios)}<br>IVA: ${millones(r.iva)}`,
  });
  $("leyenda-neta").innerHTML = `<span><i style="background:var(--agua-online)"></i>Productos</span><span><i style="background:var(--agua-tiendas)"></i>Envíos</span><span><i style="background:var(--sol)"></i>IVA</span>`;

  // Activos e inactivos
  const COL_PROD = ["var(--agua-online)", "var(--agua-tiendas)"];
  const comp = filas("mart_compras_estado_cliente", ctx());
  const prods = [...new Set(D.mart_compras_estado_cliente.map(r => r.producto))].sort().reverse();
  $("leyenda-activos").innerHTML = prods.map((p, i) => `<span><i style="background:${COL_PROD[i]}"></i>${p}</span>`).join("");
  apiladas($("activos-inactivos"), ["Activos", "Inactivos"].map(e => {
    const partes = comp.filter(r => r.estado_cliente === e);
    if (!partes.length) return null;
    return {
      titulo: `Clientes ${e.toLowerCase()}`, dato: "", ancho: 1,
      segmentos: prods.map((p, i) => { const r = partes.find(x => x.producto === p); return { valor: r ? r.pct_del_estado : 0, color: COL_PROD[i], texto: r ? pct(r.pct_del_estado) : "", oscuro: i === 1 }; }),
      tip: `<strong>Clientes ${e.toLowerCase()}</strong>` + partes.map(r => `${r.producto}: ${millones(r.ventas)} (${pct(r.pct_del_estado)})`).join("<br>"),
    };
  }).filter(Boolean));

  // De cada $100: productos, envío e IVA, en gotas
  $("iva-titulo").textContent = "De cada $100 vendidos";
  $("iva-nota").innerHTML = v
    ? `<b>$${fmt0.format(v.productos_de_100)}</b> son productos, <b>$${fmt0.format(v.envio_de_100)}</b> son envío y <b>$${fmt0.format(v.iva_de_100)}</b> son IVA. Venta neta: ${millones(v.venta_neta)} sobre ${millones(v.ventas)} cobrados.`
    : "No hay ventas para esta selección.";
  const gotas = $("gotas");
  if (!gotas.children.length) {
    const g = `<svg viewBox="0 0 20 26"><path d="M10 1 C10 1 2 11 2 16.5 A8 8 0 0 0 18 16.5 C18 11 10 1 10 1Z"/></svg>`;
    gotas.innerHTML = Array.from({ length: 100 }, () => g).join("");
  }
  const desdeEnvio = v ? 100 - v.iva_de_100 - v.envio_de_100 : 100, desdeIva = v ? 100 - v.iva_de_100 : 100;
  [...gotas.children].forEach((g, i) => setTimeout(() => {
    g.classList.toggle("envio", i >= desdeEnvio && i < desdeIva);
    g.classList.toggle("iva", i >= desdeIva);
  }, SIN_MOVIMIENTO ? 0 : (100 - i) * 8));

  // Clientes (foto fija)
  const COL_CLI = {
    "Frecuencia": ["var(--agua-tiendas)", "var(--agua-online)", "var(--agua-online-2)"],
    "Valor": ["var(--sol)", "var(--agua-online)"],
    "Tipo de compra": ["var(--agua-tiendas)", "var(--agua-online)"],
  };
  const TIT = { "Frecuencia": "Cuántas veces compra cada cliente", "Valor": "El 20 % que más compra", "Tipo de compra": "Primeras compras y recompras" };
  const comps = $("comparaciones");
  if (!comps.children.length) {
    comps.innerHTML = ["Valor", "Frecuencia", "Tipo de compra"].map(g => {
      const partes = D.mart_clientes.filter(r => r.grupo === g).sort((a, b) => a.orden - b.orden);
      const unidad = g === "Tipo de compra" ? "Pedidos" : "Clientes";
      const barra = campo => partes.map((p, i) => `<span data-crece="${p[campo]}" class="${COL_CLI[g][i].includes("sol") || COL_CLI[g][i].includes("tiendas") ? "oscuro" : ""}" style="background:${COL_CLI[g][i]}" title="${p.categoria}: ${pct(p[campo])}">${pct(p[campo])}</span>`).join("");
      return `<div class="comparacion"><h3>${TIT[g]}</h3>
        <div class="comp-fila"><span>${unidad}</span><div class="comp-barra">${barra("pct_cantidad")}</div></div>
        <div class="comp-fila"><span>Ventas</span><div class="comp-barra">${barra("pct_ventas")}</div></div>
        <div class="leyenda">${partes.map((p, i) => `<span><i style="background:${COL_CLI[g][i]}"></i>${p.categoria}</span>`).join("")}</div></div>`;
    }).join("");
    despues(() => comps.querySelectorAll("[data-crece]").forEach(s => { s.style.flexGrow = s.dataset.crece; }));
  }

  const t = fila("mart_ventas", { periodo: "Todo", canal: "Todos", provincia: "Todas" });
  const val = D.mart_clientes.find(r => r.grupo === "Valor" && r.orden === 1);
  const rec = D.mart_clientes.find(r => r.grupo === "Tipo de compra" && r.categoria === "Recompra");
  $("hallazgos-clientes").innerHTML = hallazgos([
    ["Estados", `<strong>El ${pct(t.pct_pedidos_venta)} de los pedidos se concreta.</strong> Cancelaciones y reembolsos suman ${millones(t.monto_perdido)} que no se cobraron.`],
    ["Impuestos y envíos", `<strong>De cada $100 cobrados, $${fmt0.format(t.productos_de_100)} son productos, $${fmt0.format(t.iva_de_100)} IVA y $${fmt0.format(t.envio_de_100)} envío.</strong> La venta neta es ${millones(t.venta_neta)} sobre ${millones(t.ventas)} cobrados.`],
    ["Clientes", `<strong>El ${fmt0.format(per.pct_clientes_recurrentes)} % vuelve a comprar</strong> y las recompras generan el ${fmt0.format(rec.pct_ventas)} % de la facturación. El 20 % de clientes que más compra aporta el ${fmt0.format(val.pct_ventas)} %.`],
  ]);
}

function hallazgos(items) {
  return items.filter(([, t]) => t).map(([titulo, texto]) => `<div class="hallazgo"><h3>${titulo}</h3><p>${texto}</p></div>`).join("");
}

/* ---------------------------------------------------------------------
   Dibujo general
   --------------------------------------------------------------------- */
function dibujar() {
  sincronizarFiltros();
  actualizarAvisos();
  if (estado.tab === "resumen") dibujarResumen();
  if (estado.tab === "operacion") dibujarOperacion();
  if (estado.tab === "clientes") dibujarClientes();
}

/* ---------------------------------------------------------------------
   Carátula: la botella se llena a medida que se baja
   --------------------------------------------------------------------- */
function armarPortada() {
  const t = fila("mart_ventas", { periodo: "Todo", canal: "Todos", provincia: "Todas" });
  const u = fila("mart_usuarios", { periodo: "Todo" });
  const per = D.mart_periodo[0];
  $("portada-bajada").textContent = `Del ${fechaLarga(per.desde)} al ${fechaLarga(per.hasta)}. Bajá y mirá cómo se llena.`;

  // Las tres marcas de la botella, de abajo hacia arriba
  const marcas = [
    { umbral: 0.34, cifra: entero(u.usuarios_activos), texto: "usuarios visitaron la tienda online" },
    { umbral: 0.67, cifra: entero(t.pedidos_venta), texto: "pedidos se cobraron, entre la web y las cuatro tiendas" },
    { umbral: 1, cifra: millones(t.ventas), texto: "es todo lo que se vendió" },
  ];
  $("marcas").innerHTML = marcas.map(m => `<li data-umbral="${m.umbral}"><span class="marca-cifra">${m.cifra}</span><span class="marca-texto">${m.texto}</span></li>`).join("");

  const fig = $("portada-botella");
  fig.innerHTML = crearBotella({ colores: ["var(--agua-tiendas)", "var(--agua-online)"], burbujas: 16 })
    + `<figcaption>Abajo, la tienda online (${pct(t.pct_online)}). Arriba, las tiendas físicas.</figcaption>`;
  const svg = fig.querySelector("svg");
  // rayas de medida en el vidrio, una por marca
  svg.insertAdjacentHTML("beforeend", marcas.map(m => {
    const y = FONDO - m.umbral * ALTO_UTIL * 0.97;
    return `<g class="raya-medida" data-umbral="${m.umbral}"><line x1="70" x2="86" y1="${y}" y2="${y}"/><circle cx="92" cy="${y}" r="2.6"/></g>`;
  }).join(""));

  const seccion = $("portada"), items = [...document.querySelectorAll("#marcas li")], rayas = [...svg.querySelectorAll(".raya-medida")];
  const actualizar = () => {
    const recorrido = seccion.offsetHeight - window.innerHeight;
    const p = SIN_MOVIMIENTO ? 1 : Math.max(0, Math.min(1, window.scrollY / (recorrido * 0.9)));
    // dos capas: tiendas arriba, online abajo, con el mismo reparto que las ventas reales
    llenarBotella(svg, [p * 0.97, p * 0.97 * t.nivel_total_online]);
    items.forEach(li => li.classList.toggle("activa", p >= Number(li.dataset.umbral) - 0.02));
    rayas.forEach(r => r.classList.toggle("activa", p >= Number(r.dataset.umbral) - 0.02));
    seccion.classList.toggle("llena", p >= 0.98);
    $("indicador").classList.toggle("oculto", p > 0.05);
  };
  actualizar();
  window.addEventListener("scroll", () => requestAnimationFrame(actualizar), { passive: true });
  window.addEventListener("resize", actualizar);
  const irAlTablero = e => {
    e.preventDefault();
    window.scrollTo({ top: $("portada").offsetHeight, behavior: SIN_MOVIMIENTO ? "auto" : "smooth" });
  };
  $("entrar").addEventListener("click", irAlTablero);
  document.querySelector(".saltar").addEventListener("click", irAlTablero);
}

/* ---------------------------------------------------------------------
   Fondo: burbujas que suben despacio
   --------------------------------------------------------------------- */
function burbujasDeFondo() {
  const canvas = $("burbujas");
  if (SIN_MOVIMIENTO || !canvas.getContext) return;
  const c2 = canvas.getContext("2d");
  let W, H;
  const nueva = inicio => ({ x: Math.random(), y: inicio ? Math.random() : 1.05, r: 2 + Math.random() * 8, v: 0.00012 + Math.random() * 0.0003, fase: Math.random() * 6.3 });
  const burbujas = Array.from({ length: 30 }, () => nueva(true));
  const medir = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  medir();
  window.addEventListener("resize", medir);
  let antes = performance.now();
  const cuadro = t => {
    const dt = Math.min(50, t - antes); antes = t;
    c2.clearRect(0, 0, W, H);
    const color = getComputedStyle(document.documentElement).getPropertyValue("--agua-online").trim() || "#1677a8";
    burbujas.forEach((b, i) => {
      b.y -= b.v * dt;
      if (b.y < -0.05) burbujas[i] = nueva(false);
      const x = b.x * W + Math.sin(t / 1400 + b.fase) * 12;
      c2.globalAlpha = 0.14; c2.strokeStyle = color; c2.lineWidth = 1.2;
      c2.beginPath(); c2.arc(x, b.y * H, b.r, 0, Math.PI * 2); c2.stroke();
      c2.globalAlpha = 0.2; c2.fillStyle = color;
      c2.beginPath(); c2.arc(x - b.r * 0.35, b.y * H - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2); c2.fill();
    });
    c2.globalAlpha = 1;
    requestAnimationFrame(cuadro);
  };
  requestAnimationFrame(cuadro);
}

/* ---------------------------------------------------------------------
   Inicio
   --------------------------------------------------------------------- */
async function iniciar() {
  burbujasDeFondo();
  try {
    D = await cargarMarts();
    armarPortada();
    prepararPaneles();
    armarFiltros();
    armarPestanas();
    mostrarTab(location.hash.slice(1) || "resumen");
  } catch (err) {
    const caja = $("error");
    caja.hidden = false;
    caja.innerHTML = `<strong>No se pudieron leer los datos.</strong> ${err.message}. `
      + `Si abriste el archivo con doble clic, el navegador bloquea la lectura de los CSV: `
      + `usá la página publicada en GitHub Pages o ejecutá <code>python3 -m http.server</code> en la carpeta del proyecto `
      + `y entrá a <code>http://localhost:8000/web/</code>.`;
    console.error(err);
  }
}
iniciar();
