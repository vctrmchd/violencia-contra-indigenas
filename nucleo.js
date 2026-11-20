"use strict";
// SITE: linha do tempo ligada ao mapa (faixa de altura dinâmica, ganchos para mapa.js e controles.js).

// ================= constantes =================
const SVGNS = "http://www.w3.org/2000/svg";
const TIPOS = [
  ["morte", "Assassinato / morte"],
  ["agressao_fisica", "Agressão física"],
  ["territorio", "Território"],
  ["indireta", "Indireta (doença, contaminação)"],
];
const TIPO_NOME = Object.fromEntries(TIPOS);
const GRAU_NOME = { oficial: "confirmado oficialmente", apurado: "apurado por imprensa/organizações", denuncia: "denúncia" };
const FONTE_TIPO = { noticia: "imprensa", midia_local: "mídia local", midia_indigena: "mídia indígena", indigenista: "organização indigenista", wikipedia: "Wikipedia", artigo: "artigo", relatorio: "relatório", oficial: "documento oficial" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ROMANOS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"];
const nf = new Intl.NumberFormat("pt-BR");

const ANO_MIN = 1490;
const ANO_FIM = new Date().getFullYear() + 1;
const ERAS = [[1500, 1822, "Colônia"], [1822, 1889, "Império"], [1889, 1964, "República"], [1964, 1985, "Ditadura militar"], [1985, ANO_FIM, "Nova República"]];
// abre em "Últimos 10 anos" (mesmo enquadramento do botão, com a folga de 3% de cada lado)
const VISTA_INICIAL = [ANO_FIM - 11 * 1.06, ANO_FIM];
const SPAN_MIN = 1.5;                       // zoom máximo: ~1,5 ano na tela
const PASSOS = [100, 50, 25, 10, 5, 2, 1];  // passos possíveis do eixo (anos)
const PAD_L = 16, PAD_R = 16, ERA_H = 22, EIXO_H = 30;
// a faixa ocupa toda a altura disponível na base da tela (sem rolagem vertical)
// Tamanho da área da linha do tempo guardado em memória: ler clientWidth/clientHeight a cada bolha
// (milhares de vezes por render, logo depois de mexer no DOM) obrigava o navegador a recalcular a página.
const TAM_TL = { w: 0, h: 0, observando: false };
function tamanhoTL() {
  if (!TAM_TL.observando) {
    const sc = $("scroller");
    TAM_TL.w = sc.clientWidth; TAM_TL.h = sc.clientHeight; TAM_TL.observando = true;
    new ResizeObserver(() => {
      const w = sc.clientWidth, h = sc.clientHeight;
      if (w !== TAM_TL.w || h !== TAM_TL.h) { TAM_TL.w = w; TAM_TL.h = h; agendarRender(); }
    }).observe(sc);
  }
  return TAM_TL;
}
const faixaH = () => Math.max(120, (tamanhoTL().h || 300) - ERA_H - 4 - EIXO_H);
// raio em escala logarítmica, ajustado pelo zoom
const R_MIN = 4, R_MAX = 150, R_DESCONHECIDO = 6;
// Densidade: com a faixa fixa, se as bolhas visíveis não couberem sem sobreposição, todas encolhem
// pelo mesmo fator (mantendo as proporções entre elas) até ESCALA_MIN; só abaixo disso há sobreposição.
const ESCALA_PASSO = 0.85, ESCALA_MIN = 0.45;
const reduzMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;

let EVENTOS = [];
let vista = { a0: VISTA_INICIAL[0], a1: VISTA_INICIAL[1] };
let visiveis = null;     // Set de ids que passam nos filtros
// tipos de violência ligados nos chips do mapa (que também servem de legenda de cor); todos ligados = sem filtro
const tiposLigados = new Set(TIPOS.map(([t]) => t));
const filtroTipo = () => (tiposLigados.size === TIPOS.length ? null : tiposLigados);
let fixado = null;       // id do card fixado por clique/toque
let timerOcultar = null;
let pedido = 0;          // requestAnimationFrame pendente
let arrastou = false;    // diferencia arrastar de clicar

// ================= utilidades =================
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v; else n.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null && f !== false) n.append(f);
  return n;
}
function sv(tag, attrs = {}, texto) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (texto != null) n.textContent = texto;
  return n;
}
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

// ================= escala e zoom =================
const largura = () => tamanhoTL().w || 800;
const pxPorAno = () => (largura() - PAD_L - PAD_R) / (vista.a1 - vista.a0);
const xAno = (a) => PAD_L + (a - vista.a0) * pxPorAno();
const anoDoX = (x) => vista.a0 + (x - PAD_L) / pxPorAno();
// bolhas crescem levemente ao aproximar e encolhem ao afastar
const fatorZoom = () => limitar(Math.pow(pxPorAno() / 40, 0.3), 0.55, 1.55);

function anoDecimal(d, precisao) {
  const [a, m, dia] = d.split("-").map(Number);
  let v = a + (m ? (m - 1) / 12 : 0) + (dia ? (dia - 1) / 365 : 0);
  if (precisao === "ano") v += 0.5;
  if (precisao === "mes" && !dia) v += 0.5 / 12;
  return v;
}
function anoCentral(ev) {
  const ini = anoDecimal(ev.data_inicio, ev.precisao_data);
  if (ev.data_fim) { const fim = anoDecimal(ev.data_fim, ev.precisao_data); return { ini, fim, c: (ini + fim) / 2 }; }
  const extra = ev.precisao_data === "decada" ? 5 : ev.precisao_data === "seculo" ? 50 : 0;
  return { ini, fim: null, c: ini + extra };
}
// Totais do Cimi com tabela por estado (por_uf): com o filtro de estado ligado, o card vale só o número
// daquele estado (já sem os casos com card próprio, descontados no export), na linha do tempo, no mapa,
// no placar e no card. Sem filtro, a linha do tempo mostra o total do país numa bolha só.
const ufFiltro = () => $("f-uf")?.value || "";
function valorUF(ev, uf) {
  const t = ev.por_uf && (ev.por_uf.descontados || ev.por_uf.valores);
  return t && uf ? (t[uf] ?? 0) : null;
}
function comUF(ev, uf = ufFiltro()) {
  const v = valorUF(ev, uf);
  return v == null ? ev : { ...ev, vitimas: { ...ev.vitimas, min: v, max: v } };
}
// tamanho da bolha: a categoria do acontecimento com o maior número (principal ou outras_violencias)
const nCat = (v) => v.max ?? v.min ?? null;
const nVitimas = (ev) => {
  const ns = [ev.vitimas, ...(ev.outras_violencias || [])].map(nCat).filter((n) => n != null);
  return ns.length ? Math.max(...ns) : null;
};
// todos os tipos de violência de um acontecimento (principal + outras_violencias)
const tiposDe = (ev) => [ev.tipo, ...(ev.outras_violencias || []).map((o) => o.tipo)];
// Raio = vítimas (termo log, que diferencia 1, 10, 100…, + termo de raiz quarta, que dá destaque aos números
// muito grandes) × fator de duração × zoom. A duração pesa bastante: 5 anos ≈ +30%, 25 anos ≈ +57%,
// um século ≈ +80%, dois séculos ≈ +92%. Sem número de vítimas, a base cresce com a duração, para que
// conflitos de décadas não sumam do gráfico (a bolha continua vazada, indicando número desconhecido).
function raio(n, anos = 0) {
  const a = Math.max(0, anos);
  const base = n == null ? R_DESCONHECIDO + 9 * Math.log10(1 + a) : R_MIN + 4.5 * Math.log10(n + 1) + 1.1 * Math.pow(n, 0.25);
  const duracao = 1 + 0.4 * Math.log10(1 + a);
  return Math.min(R_MAX, faixaH() / 2 - 10, base * duracao * fatorZoom());
}
const seculo = (a) => Math.floor(a / 100) + 1;

function definirVista(a0, a1) {
  let span = limitar(a1 - a0, SPAN_MIN, ANO_FIM - ANO_MIN);
  let c = (a0 + a1) / 2;
  c = limitar(c, ANO_MIN + span / 2, ANO_FIM - span / 2);
  vista = { a0: c - span / 2, a1: c + span / 2 };
  agendarRender();
}

