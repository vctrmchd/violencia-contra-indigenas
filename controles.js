"use strict";
// CONTROLES da interface: chips de tipo (filtro + legenda de cor), filtro e perfil por povo,
// "Mais filtros", modal "Como ler", ocultar painel / linha do tempo (os períodos continuam ativos), lista em texto
// com CSV, endereço com todos os filtros (compartilhável) e abas no celular.
(function () {
  const anunciar = (txt) => { const a = $("anuncio"); a.textContent = ""; requestAnimationFrame(() => (a.textContent = txt)); };
  const reencaixar = () => requestAnimationFrame(() => { window.MAPA && MAPA.reencaixar(); agendarRender(); });
  const params = new URLSearchParams(location.search);

  // ---------- chips de tipo ----------
  function chips() {
    const alvo = $("chips-tipo");
    alvo.replaceChildren(...TIPOS.map(([t, nome]) => {
      const b = el("button", { type: "button", class: "chip-tipo", "data-tipo": t, "aria-pressed": "true", style: `--c: var(--${t})`,
        title: `Mostrar ou ocultar: ${nome}` },
        el("span", { class: "amostra", "aria-hidden": "true" }), nome.replace(" (doença, contaminação)", ""));
      b.addEventListener("click", () => {
        const todos = tiposLigados.size === TIPOS.length;
        if (todos) { tiposLigados.clear(); tiposLigados.add(t); }          // 1º clique: só este tipo
        else if (tiposLigados.has(t)) tiposLigados.delete(t);
        else tiposLigados.add(t);
        if (!tiposLigados.size) TIPOS.forEach(([x]) => tiposLigados.add(x)); // nenhum = todos
        sincronizarChips();
        filtrar();
      });
      return b;
    }));
  }
  function sincronizarChips() {
    const todos = tiposLigados.size === TIPOS.length;
    document.querySelectorAll(".chip-tipo").forEach((b) => {
      b.setAttribute("aria-pressed", String(tiposLigados.has(b.dataset.tipo)));
      b.classList.toggle("todos", todos);
    });
  }

  // ---------- povos ----------
  // Agrupa grafias do mesmo povo: sem acento/maiúscula e sem o parêntese ("Guajajara (Tenetehara)" = "Guajajara").
  // Nomes diferentes para o mesmo povo (autodenominação × nome dado de fora) só se juntam pela lista explícita
  // EQUIVALENTES abaixo; não há união automática, para não fundir povos distintos (ex.: Tapayuna × Kĩsêdjê,
  // Pataxó × Pataxó Hã-Hã-Hãe). "A / B" conta para os dois.
  const VARIOS = /^(diversos|varios povos|outros povos|povos d[oe]s? |povos je |povos indigenas |tapuios)/;
  const SEM_ID = /^povos? nao (identificado|nomeado)/;
  const NAO_E_POVO = /^ribeirinhos$/;   // população não indígena citada no card: não entra na lista de povos
  const APELIDOS_POVO = {   // grafias que a regra automática não junta
    "huni kui": "huni kuin", "guarani nandeva": "guarani nhandeva", "akroa gamella": "akroa gamela",
    "gaviao akratikateje": "akratikateje", "xukuru do ororuba": "xukuru", "laklano xokleng": "xokleng",
    "manaus": "manao",
    "kaiowa": "guarani kaiowa",   // decisão do usuário (12/11/2026): Kaiowá e Guarani-Kaiowá no mesmo grupo
    // EQUIVALENTES: autodenominação e nome dado de fora para o mesmo povo (a lista exibe os dois, autodenominação primeiro)
    "bororo": "boe", "karaja": "iny", "xerente": "akwe",
    "tenetehara": "guajajara", "kaxinawa": "huni kuin", "mebengokre": "kayapo",
  };
  const NOME_GRUPO = { "guarani kaiowa": "Guarani-Kaiowá", boe: "Boe / Bororo", iny: "Iny / Karajá", akwe: "Akwẽ / Xerente" };
  const chave = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’]/g, " ").replace(/\s+/g, " ").trim();
  const semComentario = (n) => n.replace(/\s*\((as fontes|não|chamados|designação)[^)]*\)/, "").replace(/\s*\([^)]*,[^)]*\)/, "");
  let grupos = new Map(), povoAtual = "";

  function montarPovos() {
    const brutos = new Map();
    for (const e of EVENTOS) for (const p of e.povos) brutos.set(p, (brutos.get(p) || 0) + 1);
    const raiz = (k) => k;
    const base = (nome) => { const k = chave(nome.replace(/\(.*?\)/g, "")); return APELIDOS_POVO[k] || k; };
    const partes = (p) => p.split(/\s+\/\s+/).map((x) => x.trim());
    const grupoDe = new Map();
    grupos = new Map();
    for (const [p, n] of brutos) {
      const c = chave(p);
      const ks = NAO_E_POVO.test(c) ? [] : VARIOS.test(c) ? ["__varios"] : SEM_ID.test(c) ? ["__semid"] : [...new Set(partes(p).map((x) => raiz(base(x))))];
      grupoDe.set(p, ks);
      for (const k of ks) {
        const g = grupos.get(k) || { variantes: new Map(), bases: new Map(), ids: new Set() };
        const rotulo = ks.length > 1 ? partes(p).find((x) => raiz(base(x)) === k) : p;
        g.variantes.set(rotulo, (g.variantes.get(rotulo) || 0) + n);
        const bonito = semComentario(rotulo).replace(/\s*\(.*?\)/, "");
        const b = base(rotulo);
        const reg = g.bases.get(b) || { n: 0, nome: bonito };
        reg.n += n; g.bases.set(b, reg);
        grupos.set(k, g);
      }
    }
    for (const e of EVENTOS) for (const p of e.povos) for (const k of grupoDe.get(p)) grupos.get(k).ids.add(e.id);
    for (const [k, g] of grupos) {
      if (k === "__varios") { g.nome = "Vários povos ou designação genérica"; continue; }
      if (k === "__semid") { g.nome = "Povo não identificado nas fontes"; continue; }
      const bases = [...g.bases.values()].sort((a, b) => b.n - a.n);
      if (NOME_GRUPO[k]) g.nome = NOME_GRUPO[k];
      else if (bases.length > 1) g.nome = bases.map((b) => b.nome).join(" / ");
      else g.nome = semComentario([...g.variantes].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]);
    }
    const sel = $("f-povo");
    const ordenados = [...grupos].filter(([k]) => !k.startsWith("__")).sort((a, b) => a[1].nome.localeCompare(b[1].nome, "pt-BR"));
    const especiais = ["__semid", "__varios"].filter((k) => grupos.has(k));
    sel.replaceChildren(el("option", { value: "" }, `Todos os povos (${ordenados.length})`),
      // sem contagem por povo no seletor: o número só aparece no perfil, com a nota de que é contagem de registros
      ...ordenados.map(([k, g]) => el("option", { value: k }, g.nome)),
      especiais.length ? el("optgroup", { label: "Sem povo nomeado" },
        ...especiais.map((k) => el("option", { value: k }, grupos.get(k).nome))) : null);
    sel.addEventListener("input", () => { povoAtual = sel.value; filtrar(); });
    const doLink = params.get("povo");
    if (doLink && grupos.has(doLink)) { sel.value = doLink; povoAtual = doLink; }
  }

  // ---------- perfil do povo (toda a base, independente do período enquadrado) ----------
  function perfil() {
    const alvo = $("perfil-povo");
    const g = povoAtual && grupos.get(povoAtual);
    if (!g) { alvo.hidden = true; return; }
    const evs = EVENTOS.filter((e) => g.ids.has(e.id));
    const ts = evs.map(anoCentral);
    const a0 = Math.floor(Math.min(...ts.map((t) => t.ini))), a1 = Math.ceil(Math.max(...ts.map((t) => t.fim ?? t.ini)));
    const conta = (f) => { const m = new Map(); for (const e of evs) for (const k of new Set(f(e))) if (k) m.set(k, (m.get(k) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
    const porTipo = conta(tiposDe);
    const porUF = conta((e) => [e.local.uf]);
    const porLugar = conta((e) => [e.local.terra_indigena ? e.local.terra_indigena.split(" — ")[0] : e.local.municipio ? `${e.local.municipio} (${e.local.uf})` : null]);
    const lider = evs.filter((e) => e.lideranca).length;
    const denuncia = evs.filter((e) => e.grau_confirmacao === "denuncia").length;
    const variantes = [...g.variantes.keys()];
    const lista = (pares, max) => pares.slice(0, max).map(([k, n]) => `${k} (${n})`).join(" · ") + (pares.length > max ? ` · e mais ${pares.length - max}` : "");
    const especial = povoAtual.startsWith("__");

    const verTudo = el("button", { type: "button", class: "btn-perfil" }, `Ver ${a0}–${a1} na linha do tempo`);
    verTudo.addEventListener("click", () => { const pad = Math.max(1, (a1 - a0) * 0.06); irPara(a0 - pad, a1 + pad); });
    const fechar = el("button", { type: "button", class: "btn-perfil sec" }, "Todos os povos");
    fechar.addEventListener("click", () => { povoAtual = ""; $("f-povo").value = ""; filtrar(); $("f-povo").focus(); });

    alvo.replaceChildren(...[
      el("h2", { class: "bloco-tit" }, especial ? "Registros sem povo nomeado" : "Perfil do povo"),
      el("p", { class: "perfil-nome" }, g.nome),
      !especial && variantes.length > 1 ? el("p", { class: "perfil-var" }, `Nas fontes: ${variantes.map(semComentario).join(", ")}`) : null,
      el("p", { class: "perfil-num" }, el("b", {}, String(evs.length)), ` ${evs.length === 1 ? "registro" : "registros"} na base, de ${a0} a ${a1}`),
      el("ul", { class: "perfil-tipos" }, ...porTipo.map(([t, n]) => el("li", { style: `--c: var(--${t})` },
        el("span", { class: "amostra", "aria-hidden": "true" }), `${TIPO_NOME[t]}: `, el("b", {}, String(n))))),
      lider ? el("p", { class: "perfil-linha" }, `◆ ${lider} ${lider === 1 ? "registro atinge" : "registros atingem"} lideranças`) : null,
      denuncia ? el("p", { class: "perfil-linha" }, `${denuncia} ${denuncia === 1 ? "é denúncia ainda não apurada" : "são denúncias ainda não apuradas"} oficialmente`) : null,
      porUF.length ? el("p", { class: "perfil-linha" }, el("span", { class: "rot" }, "Estados: "), lista(porUF, 8)) : null,
      porLugar.length ? el("p", { class: "perfil-linha" }, el("span", { class: "rot" }, "Terras e lugares: "), lista(porLugar, 5)) : null,
      el("p", { class: "perfil-nota" }, "Contagem de registros, não de vítimas (as vítimas estão no placar abaixo, para o período enquadrado). Ausência de registro não é ausência de violência."),
      el("div", { class: "perfil-acoes" }, verTudo, fechar),
    ].filter(Boolean));
    alvo.hidden = false;
  }

  // ---------- popover "Mais filtros" ----------
  function maisFiltros() {
    const b = $("mais-filtros"), pop = $("pop-filtros");
    const abrir = (sim) => {
      pop.hidden = !sim; b.setAttribute("aria-expanded", String(sim));
      if (!sim) return;
      // desktop: a caixa abre sob o botão; se passar da borda direita da tela, desliza para a esquerda
      pop.style.left = "";
      if (getComputedStyle(pop).position === "absolute") {
        const r = pop.getBoundingClientRect(), sobra = innerWidth - 12 - r.right;
        if (sobra < 0) pop.style.left = `${Math.max(sobra, 12 - r.left)}px`;
      }
      pop.querySelector("select")?.focus();
    };
    b.addEventListener("click", (e) => { e.stopPropagation(); abrir(pop.hidden); });
    pop.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => abrir(false));
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); abrir(false); b.focus(); } });
    // fecha quando o foco sai do popover (Tab para fora), não só com clique fora ou Esc
    b.parentElement.addEventListener("focusout", (e) => { if (!pop.hidden && !b.parentElement.contains(e.relatedTarget)) abrir(false); });
    // celular: povo e busca ficam recolhidos atrás de um botão, para a barra não cobrir o mapa
    const bc = $("filtros-cel");
    bc.addEventListener("click", () => {
      const sim = !document.body.classList.contains("filtros-abertos");
      document.body.classList.toggle("filtros-abertos", sim);
      bc.setAttribute("aria-expanded", String(sim));
      if (sim) $("f-povo").focus();
      reencaixar();
    });
    $("fechar-filtros").addEventListener("click", () => { abrir(false); b.focus(); });
    $("limpar-filtros").addEventListener("click", () => {
      ["f-busca", "f-grau", "f-escala", "f-uf", "f-lider", "f-interna", "f-povo"].forEach((id) => ($(id).value = ""));
      povoAtual = "";
      TIPOS.forEach(([t]) => tiposLigados.add(t));
      sincronizarChips();
      filtrar();
      anunciar("Filtros limpos");
    });
  }

  // ---------- modal "Como ler" ----------
  function modalLegenda() {
    const dlg = $("dlg-legenda");
    document.querySelectorAll("[data-abre-legenda]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      dlg.showModal();
      dlg.querySelector("h2").focus();
    }));
    $("fechar-legenda").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // clique no fundo fecha
  }

  // ---------- ocultar painel e linha do tempo ----------
  let painelVisivel, linhaVisivel;
  function alternadores() {
    const corpo = document.body;
    const bPainel = $("alternar-painel"), bLinha = $("alternar-linha");
    const aplicar = (classe, ligado, botao, rotulos, msg) => {
      corpo.classList.toggle(classe, !ligado);
      botao.setAttribute("aria-expanded", String(ligado));
      botao.querySelector(".rot").textContent = ligado ? rotulos[0] : rotulos[1];
      botao.title = ligado ? rotulos[2] : rotulos[3];
      anunciar(msg(ligado));
      reencaixar();
      atualizarURL();
    };
    painelVisivel = (lig) => {
      if (!lig && $("painel").contains(document.activeElement)) bPainel.focus();
      aplicar("sem-painel", lig, bPainel, ["Ocultar painel", "Painel", "Ocultar o painel (tecla [)", "Mostrar o painel (tecla [)"],
        (l) => (l ? "Painel visível" : "Painel oculto"));
    };
    linhaVisivel = (lig) => {
      if (!lig && $("tl-sec-corpo").contains(document.activeElement)) bLinha.focus();
      aplicar("sem-linha", lig, bLinha, ["Ocultar linha do tempo", "Mostrar linha do tempo", "Ocultar a linha do tempo (tecla T)", "Mostrar a linha do tempo (tecla T)"],
        (l) => (l ? "Linha do tempo visível" : `Linha do tempo oculta; período: ${$("janela-rot").textContent}`));
    };
    bPainel.addEventListener("click", () => painelVisivel(corpo.classList.contains("sem-painel")));
    bLinha.addEventListener("click", () => linhaVisivel(corpo.classList.contains("sem-linha")));
    $("so-mapa").addEventListener("click", () => {
      const ambos = !corpo.classList.contains("sem-painel") || !corpo.classList.contains("sem-linha");
      painelVisivel(!ambos); linhaVisivel(!ambos);
    });
    // o botão "Só mapa" fica marcado quando painel e linha do tempo estão ocultos
    new MutationObserver(() => $("so-mapa").setAttribute("aria-pressed", String(corpo.classList.contains("sem-painel") && corpo.classList.contains("sem-linha"))))
      .observe(corpo, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey || $("dlg-legenda").open || $("aviso").open) return;
      if (e.key === "[") { painelVisivel(corpo.classList.contains("sem-painel")); e.preventDefault(); }
      else if (e.key === "t" || e.key === "T") { linhaVisivel(corpo.classList.contains("sem-linha")); e.preventDefault(); }
    });
    const ocultos = (params.get("ocultar") || (params.get("modo") === "mapa" ? "painel,linha" : "")).split(",");
    if (ocultos.includes("painel")) painelVisivel(false);
    if (ocultos.includes("linha")) linhaVisivel(false);
  }

  // ---------- lista em texto dos registros (alternativa à linha do tempo) + CSV ----------
  let listaLigada = false;
  const naLista = () => EVENTOS.filter((e) => (!visiveis || visiveis.has(e.id)) && naJanelaAtual(e))
    .sort((a, b) => anoCentral(a).ini - anoCentral(b).ini);
  function lista() {
    const b = $("ver-lista");
    b.addEventListener("click", () => ligarLista(!listaLigada));
    $("baixar-csv").addEventListener("click", baixarCSV);
    if (params.get("lista") === "1") ligarLista(true);
  }
  function ligarLista(sim) {
    listaLigada = sim;
    document.body.classList.toggle("modo-lista", sim);
    $("ver-lista").setAttribute("aria-pressed", String(sim));
    $("ver-lista").querySelector(".rot").textContent = sim ? "Ver linha do tempo" : "Ver como lista";
    $("lista-corpo").hidden = !sim;
    if (sim) montarLista();
    anunciar(sim ? "Registros em lista" : "Linha do tempo");
    reencaixar();
    atualizarURL();
  }
  function montarLista() {
    if (!listaLigada) return;
    const evs = naLista();
    $("lista-resumo").textContent = `${evs.length} ${evs.length === 1 ? "registro" : "registros"} no período e nos filtros, em ordem de data`;
    const linhas = evs.map((ev) => {
      const ab = el("button", { type: "button", class: "lista-tit", style: `--c: var(--${ev.tipo})` }, ev.titulo);
      ab.addEventListener("click", (e) => { e.stopPropagation(); const r = ab.getBoundingClientRect(); fixar(ev.id, r.right, r.top + r.height / 2); });
      ab.addEventListener("pointerenter", () => { if (!fixado) marcarAtiva(ev.id); });
      ab.addEventListener("focus", () => { if (!fixado) marcarAtiva(ev.id); });
      // papéis ARIA explícitos: no celular as linhas viram grade (display: grid) e o Safari perde a semântica de tabela
      const td = (attrs, ...f) => el("td", { role: "cell", ...attrs }, ...f);
      return el("tr", { role: "row" },
        td({ class: "num" }, fmtPeriodo(ev)),
        el("th", { scope: "row", role: "rowheader" }, ab),
        td({}, tiposDe(ev).map((t) => TIPO_NOME[t]).join(" + ")),
        td({ class: "num" }, numeroDestaque(comUF(ev)).num),
        td({}, ev.povos.join(", ")),
        td({}, fmtLocal(ev.local)),
        td({}, GRAU_NOME[ev.grau_confirmacao] + (ev.natureza_contagem === "estimada" ? " · estimativa" : "")));
    });
    $("lista-tbody").replaceChildren(...linhas);
  }
  function baixarCSV() {
    const cab = ["id", "titulo", "data_inicio", "data_fim", "povos", "uf", "municipio", "terra_indigena", "regiao", "tipo", "outras_violencias",
      "vitimas_min", "vitimas_max", "unidade", "natureza_contagem", "grau_confirmacao", "escala", "lideranca", "violencia_interna", "situacao", "fontes"];
    const q = (v) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const linhas = naLista().map((e) => [e.id, e.titulo, e.data_inicio, e.data_fim, e.povos.join(" | "), e.local.uf, e.local.municipio,
      e.local.terra_indigena, e.local.regiao, e.tipo, (e.outras_violencias || []).map((o) => o.tipo).join(" | "),
      e.vitimas.min, e.vitimas.max, e.vitimas.unidade, e.natureza_contagem, e.grau_confirmacao, e.escala, e.lideranca, e.violencia_interna ? "sim" : "", e.situacao,
      e.fontes.map((f) => f.url).join(" | ")].map(q).join(","));
    const blob = new Blob(["﻿" + [cab.join(","), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `violencia-povos-indigenas_${Math.round(vista.a0)}-${Math.round(vista.a1)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    anunciar(`${linhas.length} registros baixados em CSV`);
  }

  // ---------- endereço com todos os filtros (compartilhável) ----------
  let timerURL = 0;
  function atualizarURL() {
    clearTimeout(timerURL);
    timerURL = setTimeout(() => {
      const u = new URL(location.href);
      const p = u.searchParams;
      const por = (k, v) => (v ? p.set(k, v) : p.delete(k));
      por("povo", povoAtual);
      por("tipos", tiposLigados.size === TIPOS.length ? "" : [...tiposLigados].join(","));
      por("grau", $("f-grau").value); por("escala", $("f-escala").value); por("lider", $("f-lider").value);
      por("uf", $("f-uf").value); por("interna", $("f-interna").value); por("q", $("f-busca").value.trim());
      por("vista", `${Math.round(vista.a0)}-${Math.round(vista.a1)}`);
      por("lista", listaLigada ? "1" : "");
      const oc = [document.body.classList.contains("sem-painel") && "painel", document.body.classList.contains("sem-linha") && "linha"].filter(Boolean).join(",");
      por("ocultar", oc); p.delete("modo");
      try { history.replaceState(null, "", u); } catch (_) {}
    }, 300);
  }
  function lerURL() {
    const tipos = params.get("tipos");
    if (tipos) {
      const ok = tipos.split(",").filter((t) => TIPO_NOME[t]);
      if (ok.length) { tiposLigados.clear(); ok.forEach((t) => tiposLigados.add(t)); }
    }
    for (const [k, id] of [["grau", "f-grau"], ["escala", "f-escala"], ["lider", "f-lider"], ["uf", "f-uf"], ["interna", "f-interna"], ["q", "f-busca"]]) {
      const v = params.get(k);
      if (v && (id === "f-busca" || [...$(id).options].some((o) => o.value === v))) $(id).value = v;
    }
  }
  function compartilhar() {
    const b = $("copiar-link");
    b.addEventListener("click", async () => {
      clearTimeout(timerURL);
      const rot = b.querySelector(".rot");
      try { await navigator.clipboard.writeText(location.href); rot.textContent = "Link copiado"; anunciar("Link deste recorte copiado"); }
      catch (_) { prompt("Copie o link deste recorte:", location.href); }
      setTimeout(() => (rot.textContent = "Copiar link"), 2500);
    });
  }

  // ---------- abas no celular (padrão ARIA tabs) ----------
  function abas() {
    const listaAbas = $("abas");
    const tabs = [...listaAbas.querySelectorAll('[role="tab"]')];
    const mq = matchMedia("(max-width: 760px), (max-height: 500px)");
    const selecionar = (tab, focar) => {
      tabs.forEach((t) => {
        const sel = t === tab;
        t.setAttribute("aria-selected", String(sel));
        t.tabIndex = sel ? 0 : -1;
      });
      document.body.dataset.aba = tab.dataset.aba;
      if (focar) tab.focus();
      reencaixar();
    };
    tabs.forEach((t) => t.addEventListener("click", () => selecionar(t)));
    listaAbas.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(document.activeElement);
      const prox = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (prox == null) return;
      e.preventDefault();
      selecionar(tabs[(prox + tabs.length) % tabs.length], true);
    });
    const papeis = () => {
      ["painel", "mapa", "tl-sec-corpo"].forEach((id, k) => {
        const p = $(id);
        if (mq.matches) { p.setAttribute("role", "tabpanel"); p.setAttribute("aria-labelledby", tabs[k].id); }
        else { p.removeAttribute("role"); p.removeAttribute("aria-labelledby"); }
      });
      reencaixar();
    };
    mq.addEventListener("change", papeis);
    papeis();
    selecionar(tabs[1]);
  }

  window.CONTROLES = {
    iniciar() {
      montarPovos(); lerURL(); chips(); sincronizarChips(); maisFiltros(); modalLegenda(); alternadores(); lista(); compartilhar(); abas();
    },
    povoOk: (e) => !povoAtual || !!grupos.get(povoAtual)?.ids.has(e.id),
    povoNome: () => (povoAtual ? grupos.get(povoAtual)?.nome : null),
    // chamado por nucleo.js depois de filtrar e de cada desenho da linha do tempo
    aoFiltrar() {
      perfil(); atualizarURL();
      const n = (povoAtual ? 1 : 0) + ($("f-busca").value.trim() ? 1 : 0);
      $("filtros-cel-n").textContent = n ? ` (${n})` : "";
    },
    aoRenderizar() { montarLista(); atualizarURL(); },
  };
})();
