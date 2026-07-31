options(shiny.maxRequestSize = 100 * 1024^2)

APP_DIR <- normalizePath(getOption("SWANr.app_dir", getwd()), winslash = "/", mustWork = TRUE)
LOCAL_LIBRARY <- file.path(APP_DIR, ".Rlib")
if (dir.exists(LOCAL_LIBRARY)) .libPaths(c(LOCAL_LIBRARY, .libPaths()))

suppressPackageStartupMessages({
  library(shiny)
  library(sf)
  library(httr)
  library(jsonlite)
  library(XML)
  library(terra)
})

source(file.path(APP_DIR, "R", "swot_functions.R"), local = TRUE)

layer_cache <- new.env(parent = emptyenv())
state_cache <- new.env(parent = emptyenv())
layer_search_catalog_cache <- NULL

ui <- htmlTemplate(
  file.path(APP_DIR, "www", "index.html"),
  file_input = fileInput(
    "userShapeInput",
    label = NULL,
    accept = c(".zip", ".gpkg", ".kml", ".kmz", ".json", ".geojson"),
    buttonLabel = "Selecionar arquivo",
    placeholder = "Nenhum arquivo"
  ),
  download_link = downloadLink(
    "download_bundle",
    label = "download",
    class = "shiny-download-link"
  )
)