let animacao = 0;
function irPara(a0, a1) {
  cancelAnimationFrame(animacao);
  if (reduzMovimento) return definirVista(a0, a1);
  const de = { ...vista }, t0 = performance.now(), dur = 380;
  const passo = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    definirVista(de.a0 + (a0 - de.a0) * e, de.a1 + (a1 - de.a1) * e);
    if (p < 1) animacao = requestAnimationFrame(passo);
  };
  animacao = requestAnimationFrame(passo);
}

function zoomEm(ano, fator) {
  definirVista(ano - (ano - vista.a0) * fator, ano + (vista.a1 - ano) * fator);
}

// ================= formatação =================
function fmtData(d, p) {
  const [a, m, dia] = d.split("-").map(Number);
  if (p === "dia") return `${String(dia).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`;
  if (p === "mes") return `${MESES[m - 1]}/${a}`;
  if (p === "decada") return `década de ${Math.floor(a / 10) * 10}`;
  if (p === "seculo") return `séc. ${ROMANOS[seculo(a)]}`;
  return String(a);
}
function fmtPeriodo(ev) {
  const ini = fmtData(ev.data_inicio, ev.precisao_data);
  if (!ev.data_fim) return ini;
  const fim = fmtData(ev.data_fim, ev.precisao_data);
  return ini === fim ? ini : `${ini} – ${fim}`;
}
const ROTULO_VITIMAS = { morte: "mortos", agressao_fisica: "pessoas feridas", territorio: "pessoas atingidas", indireta: "mortos" };
const ROTULO_VITIMAS_1 = { morte: "morto", agressao_fisica: "pessoa ferida", territorio: "pessoa atingida", indireta: "morto" };
function rotuloVitimas(ev, singular) {
  const u = ev.vitimas.unidade;
  if (u === "estruturas") return singular ? "estrutura destruída" : "estruturas destruídas";
  if (u === "reducao_populacional") return "redução populacional estimada (pessoas)";
  if (u === "presos") return singular ? "pessoa presa e/ou submetida a violência" : "pessoas presas e/ou submetidas a violência";
  if (u === "casos") return singular ? "caso registrado" : "casos registrados";
  if (u === "escravizados") return singular ? "pessoa escravizada" : "pessoas escravizadas";
  if (u === "contaminados") return singular ? "pessoa contaminada" : "pessoas contaminadas";
  if (u === "deslocados") return singular ? "pessoa deslocada à força" : "pessoas deslocadas à força";
  if (u === "familias") return singular ? "família deslocada à força" : "famílias deslocadas à força";
  if (u === "aldeias") return singular ? "aldeia destruída, inundada ou deslocada" : "aldeias destruídas, inundadas ou deslocadas";
  if (u === "terras") return singular ? "terra indígena atingida" : "terras indígenas atingidas";
  if (u === "atingidos") return singular ? "pessoa atingida" : "pessoas atingidas";
  return singular ? ROTULO_VITIMAS_1[ev.tipo] : ROTULO_VITIMAS[ev.tipo];
}
function numeroDestaque(ev) {
  const { min, max } = ev.vitimas;
  const rot = rotuloVitimas(ev, min === 1 && max === 1);
  const pre = ev.natureza_contagem === "estimada" ? "estimativa" : ev.grau_confirmacao === "denuncia" ? "segundo denúncia" : "documentado";
  if (min == null && max == null) return { num: "?", rot: "número de vítimas desconhecido", pre: null };
  if (max == null) return { num: `${nf.format(min)}+`, rot: `${rot} (no mínimo)`, pre };
  if (min == null) return { num: `≤ ${nf.format(max)}`, rot, pre };
  if (min === max) return { num: nf.format(min), rot, pre };
  return { num: `${nf.format(min)}–${nf.format(max)}`, rot, pre };
}
function fmtVitimas(ev) {
  const d = numeroDestaque(ev);
  return d.num === "?" ? d.rot : `${d.num} ${d.rot}`;
}
const fmtLocal = (l) => [l.terra_indigena, l.municipio, l.uf, l.regiao].filter(Boolean).join(" · ");
// nome acessível: a codificação visual (tipo, denúncia, estimativa, total, local aproximado) também em texto
// o texto só depende do registro: guardado para não remontar centenas de rótulos a cada quadro
const ROTULOS = new Map();
function rotuloAcessivel(ev) {
  let r = ROTULOS.get(ev);
  if (r == null) { r = montarRotulo(ev); ROTULOS.set(ev, r); }
  return r;
}
function montarRotulo(ev) {
  const tipos = tiposDe(ev).map((t) => TIPO_NOME[t].toLowerCase()).join(" + ");
  const grau = GRAU_NOME[ev.grau_confirmacao];
  const extras = [ev.natureza_contagem === "estimada" ? "estimativa" : null, ev.escala === "agregado" ? "total agregado" : null,
    ev.lideranca ? "liderança indígena" : null, ev.violencia_interna ? "violência interna" : null].filter(Boolean).join(", ");
  const local = window.MAPA?.localNoMapa(ev);
  return `${fmtPeriodo(ev)}: ${ev.titulo}. ${tipos}. ${fmtVitimas(ev)}. ${grau}${extras ? `, ${extras}` : ""}. ${fmtLocal(ev.local)}${local ? ` (no mapa: ${local})` : ""}.`;
}

// ================= layout das bolhas =================
// `sondar`: só interessa saber se cabe; para no primeiro conflito (o resultado é descartado).
// `PASSO`: de quantos em quantos px se testa a altura de cada bolha (6 durante gestos, 3 no render exato).
// `uniforme`: trechos densos demais para caber mesmo na menor escala — nas faixas de 40 px com mais registros
// do que cabem (cerca de um a cada 20 × 20 px), todas as bolhas ficam com o mesmo raio pequeno; o resto da
// janela mantém o tamanho por vítimas. A dica na tela avisa e pede para aproximar.
const R_UNIFORME = 3.5, BIN_DENSO = 40;
function binsDensos() {
  const n = new Map();
  for (const ev of EVENTOS) { const k = Math.floor(xAno(anoCentral(ev).c) / BIN_DENSO); n.set(k, (n.get(k) || 0) + 1); }
  const cap = (BIN_DENSO * faixaH()) / 400;
  return new Set([...n].filter(([, c]) => c > cap).map(([k]) => k));
}
function layout(escala = 1, sondar = false, PASSO = 3, uniforme = false) {
  const W = largura();
  const itens = [];
  const densos = uniforme ? binsDensos() : null;
  for (const ev of EVENTOS) {
    const t = anoCentral(ev);
    const x = xAno(t.c), x0 = xAno(t.ini), x1 = t.fim ? xAno(t.fim) : null;
    const r = densos?.has(Math.floor(x / BIN_DENSO)) ? R_UNIFORME : Math.max(2.5, raio(nVitimas(comUF(ev)), t.fim ? t.fim - t.ini : 0) * escala);
    // raio efetivo inclui os anéis (outros tipos e liderança) para o cálculo de espaço
    const re = r + (ev.outras_violencias?.length || 0) * 3 + (ev.lideranca ? 4.5 : 0) + 1;
    const fora = (x1 ?? x) + re < -40 || Math.min(x0, x) - re > W + 40;
    if (!fora) itens.push({ ev, x, x0, x1, r, re, dy: 0 });
  }
  // Empacotamento vertical dentro da faixa fixa: maiores primeiro, no centro, sem sobreposição.
  // Se não houver espaço livre, aceita sobreposição parcial com o centro de cada bolha fora da outra;
  // em último caso, a posição de menor sobreposição. `conflitos` conta as bolhas que não acharam espaço livre.
  const FAIXA_H = faixaH(), meia = FAIXA_H / 2 - 6;
  const postos = [];
  let conflitos = 0;
  // vizinhos em arrays planos (dx², dy, raio) e uma única volta por posição testada: sem Math.hypot,
  // sem arrays temporários. Mesmo resultado da versão com every/map.
  const vx2 = [], vdy = [], vre = [];
  for (const it of itens.sort((a, b) => b.re - a.re)) {
    let n = 0;
    for (const p of postos) {
      const dx = p.x - it.x;
      if (Math.abs(dx) < p.re + it.re + 2) { vx2[n] = dx * dx; vdy[n] = p.dy; vre[n] = p.re; n++; }
    }
    let livre = null, parcial = null, melhor = 0, melhorFolga = -Infinity;
    for (let k = 0; ; k++) {
      const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * PASSO;
      if (Math.abs(dy) + it.re > meia) break;
      // com uma posição parcial já achada, parcial e folga não importam mais: basta saber se esta é livre,
      // e a volta para no primeiro vizinho que colide (mesmo resultado, bem menos contas)
      let ehLivre = true, ehParcial = true, folga = Infinity;
      for (let j = 0; j < n; j++) {
        const d = vdy[j] - dy, s = Math.sqrt(vx2[j] + d * d), maior = vre[j] > it.re ? vre[j] : it.re;
        if (s < vre[j] + it.re + 2) { ehLivre = false; if (parcial !== null) break; }
        if (s < maior) ehParcial = false;
        if (s - maior < folga) folga = s - maior;
      }
      if (ehLivre) { livre = dy; break; }
      if (parcial === null && ehParcial) parcial = dy;
      if (folga > melhorFolga) { melhorFolga = folga; melhor = dy; }
    }
    if (livre === null) { conflitos++; if (sondar) break; }
    it.dy = livre ?? parcial ?? melhor;
    postos.push(it);
  }
  return { itens: postos, h: FAIXA_H, conflitos };
}

