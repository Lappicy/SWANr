# SWANr Shiny app

Esta pasta contém o dashboard Shiny instalado junto com o pacote `SWANr`,
com consulta a SWOT, interface OPERA em finalização e acesso a séries/
hidroinventário ANA/RHN via HidroWeb.

Ao instalar o pacote pelo GitHub, abra o app com:

```r
SWANr::SWANr_app()
```

As camadas em `camadas/` são versões adequadas para distribuição via GitHub.
Os arquivos brutos completos de SWORD e OPERA ultrapassam o limite de tamanho
do GitHub e foram substituídos por versões otimizadas para visualização no mapa.