server <- function(input, output, session) {
  uploaded_shape <- reactiveVal(NULL)
  uploaded_name <- reactiveVal("")
  selected_state <- reactiveVal(NULL)
  selected_state_uf <- reactiveVal("")
  ana_results_cache <- reactiveVal(NULL)
  opera_results_cache <- reactiveVal(NULL)

  session$onSessionEnded(function() {
    ana_cache <- isolate(ana_results_cache())
    if (!is.null(ana_cache$workspace)) {
      unlink(ana_cache$workspace, recursive = TRUE, force = TRUE)
    }

    opera_cache <- isolate(opera_results_cache())
    if (!is.null(opera_cache$workspace)) {
      unlink(opera_cache$workspace, recursive = TRUE, force = TRUE)
    }
  })

  send_toast <- function(message, type = "info", duration = 5000) {
    session$sendCustomMessage("swotr-toast", list(
      message = message,
      type = type,
      duration = duration
    ))
  }

  send_query_progress <- function(source, percent, message = NULL, detail = NULL) {
    percent <- suppressWarnings(as.numeric(percent))
    if (is.na(percent)) percent <- 0
    percent <- max(0, min(100, percent))
    session$sendCustomMessage("query-progress", list(
      source = source,
      percent = round(percent),
      message = message %||% "",
      detail = detail %||% ""
    ))
    try(session$flushReact(), silent = TRUE)
  }

  observeEvent(input$userShapeInput, {
    info <- input$userShapeInput
    req(info$datapath, info$name)

    if (tolower(tools::file_ext(info$name)) == "shp") {
      send_toast(
        "Um .shp não funciona sozinho. Envie um ZIP com todos os componentes do shapefile.",
        "error",
        7000
      )
      session$sendCustomMessage("shape-error", list(message = "Formato incompleto"))
      return()
    }

    tryCatch({
      shape <- read_spatial_file(info$datapath, info$name)
      uploaded_shape(shape)
      uploaded_name(safe_filename(info$name))
      selected_state(NULL)
      selected_state_uf("")
      bounds <- as.numeric(st_bbox(shape))
      session$sendCustomMessage("shape-loaded", list(
        filename = safe_filename(info$name),
        bbox = unname(bounds),
        geojson = sf_to_geojson(shape)
      ))
    }, error = function(error) {
      uploaded_shape(NULL)
      uploaded_name("")
      session$sendCustomMessage("shape-error", list(message = conditionMessage(error)))
      send_toast(paste("Erro ao ler o arquivo:", conditionMessage(error)), "error", 7000)
    })
  }, ignoreInit = TRUE)

  observeEvent(input$state_request, {
    uf <- toupper(as.character(input$state_request %||% ""))
    uploaded_shape(NULL)
    uploaded_name("")
    selected_state(NULL)
    selected_state_uf(uf)

    if (!nzchar(uf)) {
      session$sendCustomMessage("state-loaded", list(uf = "", bbox = NULL, geojson = NULL))
      return()
    }

    tryCatch({
      if (uf == "BR") {
        session$sendCustomMessage("state-loaded", list(
          uf = "BR",
          bbox = c(-73.99, -33.75, -28.84, 5.27),
          geojson = NULL
        ))
        return()
      }

      if (exists(uf, envir = state_cache, inherits = FALSE)) {
        state <- get(uf, envir = state_cache, inherits = FALSE)
      } else {
        state <- load_brazil_state(APP_DIR, uf)
        assign(uf, state, envir = state_cache)
      }
      selected_state(state)
      bounds <- as.numeric(st_bbox(state))
      session$sendCustomMessage("state-loaded", list(
        uf = uf,
        bbox = unname(bounds),
        geojson = sf_to_geojson(state, simplify = 0.005)
      ))
    }, error = function(error) {
      selected_state(NULL)
      selected_state_uf("")
      session$sendCustomMessage("state-error", list(message = conditionMessage(error)))
      send_toast(paste("Erro ao carregar estado:", conditionMessage(error)), "error", 7000)
    })
  }, ignoreInit = TRUE)

  observeEvent(input$layer_request, {
    request <- input$layer_request
    layer_name <- as.character(request$name %||% "")
    enabled <- isTRUE(request$enabled)
    if (!enabled || !nzchar(layer_name)) return()

    tryCatch({
      if (exists(layer_name, envir = layer_cache, inherits = FALSE)) {
        cached <- get(layer_name, envir = layer_cache, inherits = FALSE)
      } else {
        object <- load_reference_layer(APP_DIR, layer_name)
        cached <- list(
          geojson = sf_to_geojson(object),
          sampled = isTRUE(attr(object, "swotr_sampled"))
        )
        assign(layer_name, cached, envir = layer_cache)
      }
      if (!is.list(cached)) {
        cached <- list(geojson = cached, sampled = FALSE)
      }
      session$sendCustomMessage("layer-loaded", list(
        name = layer_name,
        geojson = cached$geojson,
        sampled = isTRUE(cached$sampled)
      ))
    }, error = function(error) {
      session$sendCustomMessage("layer-error", list(
        name = layer_name,
        message = conditionMessage(error)
      ))
    })
  }, ignoreInit = TRUE)

  observeEvent(input$layer_search_request, {
    request <- input$layer_search_request
    query <- trimws(as.character(request$query %||% ""))
    if (!nzchar(query)) {
      session$sendCustomMessage("layer-search-results", list(
        status = "success",
        query = query,
        results = list()
      ))
      return()
    }

    tryCatch({
      if (is.null(layer_search_catalog_cache)) {
        layer_search_catalog_cache <<- build_layer_search_catalog(APP_DIR)
      }
      matches <- search_layer_catalog(layer_search_catalog_cache, query, limit = 20L)
      results <- if (nrow(matches)) {
        lapply(seq_len(nrow(matches)), function(index) {
          list(
            layer_name = matches$layer_name[index],
            title = matches$title[index],
            subtitle = matches$subtitle[index],
            match_field = matches$match_field[index],
            match_value = matches$match_value[index],
            bbox = unname(as.numeric(matches[index, c("xmin", "ymin", "xmax", "ymax")]))
          )
        })
      } else {
        list()
      }
      session$sendCustomMessage("layer-search-results", list(
        status = "success",
        query = query,
        results = results
      ))
    }, error = function(error) {
      session$sendCustomMessage("layer-search-results", list(
        status = "error",
        query = query,
        message = conditionMessage(error),
        results = list()
      ))
    })
  }, ignoreInit = TRUE)

  mask_from_request <- function(request) {
    shape_name <- as.character(request$shape_filename %||% "")
    state_uf <- toupper(as.character(request$state_uf %||% ""))
    if (nzchar(shape_name) && !is.null(uploaded_shape())) return(uploaded_shape())
    if (nzchar(state_uf) && state_uf != "BR") {
      if (!is.null(selected_state()) && identical(selected_state_uf(), state_uf)) {
        return(selected_state())
      }
      return(load_brazil_state(APP_DIR, state_uf))
    }
    make_bbox_sf(
      request$lon_min %||% NA,
      request$lat_min %||% NA,
      request$lon_max %||% NA,
      request$lat_max %||% NA
    )
  }

  observeEvent(input$search_request, {
    request <- input$search_request
    data_source <- toupper(as.character(request$data_source %||% "SWOT"))

    tryCatch({
      if (identical(data_source, "ANA")) {
        send_query_progress("ANA", 5, "Buscando na ANA", "Selecionando estações na área de interesse")
        old_cache <- ana_results_cache()
        if (!is.null(old_cache$workspace)) {
          unlink(old_cache$workspace, recursive = TRUE, force = TRUE)
        }

        mask <- mask_from_request(request)
        cache <- withProgress(message = "Buscando na ANA", value = 0, {
          prepare_ana_results(
            base_dir = APP_DIR,
            request = request,
            mask = mask,
            progress = function(index, total, codigo, detail = NULL) {
              percent <- if (total > 0) 8 + (86 * max(index, 0) / total) else 8
              detail <- detail %||% sprintf("Estação %s (%d/%d)", codigo, index, total)
              send_query_progress("ANA", percent, "Consultando ANA", detail)
              if (index > 0 && total > 0) {
                incProgress(
                  1 / total,
                  detail = detail
                )
              }
            }
          )
        })
        send_query_progress("ANA", 96, "Organizando resultados ANA", "Preparando lista para download")
        ana_results_cache(cache)

        result_list <- lapply(seq_len(nrow(cache$files)), function(index) {
          list(
            filename = cache$files$station_code[index],
            size = cache$files$size[index],
            download_link = cache$files$token[index]
          )
        })

        session$sendCustomMessage("search-results", list(
          status = "success",
          source = "ANA",
          results = result_list,
          smart_filter = FALSE
        ))
        return()
      }

      if (identical(data_source, "OPERA")) {
        send_query_progress("OPERA", 5, "Preparando OPERA", "Validando área e período")
        mask <- mask_from_request(request)
        cache <- withProgress(message = "Preparando dados OPERA", value = 0, {
          prepare_opera_results(
            base_dir = APP_DIR,
            request = request,
            mask = mask,
            progress = function(index, total, detail) {
              send_query_progress(
                "OPERA",
                8 + (86 * index / total),
                "Preparando OPERA",
                sprintf("%s (%d/%d)", detail, index, total)
              )
              incProgress(
                1 / total,
                detail = sprintf("%s (%d/%d)", detail, index, total)
              )
            }
          )
        })
        opera_results_cache(cache)

        result_list <- lapply(seq_len(nrow(cache$files)), function(index) {
          list(
            filename = cache$files$filename[index],
            size = cache$files$size[index],
            download_link = cache$files$token[index]
          )
        })

        session$sendCustomMessage("search-results", list(
          status = "success",
          source = "OPERA",
          results = result_list,
          smart_filter = FALSE
        ))
        return()
      }

      if (!identical(data_source, "SWOT")) {
        stop("Fonte de dados inválida.")
      }

      send_query_progress("SWOT", 5, "Consultando SWOT", "Validando produto, período e área")
      product <- as.character(request$produto %||% "")
      start_date <- as.Date(request$start_date %||% NA)
      end_date <- as.Date(request$end_date %||% NA)
      if (!nzchar(product)) stop("Selecione um produto.")
      if (is.na(start_date) || is.na(end_date)) stop("Selecione o período.")
      if (start_date > end_date) stop("A data inicial deve ser anterior à data final.")
      if (start_date < as.Date("2022-02-15")) {
        stop("O satélite não estava disponível antes de 15/02/2022.")
      }

      configuration <- product_configuration(
        product,
        subproduct = as.character(request$subproduto %||% ""),
        resolution = as.character(request$resolucao %||% "")
      )
      send_query_progress("SWOT", 18, "Consultando SWOT", "Preparando filtro espacial")
      mask <- mask_from_request(request)

      explicit_pass <- nzchar(trimws(as.character(request$pass %||% "")))
      explicit_tile <- nzchar(trimws(as.character(request$tile %||% "")))
      smart <- NULL
      if (!is.null(mask) && !explicit_pass && !explicit_tile) {
        send_query_progress("SWOT", 30, "Consultando SWOT", "Filtrando passes/tiles pela área de interesse")
        smart <- smart_filter_tiles(APP_DIR, mask, product)
      }

      send_query_progress("SWOT", 45, "Consultando SWOT", "Montando padrões de grânulos")
      patterns <- build_granule_patterns(
        product = product,
        sub = configuration$sub,
        cycle = as.character(request$cycle %||% ""),
        pass = as.character(request$pass %||% ""),
        tile = as.character(request$tile %||% ""),
        continent = as.character(request$continente %||% "SA"),
        smart = smart
      )

      if (length(patterns) > 20L) {
        patterns <- if (nzchar(configuration$sub)) {
          paste0("*_", configuration$sub, "_*")
        } else {
          character()
        }
      }

      bbox <- if (is.null(mask)) NULL else as.numeric(st_bbox(st_transform(mask, 4326)))
      send_query_progress("SWOT", 62, "Consultando Earthdata", "Enviando consulta ao catálogo NASA")
      entries <- search_swot_data(
        collection_name = configuration$short_name,
        granule_names = patterns,
        date_i = start_date,
        date_f = end_date,
        bounding_box = bbox
      )
      send_query_progress("SWOT", 88, "Processando resultados", "Organizando arquivos encontrados")
      results <- entries_to_results(entries, configuration$datatype)
      result_list <- if (nrow(results)) {
        lapply(seq_len(nrow(results)), function(index) {
          list(
            filename = results$filename[index],
            size = round(results$size[index], 2),
            download_link = results$download_link[index]
          )
        })
      } else {
        list()
      }

      session$sendCustomMessage("search-results", list(
        status = "success",
        source = "SWOT",
        results = result_list,
        smart_filter = !is.null(smart)
      ))
    }, error = function(error) {
      send_query_progress(data_source, 100, "Erro na consulta", conditionMessage(error))
      session$sendCustomMessage("search-results", list(
        status = "error",
        source = data_source,
        message = conditionMessage(error),
        results = list()
      ))
    })
  }, ignoreInit = TRUE)

  observeEvent(input$clear_server_area, {
    uploaded_shape(NULL)
    uploaded_name("")
    selected_state(NULL)
    selected_state_uf("")
  }, ignoreInit = TRUE)

  observeEvent(input$download_request, {
    request <- input$download_request
    urls <- unlist(request$urls %||% character(), use.names = FALSE)
    data_source <- toupper(as.character(request$data_source %||% "SWOT"))

    if (!length(urls)) {
      send_toast("Selecione pelo menos um arquivo para baixar.", "warning", 5000)
      return()
    }
    if (identical(data_source, "ANA")) {
      cache <- ana_results_cache()
      if (is.null(cache) || is.null(cache$files) || !nrow(cache$files)) {
        send_toast("Rode a consulta ANA novamente antes de baixar.", "error", 7000)
        return()
      }
      available <- as.character(cache$files$token)
      if (!all(as.character(urls) %in% available)) {
        send_toast("Alguma estação selecionada não pertence mais à consulta atual.", "error", 7000)
        return()
      }
      session$sendCustomMessage("trigger-download", list(id = "download_bundle"))
      return()
    }
    if (identical(data_source, "OPERA")) {
      cache <- opera_results_cache()
      if (is.null(cache) || is.null(cache$files) || !nrow(cache$files)) {
        send_toast("Rode a consulta OPERA novamente antes de baixar.", "error", 7000)
        return()
      }
      available <- as.character(cache$files$token)
      if (!all(as.character(urls) %in% available)) {
        send_toast("Algum arquivo OPERA selecionado não pertence mais à consulta atual.", "error", 7000)
        return()
      }
      session$sendCustomMessage("trigger-download", list(id = "download_bundle"))
      return()
    }

    if (!swotr_has_credentials()) {
      send_toast(
        "Configure NASA_EARTHDATA_TOKEN ou EARTHDATA_USERNAME/EARTHDATA_PASSWORD antes de baixar.",
        "error",
        8000
      )
      return()
    }
    if (isTRUE(request$crop) && is.null(mask_from_request(request))) {
      send_toast("A área de recorte não está mais disponível. Selecione ou desenhe a área novamente.", "error", 7000)
      return()
    }

    session$sendCustomMessage("trigger-download", list(id = "download_bundle"))
  }, ignoreInit = TRUE)

  output$download_bundle <- downloadHandler(
    filename = function() {
      request <- input$download_request
      if (is.null(request)) return("SWOT_download.zip")
      data_source <- toupper(as.character(request$data_source %||% "SWOT"))
      if (identical(data_source, "ANA")) {
        subproduct <- safe_filename(request$subproduct %||% "RHN")
        area <- safe_filename(request$area_name %||% "Area")
        return(paste0("ANA_RHN_", subproduct, "_", area, "_", Sys.Date(), ".zip"))
      }
      if (identical(data_source, "OPERA")) {
        product <- safe_filename(request$product %||% "OPERA")
        subproduct <- safe_filename(request$subproduct %||% "DSWx")
        area <- safe_filename(request$area_name %||% "Area")
        return(paste0("OPERA_", product, "_", subproduct, "_", area, "_", Sys.Date(), ".zip"))
      }
      product <- safe_filename(request$product %||% "SWOT")
      subproduct <- safe_filename(request$subproduct %||% "Dados")
      area <- safe_filename(request$area_name %||% "Area")
      paste0("SWOT_", product, "_", subproduct, "_", area, "_", Sys.Date(), ".zip")
    },
    contentType = "application/zip",
    content = function(file) {
      request <- input$download_request
      req(request, request$urls)
      urls <- unlist(request$urls, use.names = FALSE)
      data_source <- toupper(as.character(request$data_source %||% "SWOT"))

      if (identical(data_source, "ANA")) {
        withProgress(message = "Preparando dados ANA", value = 0, {
          incProgress(0.2, detail = "Montando arquivos TXT")
          create_ana_download_bundle(
            cache = ana_results_cache(),
            selected_tokens = urls,
            destination = file
          )
          incProgress(0.8, detail = "ZIP finalizado")
        })
        return()
      }
      if (identical(data_source, "OPERA")) {
        withProgress(message = "Preparando dados OPERA", value = 0, {
          incProgress(0.2, detail = "Montando arquivos")
          create_opera_download_bundle(
            cache = opera_results_cache(),
            selected_tokens = urls,
            destination = file
          )
          incProgress(0.8, detail = "ZIP finalizado")
        })
        return()
      }

      crop <- isTRUE(request$crop)
      mask <- if (crop) mask_from_request(request) else NULL
      if (crop && is.null(mask)) stop("A área de recorte não está mais disponível.")

      withProgress(message = "Preparando dados SWOT", value = 0, {
        create_download_bundle(
          urls = urls,
          destination = file,
          mask = mask,
          progress = function(index, total, filename) {
            incProgress(
              1 / total,
              detail = sprintf("%s (%d/%d)", filename, index, total)
            )
          }
        )
      })
    }
  )

  observe({
    session$sendCustomMessage("credentials-status", list(
      configured = swotr_has_credentials()
    ))
  })
}

shinyApp(ui, server)