// Escolhe o maior fator de escala (≤ 1) em que todas as bolhas visíveis cabem sem sobreposição.
// As escalas maiores só sondam (param no primeiro conflito); uma sondagem sem conflito já é o layout completo.
// Durante um gesto contínuo (`rapido`), repete a última escala escolhida e pula as sondagens;
// o render exato vem logo depois que o gesto para (ver agendarRender).
let ultimaEscala = 1, ultimoUniforme = false;
function layoutAjustado(rapido = false) {
  if (rapido) return layout(ultimaEscala, false, 6, ultimoUniforme);
  let escala = 1, L, uniforme = false;
  while (escala > ESCALA_MIN) {
    L = layout(escala, true);
    if (!L.conflitos) break;
    escala = Math.max(ESCALA_MIN, escala * ESCALA_PASSO);
  }
  if (escala <= ESCALA_MIN) {
    L = layout(ESCALA_MIN);
    // muitos conflitos mesmo na menor escala: tamanho único, que empacota bem mais registros
    if (L.conflitos > Math.max(8, L.itens.length * 0.08)) { L = layout(ESCALA_MIN, false, 3, true); uniforme = true; }
  }
  ultimaEscala = escala; ultimoUniforme = uniforme;
  const dica = $("tl-dica");
  if (dica) dica.hidden = !uniforme;
  return L;
}

// ================= desenho =================
// Renders em sequência (zoom, arraste, pinça, animação) são feitos no modo rápido; 200 ms depois do último,
// um render exato recalcula a escala das bolhas.
let ultimoRender = 0, timerExato = 0;
function agendarRender() {
  if (pedido) return;
  pedido = requestAnimationFrame((t) => {
    pedido = 0;
    const rapido = t - ultimoRender < 150;
    ultimoRender = t;
    render(rapido);
    clearTimeout(timerExato);
    if (rapido) timerExato = setTimeout(() => { ultimoRender = 0; render(); }, 200);
  });
}

// ---------- reaproveitamento de elementos SVG ----------
// O SVG é montado uma vez; a cada render só mudam atributos. Cada registro tem a sua bolha, criada na
// primeira vez que aparece e guardada (fora do DOM quando sai da janela). Recriar ~1.300 elementos por quadro
// custava mais que o resto do render.
// setAttribute só quando o valor muda: escrever o mesmo valor também invalida estilo e layout.
function attr(n, k, v) {
  const c = n.__a || (n.__a = {});
  if (c[k] !== v) { c[k] = v; n.setAttribute(k, v); }
}
// Põe `nos` como filhos de `pai`, nessa ordem, movendo só o que mudou de lugar e tirando o resto.
function ordenarFilhos(pai, nos) {
  let ref = pai.firstChild;
  for (const n of nos) {
    if (n === ref) ref = ref.nextSibling;
    else pai.insertBefore(n, ref);
  }
  while (ref) { const prox = ref.nextSibling; pai.removeChild(ref); ref = prox; }
}

