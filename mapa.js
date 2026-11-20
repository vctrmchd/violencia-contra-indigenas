"use strict";
// MAPA ligado à linha do tempo. Desenha só os registros que passam nos filtros e estão na janela
// enquadrada, com a mesma codificação das bolhas da linha do tempo.
// Localização (pipeline/mapa/geocodificar.py): centro da TI, do município ou da UF → pin; região histórica →
// pin no centro + mancha da área aproximada (data/mapa/areas.json); abrangência nacional → grupo "Brasil" no oceano.
(function () {
  const K = Math.cos((15 * Math.PI) / 180);
  const proj = ([lon, lat]) => [(lon + 74.5) * K, 6 - lat];
  const GEO = window.GEO;

  let svg, gMapa, gAreas, gSimb, gAlvo, gNac;
  let W = 800, H = 600;
  let ajuste = { s: 10, ox: 0, oy: 0 };
  let zoom = { s: 1, tx: 0, ty: 0 };
  let posicoes = new Map();   // id → {x, y, r}
  let idDestaque = null;
  let arrastouMapa = false;

  const tela = (lonlat) => {
    const [x, y] = proj(lonlat);
    return [(ajuste.ox + x * ajuste.s) * zoom.s + zoom.tx, (ajuste.oy + y * ajuste.s) * zoom.s + zoom.ty];
  };
  const fatorZ = () => Math.pow(zoom.s, 0.35);
  // tamanho do país na tela (px) com zoom 1: em mapas pequenos (celular) os pins encolhem junto
  let fatorTela = 1;
  // símbolo do mapa: mesma lógica da bolha (log + raiz quarta), em escala menor
  const rMapa = (n) => (n == null ? 4 : Math.min(26, 3 + 2.2 * Math.log10(n + 1) + 0.4 * Math.pow(n, 0.25))) * fatorZ() * fatorTela;
  const ponto = (id) => GEO.pontos[id];

  // ---------- base ----------
  const limites = (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const inclui = (p) => { const [x, y] = proj(p); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const u of GEO.ufs) for (const anel of u.aneis) for (const p of anel) inclui(p);
    return { x0, y0, x1, y1 };
  })();
  const caminho = (aneis) => aneis.map((anel) => "M" + anel.map((p) => proj(p).map((v) => v.toFixed(3)).join(",")).join("L") + "Z").join("");
  const caminhoTodos = GEO.ufs.map((u) => caminho(u.aneis)).join("");
  const caminhoUF = Object.fromEntries(GEO.ufs.map((u) => [u.uf, caminho(u.aneis)]));
  const CENTRO_UF = Object.fromEntries(GEO.ufs.map((u) => [u.uf, u.c]));

  function encaixar() {
    const box = $("mapa").getBoundingClientRect();
    W = Math.max(200, box.width); H = Math.max(160, box.height);
    const topo = $("barra-filtros")?.offsetHeight || 0;
    const padX = 28, padT = topo + 24, padB = 40;
    const larg = W - padX * 2, alt = H - padT - padB;
    const s = Math.max(1, Math.min(larg / (limites.x1 - limites.x0), alt / (limites.y1 - limites.y0)));
    fatorTela = limitar(Math.max(limites.x1 - limites.x0, limites.y1 - limites.y0) * s / 620, 0.6, 1);
    ajuste = {
      s,
      ox: padX + (larg - (limites.x1 - limites.x0) * s) / 2 - limites.x0 * s,
      oy: padT + (alt - (limites.y1 - limites.y0) * s) / 2 - limites.y0 * s,
    };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
  }

  function montarDefs() {
    const defs = sv("defs");
    // hachura em 45°; território e indireta (azul e verde) em -45°, para separá-los também pelo ângulo
    for (const [id, ang] of [["hachura-m", 45], ["hachura-m-b", -45]]) {
      const pat = sv("pattern", { id, patternUnits: "userSpaceOnUse", width: 5, height: 5, patternTransform: `rotate(${ang})` });
      pat.append(sv("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: "var(--bg)", "stroke-width": 1.6, "stroke-opacity": 0.6 }));
      defs.append(pat);
    }
    // o grupo das manchas está em unidades do mapa (graus): região do filtro e desfoque também
    const f = sv("filter", { id: "desfoque", filterUnits: "userSpaceOnUse", x: -20, y: -20, width: 90, height: 90 });
    f.append(sv("feGaussianBlur", { stdDeviation: 0.22 }));
    defs.append(f);
    svg.append(defs);
  }

  // Grafismo: o fundo do mapa tem a textura fixa de losangos do topo do site (CSS, não se move com o mapa);
  // em volta do país, 2 linhas que acompanham o litoral e as fronteiras, a de fora mais transparente.
  // O fundo liso entre a costa e as linhas separa o país da textura. Neutro, fora da paleta de dados,
  // sem copiar o padrão de nenhum povo. Cada linha são 2 contornos do país inteiro, pesados para repintar
  // no arraste: por isso só 2.
  function grafismo() {
    const g = sv("g", { class: "grafismo-costa", "pointer-events": "none" });
    const GAP = 7, OPAC = [0.22, 0.08];   // da linha mais próxima da costa para a mais distante
    for (let k = OPAC.length; k >= 1; k--) {
      g.append(sv("path", { d: caminhoTodos, class: "anel-costa", "stroke-width": 2 * k * GAP, "stroke-opacity": OPAC[k - 1], "vector-effect": "non-scaling-stroke" }));
      g.append(sv("path", { d: caminhoTodos, class: "anel-fundo", "stroke-width": 2 * k * GAP - 1.2, "vector-effect": "non-scaling-stroke" }));
    }
    return g;
  }

  // ---------- desenho ----------
  function listaAtual() {
    return EVENTOS.filter((e) => (!visiveis || visiveis.has(e.id)) && naJanelaAtual(e));
  }

  // Redesenho agrupado num quadro: roda e arraste disparam vários eventos por quadro.
  let pedidoMapa = 0;
  function agendarDesenho() {
    if (!pedidoMapa) pedidoMapa = requestAnimationFrame(() => { pedidoMapa = 0; desenhar(); });
  }

  let chaveAnterior = "";
  function desenhar() {
    if (!svg) return;
    const lista = listaAtual();
    const ate = Math.min(Math.round(vista.a1), ANO_FIM - 1);
    $("mapa-titulo").textContent = `${Math.max(1500, Math.round(vista.a0))}–${ate}`;
    // a linha do tempo pede o mapa a cada quadro de zoom; se nem os registros nem o enquadramento mudaram, nada a refazer
    const chave = `${W},${H},${ajuste.s},${ajuste.ox},${ajuste.oy},${zoom.s},${zoom.tx},${zoom.ty},${window.CONTROLES?.povoNome() || ""}|${ufFiltro()}|${GEO.avanco ? marcoAvanco().ano : ""}|${lista.map((e) => e.id).join(",")}`;
    if (chave === chaveAnterior) { destacar(idDestaque); return; }
    chaveAnterior = chave;
    const t = `translate(${zoom.tx} ${zoom.ty}) scale(${zoom.s}) translate(${ajuste.ox} ${ajuste.oy}) scale(${ajuste.s})`;
    attr(gMapa, "transform", t);
    attr(gAreas, "transform", t);
    posicoes = new Map();
    gNac.replaceChildren();

    // manchas das regiões aproximadas (embaixo de tudo): em unidades do mapa, não mudam com o zoom; criadas uma vez
    const evAvanco = GEO.avanco && lista.find((ev) => ev.id === ID_AVANCO);
    const marco = evAvanco ? marcoAvanco() : null;
    ordenarFilhos(gAreas, [...(marco ? [noAvanco(marco, evAvanco)] : []), ...lista.filter((ev) => GEO.areas[ev.id]).map(noArea)]);

    const itens = [];
    let nNac = 0, nPorUF = 0;
    for (const ev of lista) {
      const p = ponto(ev.id);
      if (!p) continue;
      const nac = p[2] === "nacional";
      // total nacional com tabela por estado no próprio relatório (campo por_uf): uma bolha por estado,
      // só no desenho; o registro continua um só na linha do tempo e no placar
      // valores já sem os casos com card próprio (export); com filtro de estado, só a bolha daquele estado
      const porUF = nac && (ev.por_uf?.descontados || ev.por_uf?.valores);
      if (porUF) {
        nPorUF++;
        const ufF = ufFiltro();
        for (const [uf, v] of Object.entries(porUF)) {
          const c = CENTRO_UF[uf];
          if (!c || !v || (ufF && uf !== ufF)) continue;
          const [x, y] = tela(c);
          itens.push({ ev, x, y, r: rMapa(v), nac: false, uf, v, chave: `${ev.id}@${uf}` });
        }
        continue;
      }
      // colapso demográfico colonial: o pin sai do grupo nacional e fica no centro da mancha do marco visível
      if (ev === evAvanco && marco) {
        const [x, y] = tela(marco.centro);
        itens.push({ ev, x, y, r: rMapa(nVitimas(ev)), nac: false, chave: ev.id });
        continue;
      }
      if (nac) nNac++;
      // totais do país sem local: montados em volta de (0, 0) e levados depois para o canto do mapa
      const [x, y] = nac ? [0, 0] : tela(p);
      // totais do país: no máximo do tamanho dos maiores pins do mapa, para o bloco não parecer um segundo país
      itens.push({ ev, x, y, r: nac ? Math.min(rMapa(nVitimas(ev)), rMapa(200)) : rMapa(nVitimas(ev)), nac, chave: ev.id });
    }
    const final = agrupar(itens);
    espalhar(final.filter((i) => !i.nac));
    // bloco "Brasil inteiro": fixo no canto inferior direito, acima da legenda (não se move com o zoom)
    const nacs = final.filter((i) => i.nac);
    let nacCentro = null, nacRaio = 0;
    if (nacs.length) {
      espalhar(nacs);
      nacRaio = Math.max(...nacs.map((i) => Math.hypot(i.x, i.y) + i.r), 12) + 8;
      const leg = document.querySelector(".micro-legenda");
      const altLeg = leg ? leg.offsetHeight + 12 : 12;
      nacCentro = [W - 14 - nacRaio, H - altLeg - 12 - nacRaio];
      for (const i of nacs) { i.x += nacCentro[0]; i.y += nacCentro[1]; }
    }
    final.sort((a, b) => b.r - a.r);
    ordenarFilhos(gSimb, final.map((it) => (it.grupo ? desenharGrupo(it) : desenharPin(it))));

    if (nacCentro) {
      const [x, y] = nacCentro;
      gNac.append(sv("circle", { class: "nac-aro", cx: x, cy: y, r: nacRaio }));
      // rótulo acima do círculo, dentro da tela
      const tx = limitar(x, 80, W - 80);
      gNac.append(sv("text", { class: "nac-rot", x: tx, y: y - nacRaio - 22 }, "Brasil inteiro"));
      gNac.append(sv("text", { class: "nac-rot nac-sub", x: tx, y: y - nacRaio - 8 }, "totais sem local definido"));
    }

    const conta = (k) => lista.filter((e) => ponto(e.id)?.[2] === k && !(k === "nacional" && e.por_uf)).length;
    const partes = [[conta("ti"), "no centro da terra indígena"], [conta("municipio") + conta("municipios"), "no centro do município"],
      [conta("area") + conta("regiao"), "numa região aproximada"], [conta("uf"), "no centro do estado (as fontes só dão o estado)"],
      [nPorUF, nPorUF === 1 ? "total do país dividido por estado" : "totais do país divididos por estado"], [nNac, "totais do país sem local definido"]];
    const povo = window.CONTROLES?.povoNome();
    $("mapa-resumo").textContent = (povo ? `${povo}: ` : "") + `${lista.length} ${lista.length === 1 ? "registro" : "registros"} no período` +
      (visiveis && visiveis.size < EVENTOS.length ? " e nos filtros" : "");
    // a composição detalhada da localização vai para o "Como ler"
    const loc = $("legenda-local");
    if (loc) loc.textContent = lista.length ? `No período e nos filtros atuais, ${lista.length} ${lista.length === 1 ? "registro" : "registros"}: ` +
      partes.filter(([n]) => n).map(([n, t]) => `${n} ${t}`).join("; ") + "." : "";
    rovingInicial();
    destacar(idDestaque);
  }

  // Mapa pequeno (celular) sem zoom: pins que caem na mesma célula de 34 px viram um círculo com o número
  // de registros; tocar nele abre a lista do aglomerado. Aproximar o mapa desfaz os grupos.
  function agrupar(itens) {
    if (W > 620 || zoom.s >= 2.5) return itens;
    const CEL = 34, celulas = new Map();
    for (const it of itens) {
      if (it.nac) continue;
      const k = `${Math.floor(it.x / CEL)},${Math.floor(it.y / CEL)}`;
      (celulas.get(k) || celulas.set(k, []).get(k)).push(it);
    }
    const saem = new Set(), grupos = [];
    for (const [k, g] of celulas) {
      if (g.length < 3) continue;
      g.forEach((it) => saem.add(it));
      const x = g.reduce((s, it) => s + it.x, 0) / g.length, y = g.reduce((s, it) => s + it.y, 0) / g.length;
      grupos.push({ grupo: g, x, y, r: Math.min(CEL / 2 - 2, 7 + 1.5 * Math.log2(g.length)), chave: `grupo:${k}` });
    }
    return [...itens.filter((it) => !saem.has(it)), ...grupos];
  }
  const grupoNos = new Map();
  function desenharGrupo(it) {
    let p = grupoNos.get(it.chave);
    if (!p) {
      const g = sv("g", { class: "simb aglom", tabindex: -1, role: "button" });
      p = { g, nucleo: sv("circle", { class: "nucleo aglom-nucleo" }), n: sv("text", { class: "aglom-n" }), alvo: sv("circle", { class: "alvo-toque" }) };
      g.append(p.nucleo, p.n, p.alvo);
      grupoNos.set(it.chave, p);
    }
    const ids = [...new Set(it.grupo.map((i) => i.ev.id))];
    p.g.dataset.id = it.chave;
    p.g.dataset.ids = ids.join(" ");
    p.g.setAttribute("aria-label", `${ids.length} registros agrupados nesta área. Enter abre a lista.`);
    const cx = it.x.toFixed(1), cy = it.y.toFixed(1);
    for (const c of [p.nucleo, p.alvo]) { attr(c, "cx", cx); attr(c, "cy", cy); }
    attr(p.nucleo, "r", it.r.toFixed(1)); attr(p.alvo, "r", Math.max(14, it.r + 3).toFixed(1));
    attr(p.n, "x", cx); attr(p.n, "y", cy); p.n.textContent = String(ids.length);
    posicoes.set(it.chave, { x: it.x, y: it.y, r: it.r });
    // cada registro do grupo aponta para o círculo (destaque cruzado e posição do card)
    for (const id of ids) if (!posicoes.has(id)) posicoes.set(id, { x: it.x, y: it.y, r: it.r, grupo: it.chave });
    return p.g;
  }

  // Vários registros no mesmo ponto se abrem em espiral (ângulo áureo), maiores no centro.
  function espalhar(itens) {
    const grupos = new Map();
    for (const it of itens) {
      const k = `${Math.round(it.x / 3)},${Math.round(it.y / 3)}`;
      (grupos.get(k) || grupos.set(k, []).get(k)).push(it);
    }
    for (const g of grupos.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => b.r - a.r);
      const passo = Math.max(5, g.reduce((s, it) => s + it.r, 0) / g.length) * 1.25;
      g.forEach((it, k) => {
        if (!k) return;
        const ang = k * 2.39996, d = passo * Math.sqrt(k) + g[0].r * 0.5;
        it.x += Math.cos(ang) * d; it.y += Math.sin(ang) * d;
      });
    }
  }

  // ---------- mancha de avanço da ocupação colonial (data/mapa/avanco_colonial.json, Atlas FGV/CPDOC) ----------
  // Acompanha o card de colapso demográfico colonial: mostra o marco mais recente que não passa do fim da janela.
  const ID_AVANCO = "depopulacao-pos-contato";
  const avancoNos = new Map();
  function marcoAvanco() {
    const ms = GEO.avanco.marcos;
    const m = [...ms].reverse().find((x) => x.ano <= vista.a1) || ms[0];
    if (!m.centro) {
      const n = m.celulas.length;
      m.centro = [m.celulas.reduce((s, c) => s + c[0], 0) / n, m.celulas.reduce((s, c) => s + c[1], 0) / n];
    }
    return m;
  }
  function noAvanco(m, ev) {
    let g = avancoNos.get(m.ano);
    if (g) return g;
    const h = GEO.avanco.passo / 2;
    const w = (2 * h * K * 1.15).toFixed(3), a = (2 * h * 1.15).toFixed(3);
    const d = m.celulas.map(([lon, lat]) => { const [x, y] = proj([lon - h, lat + h]); return `M${x.toFixed(3)},${y.toFixed(3)}h${w}v${a}h-${w}Z`; }).join("");
    g = sv("g", { class: "area avanco", "data-id": ev.id, style: `--c: var(--${ev.tipo})`, filter: "url(#desfoque)" });
    g.append(sv("path", { d }));
    avancoNos.set(m.ano, g);
    return g;
  }

  // ---------- elementos reaproveitados (um pin e uma mancha por registro, criados na primeira vez) ----------
  const pins = new Map(), areasNos = new Map();
  function noArea(ev) {
    let g = areasNos.get(ev.id);
    if (g) return g;
    const a = GEO.areas[ev.id];
    g = sv("g", { class: "area", "data-id": ev.id, style: `--c: var(--${ev.tipo})`, filter: "url(#desfoque)" });
    for (const uf of a.ufs) g.append(sv("path", { d: caminhoUF[uf], class: "area-uf" }));
    for (const grupo of a.grupos) {
      const d = "M" + grupo.map((p) => proj(p).map((v) => v.toFixed(3)).join(",")).join("L") + (grupo.length > 2 ? "Z" : "");
      g.append(sv("path", { d: grupo.length === 1 ? `${d}l0.001,0` : d, class: "area-casco", "stroke-width": (a.folga * 2 * 0.97).toFixed(3) }));
    }
    areasNos.set(ev.id, g);
    return g;
  }
  // o que depende só do registro (cores, codificação, anéis, rótulo) é fixado na criação; o resto muda por atributo
  function noPin(ev, it = {}) {
    const chave = it.chave || ev.id;
    let p = pins.get(chave);
    if (p) return p;
    const cor = `var(--${ev.tipo})`;
    const rotulo = it.uf ? `${it.uf}: ${it.v} segundo a tabela por estado do relatório, sem os casos com card próprio. Total do país: ${rotuloAcessivel(ev)}` : rotuloAcessivel(ev);
    const g = sv("g", { class: it.uf ? "simb por-uf" : "simb", "data-id": ev.id, "data-uf": it.uf || null, tabindex: -1, role: "button", "aria-label": rotulo });
    p = { g, aneis: [], lider: null, nucleo: null, hachura: null, alvo: null };
    for (const o of ev.outras_violencias || []) { const c = sv("circle", { class: "anel-tipo", stroke: `var(--${o.tipo})`, "stroke-width": 1.6 }); p.aneis.push(c); g.append(c); }
    if (ev.lideranca) { p.lider = sv("circle", { class: "anel-lider" }); g.append(p.lider); }
    const desconhecido = nVitimas(ev) == null, estimada = ev.natureza_contagem === "estimada", denuncia = ev.grau_confirmacao === "denuncia";
    // borda na cor do fundo separa pins sobrepostos; a denúncia mantém o contorno tracejado na cor do tipo
    p.nucleo = sv("circle", { class: "nucleo", fill: cor, stroke: denuncia || desconhecido ? cor : "var(--bg)", "stroke-width": denuncia ? 1.6 : 0.9,
      "fill-opacity": desconhecido ? 0.12 : denuncia ? 0.35 : estimada ? 0.55 : 0.8, "stroke-dasharray": denuncia ? "3 2.5" : null });
    g.append(p.nucleo);
    const hb = ev.tipo === "territorio" || ev.tipo === "indireta";
    if (ev.escala === "agregado") { p.hachura = sv("circle", { fill: hb ? "url(#hachura-m-b)" : "url(#hachura-m)", "pointer-events": "none" }); g.append(p.hachura); }

    p.alvo = sv("circle", { class: "alvo-toque" });
    g.append(p.alvo);
    pins.set(chave, p);
    return p;
  }
  function desenharPin(it) {
    const { ev } = it, p = noPin(ev, it), cx = it.x.toFixed(1), cy = it.y.toFixed(1);
    const centro = (c) => { attr(c, "cx", cx); attr(c, "cy", cy); };
    p.aneis.forEach((c, k) => { centro(c); attr(c, "r", (it.r + 2.5 + k * 2.5).toFixed(1)); });
    if (p.lider) { centro(p.lider); attr(p.lider, "r", (it.r + 3 + p.aneis.length * 2.5).toFixed(1)); }
    centro(p.nucleo); attr(p.nucleo, "r", it.r.toFixed(1));
    if (p.hachura) { centro(p.hachura); attr(p.hachura, "r", Math.max(1, it.r - 0.7).toFixed(1)); }
    centro(p.alvo); attr(p.alvo, "r", Math.max(12, it.r + 3).toFixed(1));
    // registro distribuído por estado: a mira do destaque fica na maior bolha dele
    const atual = posicoes.get(ev.id);
    if (!atual || atual.grupo || !it.uf || it.r > atual.r) posicoes.set(ev.id, { x: it.x, y: it.y, r: it.r });
    return p.g;
  }

  // ---------- destaque cruzado (linha do tempo ⇄ mapa) ----------
  function destacar(id) {
    idDestaque = id;
    if (!gAlvo) return;
    gAlvo.replaceChildren();
    gSimb.querySelectorAll(".simb.ativa").forEach((g) => g.classList.remove("ativa"));
    gAreas.querySelectorAll(".area.ativa").forEach((g) => g.classList.remove("ativa"));
    if (!id) return;
    gAreas.querySelector(`.area[data-id="${CSS.escape(id)}"]`)?.classList.add("ativa");
    const p = posicoes.get(id);
    if (!p) return;
    gSimb.querySelector(`.simb[data-id="${CSS.escape(p.grupo || id)}"]`)?.classList.add("ativa");
    const r = p.r + 7;
    gAlvo.append(sv("circle", { class: "mira", cx: p.x, cy: p.y, r }));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      gAlvo.append(sv("line", { class: "mira", x1: p.x + dx * (r + 3), y1: p.y + dy * (r + 3), x2: p.x + dx * (r + 11), y2: p.y + dy * (r + 11) }));
    }
  }

  // ---------- teclado: uma parada de Tab no mapa; ←/→ percorrem de oeste a leste, ↑/↓ de norte a sul ----------
  const ordenados = (eixo = "x") => [...gSimb.querySelectorAll(".simb")].sort((a, b) => {
    const pa = posicoes.get(a.dataset.id), pb = posicoes.get(b.dataset.id);
    return eixo === "y" ? pa.y - pb.y || pa.x - pb.x : pa.x - pb.x || pa.y - pb.y;
  });
  function rovingInicial() {
    // o pin com foco continua sendo a parada de Tab (o redesenho não pode tirá-lo de quem está nele)
    const focado = document.activeElement?.closest?.(".simb");
    if (focado && gSimb.contains(focado)) {
      for (const g of gSimb.querySelectorAll('.simb[tabindex="0"]')) if (g !== focado) g.tabIndex = -1;
      focado.tabIndex = 0;
      return;
    }
    // os pins são reaproveitados: tira a parada de Tab do render anterior antes de escolher a nova
    for (const g of gSimb.querySelectorAll('.simb[tabindex="0"]')) g.tabIndex = -1;
    const todos = ordenados();
    const atual = todos.find((g) => g.dataset.id === (fixado || idDestaque)) || todos[0];
    if (atual) atual.tabIndex = 0;
  }
  function moverFoco(atual, delta, eixo = "x") {
    const todos = ordenados(eixo);
    const i = todos.indexOf(atual);
    const prox = todos[limitar(i + delta, 0, todos.length - 1)];
    if (!prox || prox === atual) return;
    atual.tabIndex = -1; prox.tabIndex = 0; prox.focus();
  }

  // ---------- interação no mapa ----------
  function ligar() {
    const area = $("mapa");
    const centroSimb = (g) => { const b = g.querySelector(".nucleo").getBoundingClientRect(); return [b.right, b.top + b.height / 2]; };
    svg.addEventListener("pointerover", (e) => {
      const g = e.target.closest(".simb");
      if (!g || g.dataset.ids || fixado || arrastouMapa) return;
      mostrar(g.dataset.id, e.clientX, e.clientY, g.dataset.uf);
    });
    svg.addEventListener("pointerout", (e) => { if (e.target.closest(".simb")) agendarOcultar(); });
    svg.addEventListener("focusin", (e) => {
      const g = e.target.closest(".simb");
      if (g && !g.dataset.ids && !fixado) mostrar(g.dataset.id, ...centroSimb(g), g.dataset.uf);
    });
    svg.addEventListener("focusout", () => agendarOcultar());
    svg.addEventListener("keydown", (e) => {
      const g = e.target.closest(".simb");
      if (!g) return;
      if ((e.key === "Enter" || e.key === " ") && g.dataset.ids) {
        e.preventDefault();
        const [x, y] = centroSimb(g), b = svg.getBoundingClientRect();
        abrirGrupo(g.dataset.ids.split(" "), x - b.left, y - b.top);
      }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fixar(g.dataset.id, ...centroSimb(g), false, g.dataset.uf); $("card").querySelector(".expandir")?.focus({ preventScroll: true }); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moverFoco(g, 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); moverFoco(g, -1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moverFoco(g, 1, "y"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moverFoco(g, -1, "y"); }
      else if (e.key === "Home") { e.preventDefault(); moverFoco(g, -1e6); }
      else if (e.key === "End") { e.preventDefault(); moverFoco(g, 1e6); }
    });
    let tipoPonteiro = "mouse";
    svg.addEventListener("pointerdown", (e) => { tipoPonteiro = e.pointerType; }, true);
    svg.addEventListener("click", (e) => {
      if (arrastouMapa) { arrastouMapa = false; return; }
      const g = e.target.closest(".simb");
      if (!g) { fecharGrupo(); return; }
      e.stopPropagation();
      if (g.dataset.ids) {
        const b = svg.getBoundingClientRect();
        ocultar(true); abrirGrupo(g.dataset.ids.split(" "), e.clientX - b.left, e.clientY - b.top); return;
      }
      // no toque, os pins de um aglomerado ficam pequenos demais para o dedo: abre a lista dos que estão perto
      if (tipoPonteiro !== "mouse") {
        const b = svg.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
        const perto = [...posicoes].filter(([id, p]) => !p.grupo && !id.startsWith("grupo:") && Math.hypot(p.x - x, p.y - y) <= Math.max(22, p.r + 10)).map(([id]) => id);
        if (perto.length > 1) { ocultar(true); abrirGrupo(perto, x, y); return; }
      }
      fecharGrupo();
      fixar(g.dataset.id, e.clientX, e.clientY, false, g.dataset.uf);
    });

    // zoom com a roda e arraste para mover (independentes da linha do tempo)
    const zoomEm = (px, py, fator) => {
      const s = limitar(zoom.s * fator, 1, 14), f = s / zoom.s;
      zoom = { s, tx: px - (px - zoom.tx) * f, ty: py - (py - zoom.ty) * f };
      if (s === 1) zoom = { s: 1, tx: 0, ty: 0 };
      agendarDesenho();
    };
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const b = area.getBoundingClientRect();
      zoomEm(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * 0.0018));
    }, { passive: false });
    let ini = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      ini = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty, id: e.pointerId };
      arrastouMapa = false;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!ini || e.pointerId !== ini.id) return;
      const dx = e.clientX - ini.x, dy = e.clientY - ini.y;
      if (!arrastouMapa && Math.hypot(dx, dy) < 5) return;
      if (!arrastouMapa) { arrastouMapa = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} area.classList.add("arrastando"); if (!fixado) ocultar(); }
      if (zoom.s > 1) { zoom.tx = ini.tx + dx; zoom.ty = ini.ty + dy; agendarDesenho(); }
    });
    const soltar = () => { ini = null; area.classList.remove("arrastando"); setTimeout(() => (arrastouMapa = false), 0); };
    svg.addEventListener("pointerup", soltar);
    svg.addEventListener("pointercancel", soltar);
    // teclado no mapa: + / − aproximam, Shift+setas movem
    area.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea")) return;
      if (e.key === "+" || e.key === "=") { zoomEm(W / 2, H / 2, 1.4); e.preventDefault(); }
      else if (e.key === "-") { zoomEm(W / 2, H / 2, 1 / 1.4); e.preventDefault(); }
      else if (e.shiftKey && e.key.startsWith("Arrow") && zoom.s > 1) {
        const d = 60, m = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
        zoom.tx += m[0]; zoom.ty += m[1]; agendarDesenho(); e.preventDefault(); e.stopPropagation();
      }
    }, true);

    const centro = () => [W / 2, H / 2];
    $("mapa-mais").addEventListener("click", () => zoomEm(...centro(), 1.6));
    $("mapa-menos").addEventListener("click", () => zoomEm(...centro(), 1 / 1.6));
    $("mapa-brasil").addEventListener("click", () => { zoom = { s: 1, tx: 0, ty: 0 }; agendarDesenho(); });
    new ResizeObserver(() => { encaixar(); desenhar(); }).observe(area);
  }

  // ---------- lista de um aglomerado (toque) ----------
  function abrirGrupo(ids, x, y) {
    let caixa = $("grupo-lista");
    if (!caixa) {
      caixa = el("div", { id: "grupo-lista", class: "grupo-lista", role: "dialog", "aria-label": "Registros neste ponto" });
      caixa.addEventListener("click", (e) => e.stopPropagation());
      caixa.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGrupo(); });
      $("mapa").append(caixa);
      document.addEventListener("click", fecharGrupo);
    }
    const evs = ids.map((id) => EVENTOS.find((e) => e.id === id)).sort((a, b) => anoCentral(b).ini - anoCentral(a).ini);
    caixa.replaceChildren(el("p", {}, `${evs.length} registros neste ponto`), ...evs.map((ev) => {
      const b = el("button", { type: "button", class: "item-grupo", style: `--c: var(--${ev.tipo})` },
        ev.titulo, el("small", {}, `${fmtPeriodo(ev)} · ${fmtVitimas(ev)}`));
      b.addEventListener("click", () => { const r = b.getBoundingClientRect(); fecharGrupo(); fixar(ev.id, r.right, r.top + r.height / 2); });
      return b;
    }));
    caixa.hidden = false;
    const W0 = $("mapa").clientWidth, H0 = $("mapa").clientHeight;
    caixa.style.left = `${limitar(x - 150, 12, Math.max(12, W0 - caixa.offsetWidth - 12))}px`;
    caixa.style.top = `${limitar(y + 18, 12, Math.max(12, H0 - caixa.offsetHeight - 12))}px`;
    caixa.querySelector("button")?.focus();
  }
  function fecharGrupo() { const c = $("grupo-lista"); if (c) c.hidden = true; }

  // ---------- legenda do mapa (vai para o modal "Como ler") ----------
  function legenda() {
    const alvo = $("legenda-mapa");
    if (!alvo) return;
    const ico = (desenho) => { const m = sv("svg", { width: 30, height: 24, "aria-hidden": "true" }); desenho(m); return m; };
    const item = (m, txt) => el("span", { class: "item" }, m, txt);
    alvo.replaceChildren(
      item(ico((m) => m.append(sv("circle", { cx: 15, cy: 12, r: 6, fill: "var(--morte)", "fill-opacity": .9, stroke: "var(--morte)" }))),
        "Pin: onde aconteceu — centro da terra indígena, do município ou, quando as fontes só dizem o estado, do estado. Mesmas cores e preenchimentos da linha do tempo."),
      item(ico((m) => { m.append(sv("ellipse", { cx: 15, cy: 12, rx: 14, ry: 9, fill: "var(--territorio)", "fill-opacity": .25 })); m.append(sv("circle", { cx: 15, cy: 12, r: 4, fill: "var(--territorio)" })); }),
        "Mancha: região aproximada de conflitos e registros que abrangem uma área (desenhada pelo projeto a partir da região citada no card)."),
      item(ico((m) => { m.append(sv("path", { d: "M3 20 Q5 4 14 3 Q24 3 27 9 Q20 11 16 20 Z", fill: "var(--indireta)", "fill-opacity": .3 })); m.append(sv("circle", { cx: 15, cy: 11, r: 4, fill: "var(--indireta)" })); }),
        "Ocupação colonial: com o card do colapso demográfico da Colônia na tela, a mancha mostra a área ocupada pelos portugueses no fim do período enquadrado (séculos 16, 17 e 18), extraída de mapas do Atlas Histórico do Brasil (FGV/CPDOC). É aproximação do projeto."),
      item(ico((m) => { m.append(sv("circle", { cx: 15, cy: 12, r: 10.5, fill: "none", stroke: "var(--muted)", "stroke-dasharray": "2 3" })); m.append(sv("circle", { cx: 12, cy: 11, r: 3.5, fill: "var(--morte)" })); m.append(sv("circle", { cx: 18, cy: 14, r: 3, fill: "var(--territorio)" })); }),
        "Brasil inteiro: totais do país sem local definido, agrupados no canto do mapa, acima da legenda. Cada bolha é um total, não um caso."),
      item(ico((m) => [[9, 9, 4], [20, 14, 6]].forEach(([cx, cy, r]) => { m.append(sv("circle", { cx, cy, r, fill: "var(--morte)", "fill-opacity": .9 })); m.append(sv("circle", { cx, cy, r: r - .7, fill: "url(#hachura-m)" })); })),
        "Totais do Cimi com tabela por estado no relatório: o mesmo total aparece dividido em bolhas, uma por estado, com os números da tabela. É um registro só na linha do tempo e no placar."),
      item(ico((m) => [[15, 12, 5], [21, 9, 3], [10, 17, 3], [20, 17, 2.5]].forEach(([cx, cy, r]) => m.append(sv("circle", { cx, cy, r, fill: "var(--agressao_fisica)", stroke: "var(--bg)", "stroke-width": 1 })))),
        "Vários registros no mesmo lugar se abrem em espiral. No celular, tocar num aglomerado abre a lista dos registros dele."),
      item(ico((m) => { m.append(sv("circle", { cx: 15, cy: 12, r: 10, class: "aglom-nucleo", fill: "var(--surface-2)", stroke: "var(--ink)", "stroke-width": 1.4 })); m.append(sv("text", { x: 15, y: 16, "text-anchor": "middle", fill: "var(--ink)", "font-size": 11, "font-weight": 700 }, "12")); }),
        "Em telas pequenas, registros muito próximos viram um círculo com o número deles; tocar abre a lista, aproximar o mapa separa."),
      el("p", { class: "legenda-nota" }, "Roda do mouse ou + / − sobre o mapa: zoom · arraste ou Shift + setas: mover · Tab entra no mapa; ← e → percorrem os registros de oeste para leste, ↑ e ↓ de norte para sul."),
    );
  }

  function iniciar() {
    svg = $("mapa-svg");
    montarDefs();
    gMapa = sv("g", { class: "base" });
    gMapa.append(grafismo());
    const gUfs = sv("g", { class: "ufs" });
    for (const u of GEO.ufs) gUfs.append(sv("path", { d: caminhoUF[u.uf], "data-uf": u.uf, "vector-effect": "non-scaling-stroke" }));
    gMapa.append(gUfs);
    gAreas = sv("g", { class: "areas", "pointer-events": "none" });
    gNac = sv("g", { class: "nacional", "pointer-events": "none" });
    gSimb = sv("g", { class: "simbolos" });
    gAlvo = sv("g", { class: "alvos", "pointer-events": "none" });
    svg.append(gMapa, gAreas, gNac, gSimb, gAlvo);
    encaixar();
    ligar();
    legenda();
  }

  // texto da localização para o card
  function localNoMapa(ev) {
    const p = ponto(ev.id);
    if (!p) return null;
    if (ev.id === ID_AVANCO && GEO.avanco) {
      const m = marcoAvanco();
      return `mancha da ocupação colonial portuguesa (${m.rotulo}), aproximação do projeto sobre mapas do Atlas Histórico do Brasil (FGV/CPDOC); não é a área onde viviam os povos indígenas`;
    }
    if (p[2] === "nacional" && ev.por_uf) {
      const n = Object.keys(ev.por_uf.valores).length;
      return `distribuído em ${n} estados pela tabela "${ev.por_uf.tabela.toLowerCase()}" do relatório; só no mapa, o total segue um registro`;
    }
    return {
      ti: `centro da terra indígena ${p[3].replace(/^TIs? /, "")}`,
      municipio: "centro do município",
      municipios: "entre os municípios citados",
      regiao: "lugar citado na região do registro (aproximado)",
      area: "região aproximada, desenhada a partir do local citado",
      uf: "centro do estado (as fontes não dão o local exato)",
      nacional: "abrangência nacional",
    }[p[2]];
  }

  function pontoTela(id) {
    const p = posicoes.get(id);
    if (!p || !svg || !svg.getClientRects().length) return null;
    const b = svg.getBoundingClientRect();
    const x = b.left + p.x, y = b.top + p.y;
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null;
    return [x, y, p.r + 8];
  }

  window.MAPA = { iniciar, desenhar, destacar, localNoMapa, pontoTela, reencaixar: () => { encaixar(); desenhar(); } };
})();
