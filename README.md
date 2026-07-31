# SWANr

Dashboard Shiny para consulta, visualização e download de dados SWOT
(Coleção D), preparação inicial para produtos OPERA (DSWx) e acesso a dados
hidrológicos da ANA/RHN via HidroWeb.

## Instalação pelo GitHub

```r
install.packages("remotes")
remotes::install_github("Lappicy/SWANr")
```

## Abrir o dashboard

```r
library(SWANr)
SWANr::run_app()
```

Também é possível escolher porta e navegador:

```r
SWANr::run_app(host = "127.0.0.1", port = 8123, launch.browser = TRUE)
```

## Credenciais NASA Earthdata

Para baixar dados NASA/SWOT, configure um token ou usuário/senha do Earthdata
antes de abrir o app:

```r
Sys.setenv(NASA_EARTHDATA_TOKEN = "SEU_TOKEN_AQUI")
SWANr::run_app()
```

Ou via arquivo `.Renviron`:

```r
NASA_EARTHDATA_TOKEN=SEU_TOKEN_AQUI
```

Nunca salve tokens reais no GitHub.

As consultas ANA/RHN usam o serviço HidroWeb e não exigem credenciais
Earthdata.

## Camadas incluídas

O pacote inclui camadas de referência e cobertura usadas pelo dashboard:

- limites administrativos do Brasil;
- estações fluviométricas ANA;
- ottobacias ANA nível 1;
- órbitas e grades SWOT;
- grade OPERA otimizada para América do Sul;
- SWORD Reaches e Nodes em versão otimizada para visualização web.

Observação: os arquivos brutos completos de SWORD e OPERA são muito grandes
para GitHub. Por isso, esta versão do pacote inclui camadas otimizadas, com os
mesmos nomes esperados pelo dashboard, para manter o app instalável via
`remotes::install_github()`.

## Função principal

- `run_app()` / `run_swanr()`: inicia o dashboard Shiny.

## Desenvolvimento

Estrutura principal:

```text
R/                  funções exportadas do pacote
inst/app/           dashboard Shiny
inst/app/R/         funções internas usadas pelo app
inst/app/www/       HTML, CSS, JavaScript e imagens
inst/app/camadas/   camadas espaciais usadas no mapa
```