const TL = { svg: null, gGrade: null, gEras: null, eras: [], sep: null, gBolhas: null, eixo: null, ticks: new Map(), bolhas: new Map() };
function montarBaseTL() {
  const svg = (TL.svg = $("tl"));
  svg.replaceChildren();
  // padrão de hachura diagonal (totais anuais/agregados); também usado pela legenda
  const defs = sv("defs");
  // hachura em 45°; nos tipos azul e verde (território, indireta) em -45°, para separá-los também pelo ângulo
  for (const [id, ang] of [["hachura", 45], ["hachura-b", -45]]) {
    const pat = sv("pattern", { id, patternUnits: "userSpaceOnUse", width: 5, height: 5, patternTransform: `rotate(${ang})` });
    pat.append(sv("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: "var(--bg)", "stroke-width": 1.6, "stroke-opacity": 0.6 }));
    defs.append(pat);
  }
  TL.gGrade = sv("g");
  TL.eixo = sv("line", { class: "eixo", x1: 0 });
  TL.gEras = sv("g");
  TL.eras = ERAS.map(([, , nome], k) => {
    const g = sv("g", { class: `era ${k % 2 ? "par" : ""}` });
    const rect = sv("rect", { y: 0, height: ERA_H }), texto = sv("text", { y: 17 }, nome);
    g.append(rect, texto);
    return { g, rect, texto };
  });
  TL.sep = sv("line", { class: "sep", x1: 0 });
  TL.gBolhas = sv("g");
  // cópia da bolha com foco do teclado, por cima de todas (WCAG 2.4.11: o foco não fica coberto)
  TL.gTopo = sv("g", { class: "topo-foco", "pointer-events": "none", "aria-hidden": "true" });
  svg.append(defs, TL.gGrade, TL.gEras, TL.sep, TL.gBolhas, TL.gTopo);
}

// grade, marca e rótulo de um ano do eixo (guardados por ano)
function noTick(a) {
  let t = TL.ticks.get(a);
  if (!t) {
    t = { grade: sv("line", { class: "grade" }), tick: sv("line", { class: "tick" }), rot: sv("text", { class: "tick-label" }, String(a)) };
    TL.ticks.set(a, t);
  }
  return t;
}

// Elementos de uma bolha: o que depende só do registro (cor, codificação, anéis, rótulo) é fixado na criação.
function noBolha(ev) {
  let b = TL.bolhas.get(ev.id);
  if (b) return b;
  const cor = `var(--${ev.tipo})`;
  const g = sv("g", { class: "bolha", "data-id": ev.id, tabindex: -1, role: "button", "aria-label": rotuloAcessivel(ev) });
  b = { g, periodo: null, aneis: [], lider: null, nucleo: null, hachura: null };
  if (ev.data_fim) { b.periodo = sv("line", { class: "periodo", stroke: cor }); g.append(b.periodo); }
  // um anel colorido por violência adicional no mesmo acontecimento
  const outras = ev.outras_violencias || [];
  for (const o of outras) { const c = sv("circle", { class: "anel-tipo", stroke: `var(--${o.tipo})` }); b.aneis.push(c); g.append(c); }
  if (ev.lideranca) { b.lider = sv("circle", { class: "anel-lider" }); g.append(b.lider); }
  // Codificação: preenchimento cheio = confirmado/apurado; tracejado = denúncia (único uso de tracejado);
  // meio-transparente = estimativa; quase vazio = nº desconhecido; aro interno = total agregado.
  const desconhecido = nCat(ev.vitimas) == null && nVitimas(ev) == null;
  const estimada = ev.natureza_contagem === "estimada";
  const denuncia = ev.grau_confirmacao === "denuncia";
  b.nucleo = sv("circle", {
    class: "nucleo", stroke: cor, fill: cor,
    "fill-opacity": desconhecido ? 0.1 : denuncia ? 0.35 : estimada ? 0.55 : 0.9,
    "stroke-dasharray": denuncia ? "3 2.5" : null,
  });
  g.append(b.nucleo);
  if (ev.escala === "agregado") { b.hachura = sv("circle", { class: "hachura", style: hachuraB(ev.tipo) ? "fill: url(#hachura-b)" : null }); g.append(b.hachura); }
  TL.bolhas.set(ev.id, b);
  return b;
}

function render(rapido = false) {
  const L = layoutAjustado(rapido);
  const W = largura(), H = ERA_H + 4 + L.h + EIXO_H;
  const yFaixa = ERA_H + 4, yMeio = yFaixa + L.h / 2, yEixo = yFaixa + L.h + 2;
  if (!TL.svg) montarBaseTL();
  const svg = TL.svg;
  attr(svg, "width", W);
  attr(svg, "height", H);
  attr(svg, "viewBox", `0 0 ${W} ${H}`);

  // eixo: passo escolhido para caber ~1 rótulo a cada 64px
  const ppa = pxPorAno();
  const passo = [...PASSOS].reverse().find((p) => p * ppa >= 64) || PASSOS[0];
  const nosGrade = [];
  for (let a = Math.ceil(vista.a0 / passo) * passo; a <= vista.a1; a += passo) {
    const x = xAno(a).toFixed(1), t = noTick(a);
    attr(t.grade, "x1", x); attr(t.grade, "x2", x); attr(t.grade, "y1", ERA_H); attr(t.grade, "y2", yEixo);
    attr(t.tick, "x1", x); attr(t.tick, "x2", x); attr(t.tick, "y1", yEixo); attr(t.tick, "y2", yEixo + 5);
    attr(t.rot, "x", x); attr(t.rot, "y", yEixo + 18);
    nosGrade.push(t.grade, t.tick, t.rot);
  }
  attr(TL.eixo, "x2", W); attr(TL.eixo, "y1", yEixo); attr(TL.eixo, "y2", yEixo);
  nosGrade.push(TL.eixo);
  ordenarFilhos(TL.gGrade, nosGrade);

  // faixas de período histórico
  const nosEras = [];
  ERAS.forEach(([i, f], k) => {
    const xa = Math.max(0, xAno(i)), xb = Math.min(W, xAno(f));
    if (xb <= xa) return;
    const e = TL.eras[k];
    attr(e.rect, "x", xa.toFixed(1)); attr(e.rect, "width", (xb - xa).toFixed(1));
    attr(e.texto, "x", (xa + 8).toFixed(1)); attr(e.texto, "display", xb - xa > 70 ? "inline" : "none");
    nosEras.push(e.g);
  });
  ordenarFilhos(TL.gEras, nosEras);
  attr(TL.sep, "x2", W); attr(TL.sep, "y1", yMeio); attr(TL.sep, "y2", yMeio);

  // bolhas (maiores primeiro, para as pequenas ficarem por cima)
  const nosBolhas = [];
  for (const it of L.itens) {
    const ev = it.ev, b = noBolha(ev), cy = (yMeio + it.dy).toFixed(1), cx = it.x.toFixed(1);
    b.g.classList.toggle("apagada", !!visiveis && !visiveis.has(ev.id));
    b.g.classList.toggle("ativa", fixado === ev.id);
    if (b.periodo) { attr(b.periodo, "x1", it.x0.toFixed(1)); attr(b.periodo, "x2", it.x1.toFixed(1)); attr(b.periodo, "y1", cy); attr(b.periodo, "y2", cy); }
    b.aneis.forEach((c, k) => { attr(c, "cx", cx); attr(c, "cy", cy); attr(c, "r", (it.r + 3 + k * 3).toFixed(1)); });
    if (b.lider) { attr(b.lider, "cx", cx); attr(b.lider, "cy", cy); attr(b.lider, "r", (it.r + 3.5 + b.aneis.length * 3).toFixed(1)); }
    attr(b.nucleo, "cx", cx); attr(b.nucleo, "cy", cy); attr(b.nucleo, "r", it.r.toFixed(1));
    if (b.hachura) { attr(b.hachura, "cx", cx); attr(b.hachura, "cy", cy); attr(b.hachura, "r", (it.r - 0.75).toFixed(1)); }
    nosBolhas.push(b.g);
  }
  ordenarFilhos(TL.gBolhas, nosBolhas);

  // parada de Tab: a bolha fixada ou a mais à esquerda (posições já conhecidas pelo layout; getBBox força reflow)
  const ativas = L.itens.filter((it) => !visiveis || visiveis.has(it.ev.id));
  const alvoTab = ativas.find((it) => it.ev.id === fixado) || ativas.reduce((m, it) => (!m || it.x < m.x ? it : m), null);
  for (const g of TL.gBolhas.querySelectorAll('.bolha[tabindex="0"]')) g.tabIndex = -1;
  if (alvoTab) TL.bolhas.get(alvoTab.ev.id).g.tabIndex = 0;
  marcarEra();
  placar();
  if (window.MAPA) MAPA.desenhar();
  window.CONTROLES?.aoRenderizar?.();
  focoNoTopo();
  if (!rapido) anunciarRecorte();
}

function focoNoTopo() {
  if (!TL.gTopo) return;
  const g = document.activeElement;
  if (!g?.classList?.contains("bolha") || !TL.gBolhas.contains(g)) { TL.gTopo.replaceChildren(); return; }
  const c = g.cloneNode(true);
  for (const a of ["tabindex", "role", "aria-label", "data-id"]) c.removeAttribute(a);
  c.classList.add("clone-foco");
  TL.gTopo.replaceChildren(c);
}

// Leitor de tela: placar e contadores não são regiões vivas (mudariam a cada quadro do arraste);
// o resumo do recorte é anunciado uma vez, quando o gesto termina.
let timerAnuncio = 0, ultimoAnuncio = "";
function anunciarRecorte() {
  clearTimeout(timerAnuncio);
  timerAnuncio = setTimeout(() => {
    const n = EVENTOS.filter((e) => (!visiveis || visiveis.has(e.id)) && naJanelaAtual(e)).length;
    const txt = `Período ${$("janela-rot").textContent}: ${n} ${n === 1 ? "registro" : "registros"}. ${RESUMO_PLACAR}`;
    if (txt === ultimoAnuncio) return;
    ultimoAnuncio = txt;
    const a = $("anuncio");
    if (a) { a.textContent = ""; requestAnimationFrame(() => (a.textContent = txt)); }
  }, 700);
}
const hachuraB = (tipo) => tipo === "territorio" || tipo === "indireta";

// registros que passam nos filtros e aparecem na janela da linha do tempo (o mesmo critério do placar)
function naJanelaAtual(e) {
  const t = anoCentral(e);
  if (e.abrange_casos) return t.c >= vista.a0 && t.c <= vista.a1;
  return (t.fim ?? t.ini) >= vista.a0 && t.ini <= vista.a1;
}

// ================= placar (soma do que está visível) =================
// Soma os registros que passam nos filtros e aparecem na janela da linha do tempo. Casos, totais anuais e
// estimativas entram juntos, sem sobreposição: os totais já vêm do export com os casos de card próprio
// descontados, e os cards de pessoas contidos no período de uma redução populacional (`abrange_casos`)
// não são somados de novo. Contagens em "casos" (ocorrências) não são pessoas e ficam de fora.
function grupoDe(tipo, u = "pessoas") {
  if (u === "casos") return null;
  if (["reducao_populacional", "estruturas", "aldeias", "terras", "familias", "deslocados", "contaminados", "escravizados"].includes(u)) return u;
  if (u === "presos" || u === "atingidos") return "atingidos";
  return tipo === "morte" || tipo === "indireta" ? "mortes" : "atingidos";
}
const PESSOAS = [
  ["reducao_populacional", "redução populacional estimada", "redução populacional estimada"],
  ["mortes", "mortes", "morte"],
  ["escravizados", "escravizadas", "escravizada"],
  ["atingidos", "feridas, presas, ameaçadas ou desaparecidas", "ferida, presa, ameaçada ou desaparecida"],
  ["deslocados", "deslocadas à força", "deslocada à força"],
  ["contaminados", "atingidas por contaminação", "atingida por contaminação"],
];
const LUGARES = [["estruturas", "casas, casas de reza e outras estruturas", "casa, casa de reza ou outra estrutura"], ["aldeias", "aldeias", "aldeia"], ["terras", "terras e territórios invadidos, queimados ou explorados", "terra ou território invadido, queimado ou explorado"], ["terras_morte", "terras e territórios onde houve assassinato de indígena", "terra ou território onde houve assassinato de indígena"]];

function fmtCurto(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 1e4) return `${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return nf.format(n);
}
// faixa mínima–máxima escrita "3.797 a 4.094": o travessão podia ser lido como subtração
const fmtFaixa = (s) => (s.max > s.min ? `${fmtCurto(s.min)} a ${fmtCurto(s.max)}` : fmtCurto(s.min));
let RESUMO_PLACAR = "", PLACAR_DET_ABERTO = false;

// chave de terra/território para não contar a mesma TI duas vezes no placar
const chaveTI = (e) => {
  const t = e.local?.terra_indigena;
  return t ? t.split(" — ")[0].replace(/^(TIs?|Terra Indígena)\s+/i, "").trim().toLowerCase() : null;
};

function placar() {
  const alvo = $("placar");
  if (!alvo) return;
  const tipoF = filtroTipo();
  // reduções populacionais longas (abrange_casos) entram só quando o meio do período está na tela,
  // para que a queda de uma época não pese na janela de outra
  const naJanela = (e) => {
    const t = anoCentral(e);
    if (e.abrange_casos) return t.c >= vista.a0 && t.c <= vista.a1;
    return (t.fim ?? t.ini) >= vista.a0 && t.ini <= vista.a1;
  };
  const lista = EVENTOS.filter((e) => (!visiveis || visiveis.has(e.id)) && naJanela(e));
  const coberturas = lista.filter((e) => e.abrange_casos).map(anoCentral);
  const coberto = (e) => !e.abrange_casos && coberturas.some((c) => { const m = anoCentral(e).c; return m >= c.ini && m <= c.fim; });

  const S = {};
  const add = (g, mn, mx) => { const s = (S[g] ||= { min: 0, max: 0 }); s.min += mn; s.max += mx; };
  const tis = new Set(), tisMorte = new Set();
  const lider = { mortas: { min: 0, max: 0 }, atacadas: 0 };
  let denuncia = 0;
  for (const e0 of lista) {
    const e = comUF(e0);
    const cats = [[e.tipo, e.vitimas], ...(e.outras_violencias || []).map((o) => [o.tipo, o])].filter(([t]) => !tipoF || tipoF.has(t));
    const ti = chaveTI(e);
    for (const [tipo, v] of cats) {
      const g = grupoDe(tipo, v.unidade);
      if (tipo === "morte" && ti && e.escala === "caso") { tis.add(ti); tisMorte.add(ti); }
      if (!g || (v.min == null && v.max == null)) continue;
      const mn = v.min ?? 0, mx = v.max ?? v.min;
      if (g === "terras" && ti && mx === 1) { tis.add(ti); continue; }   // uma TI nomeada: entra no conjunto, sem repetir
      const pessoa = PESSOAS.some(([k]) => k === g);
      // a redução populacional contém as mortes do seu período; feridos, presos, escravizados e deslocados continuam somando
      if (g === "mortes" && coberto(e)) continue;
      add(g, mn, mx);
      if (pessoa && e.grau_confirmacao === "denuncia") denuncia += mn;
    }
    // lideranças: o assassinato ou ataque a uma liderança atinge toda a comunidade
    if (e.lideranca && cats.length) {
      const m = [[e.tipo, e.vitimas], ...(e.outras_violencias || []).map((o) => [o.tipo, o])].find(([t]) => t === "morte");
      if (m && (!tipoF || tipoF.has("morte"))) {
        if (e.escala === "agregado") { lider.mortas.min += m[1].min ?? 0; lider.mortas.max += m[1].max ?? m[1].min ?? 0; }
        else { lider.mortas.min += 1; lider.mortas.max += 1; }
      } else if (!m) lider.atacadas += 1;
    }
  }
  // cada terra entra numa linha só: com assassinato, na segunda; sem, na primeira
  const soTerritorio = [...tis].filter((t) => !tisMorte.has(t)).length;
  if (soTerritorio) add("terras", soTerritorio, soTerritorio);
  if (tisMorte.size) add("terras_morte", tisMorte.size, tisMorte.size);
  const total = (grupos) => grupos.reduce((t, [k]) => S[k] ? { min: t.min + S[k].min, max: t.max + S[k].max } : t, { min: 0, max: 0 });
  const linhas = (grupos) => el("ul", {}, ...grupos.filter(([k]) => S[k]?.max > 0).map(([k, rot, rot1]) => el("li", {}, el("b", {}, fmtFaixa(S[k])), ` ${S[k].max === 1 ? rot1 : rot}`)));
  const cartao = (rot, t, ul, extras = [], sub = null) => el("div", { class: "pc" },
    el("span", { class: "pc-rot" }, rot),
    el("strong", {}, t.max > 0 ? fmtFaixa(t) : "—"),
    t.max > 0 && sub ? el("span", { class: "pc-sub" }, sub) : null,
    t.max > 0 ? ul : null, ...extras);
  const obs = (txt) => el("p", { class: "pc-obs" }, txt);
  // notas secundárias do placar recolhidas num "detalhes", para o número principal caber na tela
  const detalhes = (itens) => {
    const n = itens.filter(Boolean);
    if (!n.length) return [];
    const d = el("details", { class: "pc-det", open: PLACAR_DET_ABERTO ? "" : null }, el("summary", {}, "Detalhes da soma"), ...n);
    d.addEventListener("toggle", () => (PLACAR_DET_ABERTO = d.open));   // o placar é refeito a cada desenho
    return [d];
  };

  const lid = [];
  if (lider.mortas.max) lid.push(`${fmtFaixa(lider.mortas)} ${lider.mortas.max === 1 ? "liderança assassinada" : "lideranças assassinadas"}`);
  if (lider.atacadas) lid.push(`${fmtCurto(lider.atacadas)} ${lider.atacadas === 1 ? "liderança atacada ou ameaçada" : "lideranças atacadas ou ameaçadas"}`);
  const tp = total(PESSOAS);
  const faixa = tp.max > tp.min;
  alvo.replaceChildren(
    cartao("Pessoas indígenas vítimas de violência", tp, linhas(PESSOAS), [
      lid.length ? el("p", { class: "pc-lider" }, "◆ ", lid.join(" · ")) : null,
      ...detalhes([
      denuncia ? obs(`Destas, ao menos ${fmtCurto(denuncia)} ${denuncia === 1 ? "vem só de denúncia, ainda não apurada" : "vêm só de denúncias, ainda não apuradas"}.`) : null,
      S.familias?.max ? obs(`Também ${fmtFaixa(S.familias)} famílias deslocadas à força (não somadas às pessoas).`) : null,
      ]),
    ], `${faixa ? "Entre o mínimo e o máximo das fontes. " : ""}Soma casos, totais anuais e estimativas, sem contar duas vezes.`),
    cartao("Território e patrimônio atingidos", total(LUGARES), linhas(LUGARES)),
  );
  RESUMO_PLACAR = tp.max > 0 ? `${faixa ? "Entre " + fmtCurto(tp.min) + " e " + fmtCurto(tp.max) : fmtCurto(tp.min)} pessoas indígenas vítimas.` : "Nenhuma vítima contada.";
  // no celular, uma linha fixa sobre o mapa com o total e o período
  const mp = $("mapa-placar");
  if (mp) mp.textContent = `${tp.max > 0 ? fmtFaixa(tp) : "—"} vítimas · ${$("janela-rot")?.textContent || ""}`;
}

// ================= filtros =================
function filtrar() {
  const q = $("f-busca").value.trim().toLowerCase();
  const tipo = filtroTipo(), grau = $("f-grau").value, esc = $("f-escala").value, uf = $("f-uf").value, lider = $("f-lider").value, interna = $("f-interna").value;
  const ok = (e) => (!tipo || tiposDe(e).some((t) => tipo.has(t))) && (!grau || e.grau_confirmacao === grau) && (!lider || e.lideranca) &&
    (!interna || (interna === "1") === !!e.violencia_interna) &&
    (!esc || e.escala === esc) && (!uf || e.local.uf === uf || valorUF(e, uf) > 0) && (!window.CONTROLES || CONTROLES.povoOk(e)) &&
    (!q || JSON.stringify([e.titulo, e.resumo, e.povos, e.local, e.situacao, e.lideranca]).toLowerCase().includes(q));
  const lista = EVENTOS.filter(ok);
  visiveis = new Set(lista.map((e) => e.id));
  // total da base (todos os períodos); o número do período enquadrado fica no topo do mapa
  $("contagem").textContent = lista.length === EVENTOS.length ? `${EVENTOS.length} registros na base` : `${lista.length} de ${EVENTOS.length} registros passam nos filtros`;
  const nMais = [grau, esc, uf, lider, interna].filter(Boolean).length;
  $("mais-filtros-n").textContent = nMais ? ` (${nMais})` : "";
  $("limpar-filtros").hidden = !(nMais || tipo || q || window.CONTROLES?.povoNome());
  window.CONTROLES?.aoFiltrar?.();
  agendarRender();
}

// ================= card =================
function montarCard(ev0, ufCard = null) {
  // aberto pela bolha de um estado no mapa, ou com o filtro de estado: o número é o daquele estado
  const uf = ev0.por_uf ? (ufCard || ufFiltro()) : "";
  const ev = uf ? comUF(ev0, uf) : ev0;
  const card = $("card");
  card.style.setProperty("--cor", `var(--${ev.tipo})`);
  const fontes = el("ul", { class: "fontes" }, ...ev.fontes.map((f) => {
    let host = f.url; try { host = new URL(f.url).hostname.replace(/^www\./, ""); } catch (_) {}
    return el("li", {}, el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer" }, f.veiculo || host),
      " ", el("small", {}, `· ${FONTE_TIPO[f.tipo] || f.tipo}${f.data ? ` · ${f.data}` : ""}`));
  }));
  const d = numeroDestaque(ev);
  const outras = ev.outras_violencias || [];
  const POVOS_CURTO = 3;
  const povosCurto = ev.povos.slice(0, POVOS_CURTO);
  const povosResto = ev.povos.length - povosCurto.length;
  const localCurto = [ev.local.municipio || ev.local.terra_indigena, ev.local.uf].filter(Boolean).join(" · ") || fmtLocal(ev.local);
  const noMapa = window.MAPA?.localNoMapa(ev);
  const totalPais = numeroDestaque(ev0);
  const linhaUF = uf ? el("p", { class: "local-mapa uf-destaque" },
    `${uf}: número da tabela por estado do relatório, sem os casos que têm card próprio. Total do país: ${totalPais.num} ${totalPais.rot}.`) : null;
  const obsOutras = outras.filter((o) => o.observacao).map((o) =>
    el("p", { class: "obs" }, el("b", {}, `${TIPO_NOME[o.tipo]}: `), o.observacao));

  // camada curta: números, título, data, tags, local curto e local no mapa (aproximado muda o sentido do dado)
  const curto = [
    el("button", { class: "fechar", type: "button", "aria-label": "Fechar" }, "×"),
    el("div", { class: "destaque" },
      el("span", { class: "num" }, d.num),
      el("span", { class: "num-rot" }, d.rot, d.pre ? el("small", {}, d.pre) : null)),
    outras.length ? el("div", { class: "destaques-2" }, ...outras.map((o) => {
      const s = numeroDestaque({ ...ev, tipo: o.tipo, vitimas: o });
      return el("div", { class: "destaque-2", style: `--c: var(--${o.tipo})` },
        el("span", { class: "num2" }, s.num), el("span", {}, s.num === "?" ? s.rot : `${s.rot} · ${TIPO_NOME[o.tipo].toLowerCase()}`));
    })) : null,
    ev.lideranca ? el("div", { class: "lider" }, "◆ Liderança indígena") : null,
    el("div", { class: "data" }, fmtPeriodo(ev),
      ev.data_estimada ? el("span", { class: "data-est" }, " · data estimada") : null),
    el("h3", { id: "card-titulo" }, ev.titulo),
    el("div", { class: "meta" },
      el("span", { class: "badge tipo" }, TIPO_NOME[ev.tipo]),
      ...outras.map((o) => el("span", { class: "badge tipo", style: `--cor: var(--${o.tipo})` }, TIPO_NOME[o.tipo])),
      ...povosCurto.map((p) => el("span", { class: "badge" }, p)),
      povosResto > 0 ? el("span", { class: "badge", title: ev.povos.slice(POVOS_CURTO).join(", ") }, `+${povosResto} ${povosResto === 1 ? "povo" : "povos"}`) : null,
      el("span", { class: `badge ${ev.grau_confirmacao}` }, GRAU_NOME[ev.grau_confirmacao]),
      ev.escala === "agregado" ? el("span", { class: "badge" }, "total agregado") : null,
      ev.natureza_contagem === "estimada" ? el("span", { class: "badge" }, "estimativa") : null,
      ev.violencia_interna ? el("span", { class: "badge interna" }, "violência interna") : null,
      ev.status !== "aprovado" ? el("span", { class: `badge ${ev.status}` }, ev.status) : null),
    el("p", { class: "local" }, localCurto),
    linhaUF,
    noMapa ? el("p", { class: "local-mapa" }, `No mapa: ${noMapa}`) : null,
    el("button", { class: "expandir", type: "button", "aria-expanded": "false", "aria-controls": "card-mais" },
      el("span", { class: "expandir-txt" }, "Ver relato completo e fontes"), el("span", { "aria-hidden": "true" }, " ▾")),
  ];
  // camada completa: aberta pelo botão
  const mais = el("div", { id: "card-mais", class: "mais", tabindex: "-1", hidden: "" },
    ev.violencia_interna ? el("p", { class: "obs" }, el("b", {}, "Violência interna: "), "segundo as fontes, a violência foi cometida por indígena ou por parente da vítima. O registro tem o mesmo detalhamento dos demais e é centrado em quem sofreu a violência.") : null,
    ev.data_estimada && ev.nota_data ? el("p", { class: "obs" }, el("b", {}, "Data estimada: "), ev.nota_data) : null,
    povosResto > 0 ? el("p", { class: "obs" }, el("b", {}, "Povos: "), ev.povos.join(", ")) : null,
    fmtLocal(ev.local) !== localCurto ? el("p", { class: "local" }, fmtLocal(ev.local)) : null,
    ev.vitimas.observacao ? el("p", { class: "obs" }, ev.vitimas.observacao) : null,
    ...obsOutras,
    el("p", { class: "resumo" }, ev.resumo),
    el("p", { class: "situacao" }, el("b", {}, "Situação: "),
      ev.situacao || "Sem informação sobre investigação ou responsabilização nas fontes consultadas."),
    relacoes(ev),
    fontes,
    botaoLinkCaso(ev),
  );
  card.replaceChildren(...curto.filter((f) => f != null && f !== false), mais);
  card.classList.remove("expandido");
  card.querySelector(".fechar").addEventListener("click", () => ocultar(true));
  card.querySelector(".expandir").addEventListener("click", (e) => {
    e.stopPropagation();
    expandir(!card.classList.contains("expandido"), true);
  });
}

function botaoLinkCaso(ev) {
  const b = el("button", { type: "button", class: "rel link-caso" }, "Copiar link deste caso");
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const url = `${location.origin}${location.pathname}#caso=${encodeURIComponent(ev.id)}`;
    try { await navigator.clipboard.writeText(url); b.textContent = "Link copiado"; }
    catch (_) { prompt("Copie o link deste caso:", url); }
    setTimeout(() => (b.textContent = "Copiar link deste caso"), 2500);
  });
  return b;
}

