# Violência contra povos indígenas no Brasil

Linha do tempo e mapa da violência contra povos indígenas no Brasil, de 1500 até hoje. Cada ponto é um caso ou um total registrado, com a fonte citada no próprio registro.

**Site:** https://vctrmchd.github.io/violencia-contra-indigenas/

> Os registros trazem nomes de pessoas mortas, como publicados nas fontes, exceto de povos que evitam nomear seus mortos, como os Yanomami.

## Sobre os dados

- A ausência de registros não significa ausência de violência: a subnotificação é estrutural.
- Denúncias são apresentadas como denúncias, sempre com fonte.
- No mapa, o local é aproximado: centro da terra indígena, do município ou do estado (bases do IBGE); regiões históricas são manchas desenhadas a partir do local citado em cada registro.

## O que há neste repositório

Este repositório guarda só o site publicado. Ele é gerado a partir de uma base curada mantida à parte, e cada publicação substitui todo o conteúdo daqui; por isso, correções devem ser pedidas por *issue*, não por *pull request*.

| Arquivo | Conteúdo |
|---|---|
| `index.html`, `*.css`, `*.js` | interface (HTML, CSS e JavaScript puros, sem build nem dependências) |
| `events.json` | os registros, com fontes |
| `dados/geo.js` | localização dos registros no mapa e camadas de fundo |

Para abrir localmente: `python -m http.server 8000` nesta pasta e acesse http://localhost:8000.

## Licença

- **Código** (`*.html`, `*.css`, `*.js`): MIT — ver [`LICENSE`](LICENSE).
- **Registros e textos do projeto** (`events.json` e os textos da interface): CC BY 4.0 — ver [`LICENSE-dados.md`](LICENSE-dados.md). Ao reutilizar, cite este projeto e as fontes originais de cada registro.
- **Bases de terceiros em `dados/geo.js`** (contornos e centros do IBGE, terras indígenas do IBGE e da FUNAI, mancha da ocupação colonial redesenhada a partir dos mapas do Atlas FGV/CPDOC): seguem os termos das fontes originais.