// abre ou recolhe a camada completa; expandir fixa o card
function expandir(abrir, moverFoco = false) {
  const card = $("card"), mais = $("card-mais"), btn = card.querySelector(".expandir");
  if (!mais || !btn) return;
  if (abrir && !fixado) {
    fixado = card.dataset.id;
    card.classList.add("fixo");
    try { history.replaceState(null, "", `#caso=${encodeURIComponent(fixado)}`); } catch (_) {}
  }
  mais.hidden = !abrir;
  card.classList.toggle("expandido", abrir);
  btn.setAttribute("aria-expanded", String(abrir));
  btn.querySelector(".expandir-txt").textContent = abrir ? "Recolher" : "Ver relato completo e fontes";
  btn.lastChild.textContent = abrir ? " ▴" : " ▾";
  if (ultimoPonto) posicionar(...ultimoPonto);
  if (abrir) card.scrollTop = 0;
  if (moverFoco) (abrir ? mais : btn).focus({ preventScroll: true });
}

// ligação entre cards do mesmo evento (morte / agressão / território)
function relacoes(ev) {
  const link = (id, rotulo, cor) => {
    const b = el("button", { type: "button", class: "rel", style: cor ? `--c: var(--${cor})` : null }, rotulo);
    b.addEventListener("click", (e) => { e.stopPropagation(); abrirCaso(id); });
    return b;
  };
  if (ev.relacionado) {
    return el("p", { class: "relacoes" }, "Parte do evento: ", link(ev.relacionado.id, ev.relacionado.titulo));
  }
  if (ev.relacionados?.length) {
    return el("p", { class: "relacoes" }, "Também neste evento: ",
      ...ev.relacionados.map((r) => link(r.id, TIPO_NOME[r.tipo], r.tipo)));
  }
  return null;
}

// Posição do card: ao lado do ponto de origem, sem cobrir esse ponto nem o pin do mesmo registro no mapa.
// Testa lados do ponto, lados do pin e cantos da tela; fica com a primeira posição que não cobre nada
// (ou a que cobre menos).
const folhaCelular = matchMedia("(max-width: 760px), (max-height: 500px)");
let ultimoPonto = null;
function posicionar(px, py, id) {
  const card = $("card");
  ultimoPonto = [px, py, id];
  // no celular, o card expandido vira uma folha presa na base da tela (CSS)
  if (folhaCelular.matches && card.classList.contains("expandido")) { card.style.left = card.style.top = ""; return; }
  const w = card.offsetWidth, h = card.offsetHeight, m = 12, g = 18;
  const evitar = [[px, py, 6]];
  const pin = id && window.MAPA?.pontoTela(id);
  if (pin) evitar.push(pin);
  const cand = [[px + g, py - 24], [px - w - g, py - 24], [px - w / 2, py - h - g], [px - w / 2, py + g]];
  if (pin) cand.push([pin[0] + pin[2] + g, pin[1] - 24], [pin[0] - pin[2] - w - g, pin[1] - 24]);
  cand.push([innerWidth - w - m, m], [m, m], [innerWidth - w - m, innerHeight - h - m], [m, innerHeight - h - m]);
  const ajusta = ([x, y]) => [limitar(x, m, innerWidth - w - m), limitar(y, m, innerHeight - h - m)];
  const cobre = ([x, y]) => evitar.filter(([ex, ey, r]) => ex > x - r - 10 && ex < x + w + r + 10 && ey > y - r - 10 && ey < y + h + r + 10).length;
  let melhor = null, menor = Infinity;
  for (const c of cand.map(ajusta)) {
    const n = cobre(c);
    if (n < menor) { menor = n; melhor = c; }
    if (!n) break;
  }
  card.style.left = `${melhor[0]}px`;
  card.style.top = `${melhor[1]}px`;
}

function marcarAtiva(id) {
  document.querySelectorAll("#tl .bolha.ativa").forEach((g) => g.classList.remove("ativa"));
  if (id) document.querySelector(`#tl .bolha[data-id="${CSS.escape(id)}"]`)?.classList.add("ativa");
  if (window.MAPA) MAPA.destacar(id);
}

function mostrar(id, px, py, uf = null) {
  clearTimeout(timerOcultar);
  const ev = EVENTOS.find((e) => e.id === id);
  if (!ev) return;
  montarCard(ev, uf);
  $("card").dataset.id = id;
  $("card").hidden = false;
  $("card").scrollTop = 0;   // ao reabrir, o card começa do início, não de onde a leitura parou
  posicionar(px, py, id);
  marcarAtiva(id);
}

function fixar(id, px, py, aberto = false, uf = null) {
  fixado = null;
  mostrar(id, px, py, uf);
  fixado = id;
  $("card").classList.add("fixo");
  try { history.replaceState(null, "", `#caso=${encodeURIComponent(id)}`); } catch (_) {}
  // leitor de tela: anuncia o essencial só quando o card é aberto (no foco, o rótulo da bolha já foi lido)
  const ev = EVENTOS.find((e) => e.id === id), anuncio = $("card-anuncio");
  if (anuncio && ev) anuncio.textContent = `Aberto: ${ev.titulo}. ${fmtPeriodo(ev)}. ${fmtVitimas(ev)}.`;
  if (aberto) expandir(true);
}

function ocultar(forcar = false) {
  if (fixado && !forcar) return;
  if (fixado) { try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {} }
  // se o foco estava no card, volta para a bolha (ou o pin) de origem
  const card = $("card");
  if (card.contains(document.activeElement)) {
    const sel = `[data-id="${CSS.escape(card.dataset.id || "")}"]`;
    (document.querySelector(`#tl .bolha${sel}`) || document.querySelector(`#mapa-svg ${sel}`))?.focus({ preventScroll: true });
  }
  fixado = null;
  card.hidden = true;
  card.classList.remove("fixo", "expandido");
  const anuncio = $("card-anuncio");
  if (anuncio) anuncio.textContent = "";
  marcarAtiva(null);
}
const agendarOcultar = () => { clearTimeout(timerOcultar); timerOcultar = setTimeout(() => ocultar(), 220); };

function centroDe(g) {
  const b = g.querySelector("circle.nucleo").getBoundingClientRect();
  return [b.right, b.top + b.height / 2];
}

// ================= interação =================
function ligarInteracao() {
  const svg = $("tl"), card = $("card"), area = $("scroller");

  // hover / foco / clique nas bolhas
  svg.addEventListener("pointerover", (e) => {
    const g = e.target.closest(".bolha");
    if (!g || fixado || ponteiros.size) return;
    mostrar(g.dataset.id, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerout", (e) => { if (e.target.closest(".bolha")) agendarOcultar(); });
  svg.addEventListener("click", (e) => {
    if (arrastou) { arrastou = false; return; }
    const g = e.target.closest(".bolha");
    if (!g) return;
    e.stopPropagation();
    fixar(g.dataset.id, e.clientX, e.clientY);
  });
  svg.addEventListener("focusin", (e) => {
    const g = e.target.closest(".bolha");
    if (g && !fixado) mostrar(g.dataset.id, ...centroDe(g));
    focoNoTopo();
  });
  svg.addEventListener("focusout", () => { agendarOcultar(); requestAnimationFrame(focoNoTopo); });
  svg.addEventListener("keydown", (e) => {
    const g = e.target.closest(".bolha");
    if (!g) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fixar(g.dataset.id, ...centroDe(g));
      card.querySelector(".expandir")?.focus({ preventScroll: true });
      return;
    }
    // setas percorrem as bolhas visíveis em ordem de tempo
    const passo = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -1e6, End: 1e6 }[e.key];
    if (!passo) return;
    e.preventDefault();
    const todas = [...svg.querySelectorAll(".bolha:not(.apagada)")].sort((a, b) => centroDe(a)[0] - centroDe(b)[0]);
    const prox = todas[limitar(todas.indexOf(g) + passo, 0, todas.length - 1)];
    if (prox && prox !== g) { g.tabIndex = -1; prox.tabIndex = 0; prox.focus(); }
  });
  card.addEventListener("pointerenter", () => clearTimeout(timerOcultar));
  card.addEventListener("pointerleave", () => agendarOcultar());
  document.addEventListener("click", (e) => { if (fixado && !card.contains(e.target)) ocultar(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ocultar(true); });

  // zoom com a roda do mouse (ou trackpad); rolagem lateral move no tempo
  area.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!fixado) ocultar();
    const x = e.clientX - area.getBoundingClientRect().left;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = (e.deltaX || e.deltaY) / pxPorAno();
      definirVista(vista.a0 + d, vista.a1 + d);
    } else {
      zoomEm(anoDoX(x), Math.exp(e.deltaY * 0.0016));
    }
  }, { passive: false });

  // arrastar para navegar; pinça para zoom (toque)
  const ponteiros = new Map();
  let inicio = null;
  const estado = () => {
    const ps = [...ponteiros.values()];
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { cx, dist, vista: { ...vista }, ppa: pxPorAno() };
  };
  area.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    arrastou = false;
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX });
    inicio = estado();
  });
  area.addEventListener("pointermove", (e) => {
    const p = ponteiros.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!arrastou && Math.abs(p.x - p.x0) < 5 && ponteiros.size === 1) return;
    if (!arrastou) {
      arrastou = true;
      try { area.setPointerCapture(e.pointerId); } catch (_) {}
      area.classList.add("arrastando");
      if (!fixado) ocultar();
    }
    const agora = estado();
    const esq = area.getBoundingClientRect().left;
    if (ponteiros.size > 1 && inicio.dist) {
      // pinça: mantém o ano sob o centro dos dedos
      const span = (inicio.vista.a1 - inicio.vista.a0) * (inicio.dist / agora.dist);
      const anoCentro = inicio.vista.a0 + (inicio.cx - esq - PAD_L) / inicio.ppa;
      const frac = (agora.cx - esq - PAD_L) / (largura() - PAD_L - PAD_R);
      definirVista(anoCentro - frac * span, anoCentro - frac * span + span);
    } else {
      const d = (agora.cx - inicio.cx) / inicio.ppa;
      definirVista(inicio.vista.a0 - d, inicio.vista.a1 - d);
    }
  });
  const soltar = (e) => {
    ponteiros.delete(e.pointerId);
    area.classList.remove("arrastando");
    inicio = ponteiros.size ? estado() : null;
  };
  area.addEventListener("pointerup", soltar);
  area.addEventListener("pointercancel", soltar);

  addEventListener("resize", agendarRender);
}

// ================= navegação por período + legenda =================
function montarEras() {
  const botao = (rotulo, acao, titulo) => {
    const b = el("button", { type: "button", title: titulo || rotulo }, rotulo);
    b.addEventListener("click", acao);
    return b;
  };
  const enquadrar = (i, f) => { const pad = (f - i) * 0.03; irPara(i - pad, f + pad); };
  PERIODOS = [...ERAS.map(([i, f]) => [i, f]), [ANO_FIM - 11, ANO_FIM], [ANO_MIN, ANO_FIM, true]];
  const centro = () => (vista.a0 + vista.a1) / 2;
  $("eras").replaceChildren(
    ...ERAS.map(([i, f, nome]) => botao(nome, () => enquadrar(i, f), `Enquadrar ${nome} (${i}–${Math.min(f, ANO_FIM - 1)})`)),
    botao("Últimos 10 anos", () => enquadrar(ANO_FIM - 11, ANO_FIM)),
    botao("Tudo", () => irPara(ANO_MIN, ANO_FIM), "Ver de 1500 até hoje"),
    el("span", { class: "zoom" },
      botao("−", () => { const c = centro(), s = (vista.a1 - vista.a0) * 1.6; irPara(c - s / 2, c + s / 2); }, "Afastar"),
      botao("+", () => { const c = centro(), s = (vista.a1 - vista.a0) / 1.6; irPara(c - s / 2, c + s / 2); }, "Aproximar")),
  );
}

function montarLegenda() {
  const cores = TIPOS.map(([t, nome]) => {
    const m = sv("svg", { width: 12, height: 12 });
    m.append(sv("circle", { cx: 6, cy: 6, r: 5.5, fill: `var(--${t})` }));
    return el("span", { class: "item" }, m, nome);
  });
  const simb = (attrs, txt) => {
    const m = sv("svg", { width: 18, height: 18 });
    m.append(sv("circle", { cx: 9, cy: 9, r: 7, stroke: "var(--ink)", "stroke-width": 1.5, ...attrs }));
    return el("span", { class: "item" }, m, txt);
  };
  const lider = sv("svg", { width: 22, height: 22 });
  lider.append(sv("circle", { cx: 11, cy: 11, r: 6, fill: "var(--morte)" }));
  lider.append(sv("circle", { class: "anel-lider", cx: 11, cy: 11, r: 9.5 }));
  const multi = sv("svg", { width: 22, height: 22 });
  multi.append(sv("circle", { cx: 11, cy: 11, r: 6, fill: "var(--morte)" }));
  multi.append(sv("circle", { class: "anel-tipo", cx: 11, cy: 11, r: 9, stroke: "var(--territorio)" }));
  $("legenda").replaceChildren(
    ...cores,
    el("span", { class: "quebra-linha" }),
    el("span", { class: "item" }, multi, "anel colorido: outro tipo de violência no mesmo acontecimento"),
    el("span", { class: "item" }, lider, "liderança indígena"),
    simb({ fill: "var(--amostra)", stroke: "var(--amostra)", "fill-opacity": .85 }, "confirmado / apurado"),
    simb({ fill: "var(--amostra)", stroke: "var(--amostra)", "fill-opacity": .3, "stroke-dasharray": "3 2.5" }, "denúncia"),
    simb({ fill: "var(--amostra)", stroke: "var(--amostra)", "fill-opacity": .5 }, "estimativa"),
    (() => {
      const m = sv("svg", { width: 18, height: 18 });
      m.append(sv("circle", { cx: 9, cy: 9, r: 7.5, fill: "var(--amostra)", "fill-opacity": .85, stroke: "var(--amostra)", "stroke-width": 1.5 }));
      m.append(sv("circle", { class: "hachura", cx: 9, cy: 9, r: 6.8 }));
      return el("span", { class: "item" }, m, "total anual / agregado (hachura inclinada para a direita em morte e agressão, para a esquerda em território e indireta)");
    })(),
    simb({ fill: "var(--amostra)", stroke: "var(--amostra)", "fill-opacity": .1 }, "nº de vítimas desconhecido"),
    el("span", { class: "item" }, "Tamanho: número de vítimas em escala logarítmica (uma bolha de 100 vítimas não é 100 vezes maior que a de 1). Na linha do tempo, registros longos crescem um pouco com a duração. Em períodos com registros demais, todos ficam do mesmo tamanho até você aproximar."),
    el("span", { class: "quebra-linha" }),
    el("span", { class: "item" }, "Role o mouse ou faça pinça sobre a linha do tempo para dar zoom; arraste para navegar."),
  );
}

// período ativo: o botão cuja janela coincide com a vista fica marcado; fora disso, "personalizado"
let PERIODOS = [];
function marcarEra() {
  const botoes = [...document.querySelectorAll("#eras > button")];
  const span = vista.a1 - vista.a0;
  let ativo = -1;
  PERIODOS.forEach(([i, f, tudo], k) => {
    const pad = tudo ? 0 : (f - i) * 0.03;
    if (Math.abs(vista.a0 - Math.max(ANO_MIN, i - pad)) < span * 0.03 && Math.abs(vista.a1 - Math.min(ANO_FIM, f + pad)) < span * 0.03) ativo = k;
  });
  botoes.forEach((b, k) => b.setAttribute("aria-pressed", String(k === ativo)));
  const rot = $("janela-rot");
  if (rot) rot.textContent = `${Math.max(1500, Math.round(vista.a0))}–${Math.min(Math.round(vista.a1), ANO_FIM - 1)}`;
}

// link direto: #caso=<id> enquadra e abre o card fixado
function abrirDoLink() {
  const m = location.hash.match(/^#caso=(.+)$/);
  if (m && decodeURIComponent(m[1]) !== fixado) abrirCaso(decodeURIComponent(m[1]));
}
addEventListener("hashchange", abrirDoLink);

// enquadra o caso na linha do tempo (mantendo o zoom se já estiver visível) e fixa o card
function abrirCaso(id) {
  const ev = EVENTOS.find((e) => e.id === id);
  if (!ev) return;
  const c = anoCentral(ev).c;
  if (c < vista.a0 || c > vista.a1) definirVista(c - 6, c + 6);
  fixado = null;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const g = document.querySelector(`#tl .bolha[data-id="${CSS.escape(ev.id)}"]`);
    if (g) fixar(ev.id, ...centroDe(g), true);
  }));
}

// ================= aviso =================
// modal nativo: foco preso no aviso, fundo inerte para teclado e leitor de tela; Esc equivale a continuar
(function aviso() {
  const dlg = $("aviso");
  let visto = false;
  try { visto = localStorage.getItem("aviso-visto") === "1"; } catch (_) {}
  if (new URLSearchParams(location.search).has("sem-aviso")) visto = true;
  const continuar = () => { try { localStorage.setItem("aviso-visto", "1"); } catch (_) {} };
  $("aviso-ok").addEventListener("click", () => { continuar(); dlg.close(); });
  dlg.addEventListener("cancel", continuar);
  // "Sair" volta para a página anterior; só aparece quando há uma
  const sair = $("aviso-sair");
  if (history.length > 1 && document.referrer) { sair.hidden = false; sair.addEventListener("click", () => history.back()); }
  if (!visto) { dlg.showModal(); $("aviso-ok").focus(); }
})();

// ================= init =================
fetch("events.json")
  .then((r) => r.json())
  .then((dados) => {
    EVENTOS = dados;
    [...new Set(dados.map((e) => e.local.uf).filter(Boolean))].sort()
      .forEach((u) => $("f-uf").append(el("option", { value: u }, u)));
    montarEras();
    montarLegenda();
    ligarInteracao();
    ["f-busca", "f-grau", "f-escala", "f-uf", "f-lider", "f-interna"].forEach((id) => $(id).addEventListener("input", filtrar));
    if (window.CONTROLES) CONTROLES.iniciar();
    filtrar();
    // ?vista=1500-2027 enquadra um período específico (útil para compartilhar)
    const v = new URLSearchParams(location.search).get("vista")?.match(/^(\d{3,4})-(\d{3,4})$/);
    if (v) definirVista(+v[1], +v[2]);
    if (window.MAPA) MAPA.iniciar();
    render();
    abrirDoLink();
  })
  .catch((err) => {
    console.error(err);
    $("contagem").textContent = "Não foi possível carregar events.json. Sirva a pasta site/: `python -m http.server 8000 -d site`.";
  });
