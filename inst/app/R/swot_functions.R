`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0L) return(y)
  first <- x[[1]]
  if (length(first) == 1L && is.atomic(first)) {
    if (is.na(first)) return(y)
    if (is.character(first) && !nzchar(first)) return(y)
  }
  x
}

swanr_cache_env <- new.env(parent = emptyenv())
swanr_cache_env$reference_layers <- new.env(parent = emptyenv())
swanr_cache_env$ana_series <- new.env(parent = emptyenv())
swanr_cache_env$swot_search <- new.env(parent = emptyenv())
swanr_cache_env$sword_columns <- new.env(parent = emptyenv())
swanr_cache_env$sword_source <- new.env(parent = emptyenv())

swanr_cache_space <- function(name) {
  if (!exists(name, envir = swanr_cache_env, inherits = FALSE)) {
    assign(name, new.env(parent = emptyenv()), envir = swanr_cache_env)
  }
  get(name, envir = swanr_cache_env, inherits = FALSE)
}

swanr_cache_has <- function(space, key) {
  exists(key, envir = swanr_cache_space(space), inherits = FALSE)
}

swanr_cache_get <- function(space, key) {
  get(key, envir = swanr_cache_space(space), inherits = FALSE)
}

swanr_cache_set <- function(space, key, value) {
  assign(key, value, envir = swanr_cache_space(space))
  invisible(value)
}

swanr_hash_text <- function(...) {
  values <- unlist(list(...), recursive = TRUE, use.names = FALSE)
  values <- as.character(values)
  values[is.na(values)] <- "<NA>"
  tmp <- tempfile("swanr_hash_")
  on.exit(unlink(tmp, force = TRUE), add = TRUE)
  writeLines(values, tmp, useBytes = TRUE)
  unname(tools::md5sum(tmp))
}

swotr_auth_token <- function() {
  Sys.getenv("NASA_EARTHDATA_TOKEN", unset = Sys.getenv("EARTHDATA_TOKEN", unset = ""))
}

swotr_authenticate <- function(request) {
  token <- swotr_auth_token()
  username <- Sys.getenv("EARTHDATA_USERNAME", unset = "")
  password <- Sys.getenv("EARTHDATA_PASSWORD", unset = "")

  if (nzchar(token)) {
    return(httr::add_headers(Authorization = paste("Bearer", token)))
  }
  if (nzchar(username) && nzchar(password)) {
    return(httr::authenticate(username, password))
  }
  NULL
}

swotr_has_credentials <- function() {
  nzchar(swotr_auth_token()) ||
    (nzchar(Sys.getenv("EARTHDATA_USERNAME", unset = "")) &&
       nzchar(Sys.getenv("EARTHDATA_PASSWORD", unset = "")))
}

safe_filename <- function(x) {
  x <- basename(as.character(x %||% "arquivo"))
  x <- gsub("[^A-Za-z0-9._-]+", "_", x)
  x[is.na(x) | !nzchar(x)] <- "arquivo"
  x
}

safe_unzip <- function(zip_path, exdir) {
  listing <- utils::unzip(zip_path, list = TRUE)$Name
  bad <- grepl("(^/|^[A-Za-z]:|(^|[\\\\/])\\.\\.([\\\\/]|$))", listing)
  if (any(bad)) stop("O arquivo ZIP contém caminhos inseguros.")
  dir.create(exdir, recursive = TRUE, showWarnings = FALSE)
  utils::unzip(zip_path, exdir = exdir)
  invisible(exdir)
}

read_spatial_file <- function(path, original_name = basename(path)) {
  extension <- tolower(tools::file_ext(original_name))
  cleanup_dir <- NULL
  spatial_path <- path

  if (extension %in% c("zip", "kmz")) {
    cleanup_dir <- tempfile("swotr_extract_")
    safe_unzip(path, cleanup_dir)
    candidates <- list.files(
      cleanup_dir,
      pattern = "\\.(shp|kml|gpkg|geojson|json)$",
      recursive = TRUE,
      full.names = TRUE,
      ignore.case = TRUE
    )
    if (!length(candidates)) {
      unlink(cleanup_dir, recursive = TRUE, force = TRUE)
      stop("Nenhum arquivo espacial compatível foi encontrado.")
    }
    order_ext <- match(
      tolower(tools::file_ext(candidates)),
      c("shp", "gpkg", "geojson", "json", "kml")
    )
    spatial_path <- candidates[order(order_ext, na.last = TRUE)][1]
  }

  on.exit({
    if (!is.null(cleanup_dir)) unlink(cleanup_dir, recursive = TRUE, force = TRUE)
  }, add = TRUE)

  object <- suppressWarnings(sf::st_read(spatial_path, quiet = TRUE))
  if (!nrow(object)) stop("O arquivo espacial está vazio.")
  if (is.na(sf::st_crs(object))) {
    sf::st_crs(object) <- 4326
  } else {
    object <- sf::st_transform(object, 4326)
  }
  object <- sf::st_zm(object, drop = TRUE, what = "ZM")
  object <- suppressWarnings(sf::st_make_valid(object))
  object
}

sf_to_geojson <- function(object, simplify = NULL) {
  if (!is.null(simplify) && is.finite(simplify) && simplify > 0) {
    object <- suppressWarnings(sf::st_simplify(object, dTolerance = simplify))
  }
  for (column in setdiff(names(object), attr(object, "sf_column"))) {
    if (inherits(object[[column]], c("POSIXct", "POSIXlt", "Date"))) {
      object[[column]] <- as.character(object[[column]])
    }
  }
  destination <- tempfile(fileext = ".geojson")
  on.exit(unlink(destination, force = TRUE), add = TRUE)
  suppressWarnings(sf::st_write(object, destination, driver = "GeoJSON", quiet = TRUE))
  paste(readLines(destination, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
}

repair_layer_text <- function(x) {
  if (!is.character(x)) return(x)
  x <- enc2utf8(x)
  replacements <- c(
    "Limites das Unidades da Federa��o" = "Limites das Unidades da Federação"
  )
  for (source in names(replacements)) {
    x <- gsub(source, replacements[[source]], x, fixed = TRUE)
  }
  x
}

clean_layer_attributes <- function(object) {
  geometry_column <- attr(object, "sf_column")
  for (column in setdiff(names(object), geometry_column)) {
    if (is.character(object[[column]])) {
      object[[column]] <- repair_layer_text(object[[column]])
    }
  }
  object
}

find_state_column <- function(object) {
  candidates <- c("SIGLA_UF", "SIGLA", "UF", "CD_UF", "ABBREV_STATE", "sigla_uf", "uf")
  candidates[candidates %in% names(object)][1] %||% ""
}

load_brazil_state <- function(base_dir, uf) {
  uf <- toupper(uf)
  if (identical(uf, "BR")) return(NULL)

  candidates <- file.path(
    base_dir,
    "camadas",
    c("BR_UF_2024.shp", "BR_Estados.gpkg", "BR_Estados.geojson", "BR_Estados.shp")
  )
  source_path <- candidates[file.exists(candidates)][1]
  if (is.na(source_path)) stop("Arquivo de estados não encontrado.")

  states <- suppressWarnings(sf::st_read(source_path, quiet = TRUE))
  column <- find_state_column(states)
  if (!nzchar(column)) stop("Coluna de UF não encontrada no arquivo de estados.")
  selected <- states[toupper(trimws(as.character(states[[column]]))) == uf, , drop = FALSE]
  if (!nrow(selected)) stop(sprintf("Estado %s não encontrado.", uf))
  if (is.na(sf::st_crs(selected))) sf::st_crs(selected) <- 4326
  clean_layer_attributes(sf::st_transform(selected, 4326))
}

south_america_bbox <- function() {
  sf::st_as_sfc(sf::st_bbox(
    c(xmin = -90, ymin = -60, xmax = -30, ymax = 20),
    crs = sf::st_crs(4326)
  ))
}

reference_layer_specs <- function() {
  list(
    limites_BR = list(file = "limites_BR.gpkg", simplify = 0.005),
    Estacoes_hidrometeorologicas_ANA = list(file = "Estacoes_hidrometeorologicas_ANA.gpkg"),
    SNIRH_OttobaciaNv1 = list(file = "SNIRH_OttobaciaNv1.gpkg", simplify = 0.01),
    SWOT_orbits_BR = list(file = "SWOT_orbits_BR.gpkg", simplify = 0.002),
    SWOT_tiles_BR = list(file = "SWOT_tiles_BR.gpkg", simplify = 0.002),
    OPERA_tiles = list(
      file = "OPERA_tile_boundaries_polygons.gpkg",
      layer = "Opera tile boundaries - polygons",
      wkt_filter = sf::st_as_text(south_america_bbox()),
      simplify = 0.006
    ),
    SWORD_reaches_v17b = list(
      file = "sa_sword_reaches_v17b.gpkg",
      layer = "reaches",
      query = "SELECT reach_id, river_name, swot_orbit, type, geom FROM reaches",
      simplify = 0.003
    ),
    SWORD_nodes_v17b = list(
      file = "sa_sword_nodes_v17b.gpkg",
      layer = "nodes",
      query = paste(
        "SELECT node_id, reach_id, river_name, x, y, geom",
        "FROM nodes"
      ),
      sampled = TRUE
    )
  )
}

load_reference_layer <- function(base_dir, layer_name) {
  specs <- reference_layer_specs()
  if (!layer_name %in% names(specs)) stop("Camada inválida.")
  spec <- specs[[layer_name]]
  path <- file.path(base_dir, "camadas", spec$file)
  if (!file.exists(path)) stop("Camada não encontrada.")
  read_args <- list(dsn = path, quiet = TRUE)
  if (!is.null(spec$query)) {
    read_args$query <- spec$query
  } else if (!is.null(spec$layer)) {
    read_args$layer <- spec$layer
  }
  if (!is.null(spec$wkt_filter)) read_args$wkt_filter <- spec$wkt_filter

  file_info <- file.info(path)
  cache_key <- swanr_hash_text(
    "reference-layer",
    normalizePath(path, winslash = "/", mustWork = TRUE),
    file_info$size,
    file_info$mtime,
    layer_name,
    spec$query %||% "",
    spec$layer %||% "",
    spec$wkt_filter %||% ""
  )
  if (swanr_cache_has("reference_layers", cache_key)) {
    return(swanr_cache_get("reference_layers", cache_key))
  }

  object <- suppressWarnings(do.call(sf::st_read, read_args))
  object_crs <- sf::st_crs(object)
  if (is.na(object_crs) ||
      (is.na(object_crs$epsg) && grepl("undefined", object_crs$input %||% "", ignore.case = TRUE))) {
    suppressWarnings(sf::st_crs(object) <- 4326)
  }
  object <- suppressWarnings(sf::st_zm(object, drop = TRUE, what = "ZM"))
  object <- clean_layer_attributes(sf::st_transform(object, 4326))
  geometry_types <- as.character(sf::st_geometry_type(object, by_geometry = TRUE))
  is_point_layer <- all(geometry_types %in% c("POINT", "MULTIPOINT"))
  simplify_tolerance <- spec$simplify %||% if (nrow(object) > 3000L) 0.01 else NULL
  if (!is.null(simplify_tolerance) && !is_point_layer) {
    old_s2 <- sf::sf_use_s2()
    suppressMessages(sf::sf_use_s2(FALSE))
    on.exit(suppressMessages(sf::sf_use_s2(old_s2)), add = TRUE)
    object <- suppressWarnings(sf::st_make_valid(object))
    object <- suppressWarnings(sf::st_simplify(
      object,
      dTolerance = simplify_tolerance,
      preserveTopology = TRUE
    ))
  }
  if (isTRUE(spec$sampled)) {
    attr(object, "swotr_sampled") <- TRUE
  }
  swanr_cache_set("reference_layers", cache_key, object)
  object
}

normalize_search_text <- function(x) {
  x <- repair_layer_text(as.character(x))
  x[is.na(x)] <- ""
  x <- iconv(x, from = "UTF-8", to = "ASCII//TRANSLIT", sub = "")
  tolower(trimws(x))
}

catalog_rows <- function(object, layer_name, title, subtitle, search_columns,
                         match_field, match_value, priority) {
  bounds <- lapply(sf::st_geometry(object), function(geometry) as.numeric(sf::st_bbox(geometry)))
  bounds_matrix <- do.call(rbind, bounds)
  search_columns <- intersect(search_columns, names(object))
  search_text <- if (length(search_columns)) {
    attributes <- sf::st_drop_geometry(object)
    values <- lapply(attributes[search_columns], function(column) {
      value <- as.character(column)
      value[is.na(value)] <- ""
      value
    })
    apply(as.data.frame(values, stringsAsFactors = FALSE), 1, paste, collapse = " ")
  } else {
    rep("", nrow(object))
  }
  search_text <- paste(as.character(title), as.character(subtitle), search_text)

  data.frame(
    layer_name = layer_name,
    title = as.character(title),
    subtitle = as.character(subtitle),
    search_text = normalize_search_text(search_text),
    match_field = match_field,
    match_value = as.character(match_value),
    xmin = bounds_matrix[, 1],
    ymin = bounds_matrix[, 2],
    xmax = bounds_matrix[, 3],
    ymax = bounds_matrix[, 4],
    priority = priority,
    stringsAsFactors = FALSE
  )
}

layer_column <- function(object, column, default = "") {
  if (column %in% names(object)) {
    value <- object[[column]]
  } else {
    value <- rep(default, nrow(object))
  }
  value <- as.character(value)
  value[is.na(value)] <- default
  value
}

build_layer_search_catalog <- function(base_dir) {
  state_path <- file.path(base_dir, "camadas", "BR_UF_2024.shp")
  states <- clean_layer_attributes(suppressWarnings(sf::st_read(state_path, quiet = TRUE)))
  if (is.na(sf::st_crs(states))) sf::st_crs(states) <- 4326
  states <- sf::st_transform(states, 4326)
  state_rows <- catalog_rows(
    states,
    layer_name = "limites_BR",
    title = paste(states$SIGLA_UF, states$NM_UF, sep = " — "),
    subtitle = paste("Unidade federativa · Região", states$NM_REGIA),
    search_columns = c("SIGLA_UF", "NM_UF", "CD_UF", "NM_REGIA"),
    match_field = "uf",
    match_value = states$SIGLA_UF,
    priority = 1L
  )

  stations <- load_reference_layer(base_dir, "Estacoes_hidrometeorologicas_ANA")
  station_location <- paste(
    ifelse(is.na(stations$Municipio), "", stations$Municipio),
    ifelse(is.na(stations$UF), "", stations$UF),
    sep = " · "
  )
  station_rows <- catalog_rows(
    stations,
    layer_name = "Estacoes_hidrometeorologicas_ANA",
    title = paste(stations$CodigoEstacao, stations$Nome, sep = " — "),
    subtitle = paste("Estação hidrometeorológica ·", station_location),
    search_columns = c(
      "CodigoEstacao", "CodigoAdicional", "Nome", "Municipio", "UF",
      "Rio", "Bacia", "SubBacia"
    ),
    match_field = "OBJECTID",
    match_value = stations$OBJECTID,
    priority = 2L
  )

  ottobacias <- load_reference_layer(base_dir, "SNIRH_OttobaciaNv1")
  otto_rows <- catalog_rows(
    ottobacias,
    layer_name = "SNIRH_OttobaciaNv1",
    title = paste("Ottobacia nível 1 —", ottobacias$NUNIVOTTO1),
    subtitle = "Região hidrográfica",
    search_columns = "NUNIVOTTO1",
    match_field = "NUNIVOTTO1",
    match_value = ottobacias$NUNIVOTTO1,
    priority = 3L
  )

  orbits <- load_reference_layer(base_dir, "SWOT_orbits_BR")
  orbit_rows <- catalog_rows(
    orbits,
    layer_name = "SWOT_orbits_BR",
    title = paste("Órbita SWOT · Pass", orbits$Pass),
    subtitle = paste(orbits$Country, orbits$Continent, sep = " · "),
    search_columns = c("Pass", "Country", "Continent", "State"),
    match_field = "Pass",
    match_value = orbits$Pass,
    priority = 4L
  )

  tiles <- load_reference_layer(base_dir, "SWOT_tiles_BR")
  tile_key <- paste(tiles$Pass, tiles$Tile, tiles$Scene, sep = "|")
  tile_rows <- catalog_rows(
    tiles,
    layer_name = "SWOT_tiles_BR",
    title = paste("Tile", tiles$Tile, "· Pass", tiles$Pass),
    subtitle = paste("Scene", tiles$Scene),
    search_columns = c("Pass", "Tile", "Scene", "State", "Country"),
    match_field = "__search_key",
    match_value = tile_key,
    priority = 5L
  )

  opera_tiles <- load_reference_layer(base_dir, "OPERA_tiles")
  opera_name <- layer_column(opera_tiles, "Name")
  opera_rows <- catalog_rows(
    opera_tiles,
    layer_name = "OPERA_tiles",
    title = paste("Grade OPERA —", opera_name),
    subtitle = "Cobertura OPERA DSWx · tile",
    search_columns = c("Name", "Description"),
    match_field = "Name",
    match_value = opera_name,
    priority = 6L
  )

  sword_reaches <- load_reference_layer(base_dir, "SWORD_reaches_v17b")
  reach_id <- layer_column(sword_reaches, "reach_id")
  reach_river <- layer_column(sword_reaches, "river_name")
  reach_title <- ifelse(nzchar(reach_river),
                        paste("Reach", reach_id, "—", reach_river),
                        paste("Reach", reach_id))
  reach_rows <- catalog_rows(
    sword_reaches,
    layer_name = "SWORD_reaches_v17b",
    title = reach_title,
    subtitle = "SWORD v17b · reach",
    search_columns = c("reach_id", "river_name", "swot_orbit", "type"),
    match_field = "reach_id",
    match_value = reach_id,
    priority = 7L
  )

  sword_nodes <- load_reference_layer(base_dir, "SWORD_nodes_v17b")
  node_id <- layer_column(sword_nodes, "node_id")
  node_river <- layer_column(sword_nodes, "river_name")
  node_title <- ifelse(nzchar(node_river),
                       paste("Node", node_id, "—", node_river),
                       paste("Node", node_id))
  node_rows <- catalog_rows(
    sword_nodes,
    layer_name = "SWORD_nodes_v17b",
    title = node_title,
    subtitle = "SWORD v17b · node (visualização otimizada)",
    search_columns = c("node_id", "reach_id", "river_name"),
    match_field = "node_id",
    match_value = node_id,
    priority = 8L
  )

  rbind(
    state_rows,
    station_rows,
    otto_rows,
    orbit_rows,
    tile_rows,
    opera_rows,
    reach_rows,
    node_rows
  )
}

search_layer_catalog <- function(catalog, query, limit = 20L) {
  normalized_query <- normalize_search_text(query)
  if (!nzchar(normalized_query)) return(catalog[0, , drop = FALSE])

  exact <- catalog$search_text == normalized_query |
    normalize_search_text(catalog$match_value) == normalized_query
  words <- strsplit(catalog$search_text, "[^[:alnum:]_]+")
  whole_word <- vapply(words, function(tokens) normalized_query %in% tokens, logical(1))
  starts <- startsWith(catalog$search_text, normalized_query)
  contains <- grepl(normalized_query, catalog$search_text, fixed = TRUE)
  score <- ifelse(
    exact,
    1L,
    ifelse(whole_word, 2L, ifelse(starts, 3L, ifelse(contains, 4L, 99L)))
  )
  selected <- catalog[score < 99L, , drop = FALSE]
  if (!nrow(selected)) return(selected)
  selected$score <- score[score < 99L]
  selected <- selected[order(selected$score, selected$priority, selected$title), , drop = FALSE]
  utils::head(selected, limit)
}

make_bbox_sf <- function(lon_min, lat_min, lon_max, lat_max) {
  values <- suppressWarnings(as.numeric(c(lon_min, lat_min, lon_max, lat_max)))
  if (any(!is.finite(values))) return(NULL)
  if (values[1] >= values[3] || values[2] >= values[4]) return(NULL)
  sf::st_as_sf(
    data.frame(id = 1L),
    geometry = sf::st_sfc(sf::st_polygon(list(matrix(
      c(
        values[1], values[2],
        values[3], values[2],
        values[3], values[4],
        values[1], values[4],
        values[1], values[2]
      ),
      byrow = TRUE,
      ncol = 2
    ))), crs = 4326)
  )
}

iso_utc <- function(x, end_of_day = FALSE) {
  time <- if (end_of_day) "23:59:59Z" else "00:00:00Z"
  paste0(as.character(as.Date(x)), "T", time)
}

monthly_temporal_ranges <- function(start_date, end_date) {
  start_date <- as.Date(start_date)
  end_date <- as.Date(end_date)
  first_month <- as.Date(format(start_date, "%Y-%m-01"))
  last_month <- as.Date(format(end_date, "%Y-%m-01"))
  month_starts <- seq(first_month, last_month, by = "month")

  lapply(seq_along(month_starts), function(index) {
    current <- month_starts[index]
    next_month <- seq(current, by = "month", length.out = 2L)[2]
    c(
      max(start_date, current),
      min(end_date, next_month - 1)
    )
  })
}

cmr_get <- function(query, timeout_seconds = 120) {
  args <- list(
    url = "https://cmr.earthdata.nasa.gov/search/granules.json",
    query = query,
    httr::user_agent("SWANr-Shiny/1.0"),
    httr::timeout(timeout_seconds)
  )
  auth <- swotr_authenticate(NULL)
  if (!is.null(auth)) args <- append(args, list(auth))
  response <- do.call(httr::RETRY, c(list(verb = "GET", times = 3, pause_base = 1), args))
  if (httr::http_error(response)) {
    stop(sprintf(
      "A consulta à NASA falhou (HTTP %s): %s",
      httr::status_code(response),
      httr::content(response, "text", encoding = "UTF-8")
    ))
  }
  httr::content(response, as = "parsed", type = "application/json", encoding = "UTF-8")
}

search_swot_data <- function(collection_name, granule_names, date_i, date_f,
                             bounding_box = NULL, page_size = 1000L) {
  patterns <- unique(granule_names)
  if (!length(patterns)) patterns <- NA_character_
  cache_key <- swanr_hash_text(
    "swot-search",
    collection_name,
    patterns,
    as.character(as.Date(date_i)),
    as.character(as.Date(date_f)),
    if (is.null(bounding_box)) "" else paste(as.numeric(bounding_box), collapse = ","),
    page_size
  )
  if (swanr_cache_has("swot_search", cache_key)) {
    return(swanr_cache_get("swot_search", cache_key))
  }

  ranges <- monthly_temporal_ranges(date_i, date_f)
  output <- list()

  for (pattern in patterns) {
    for (range in ranges) {
      page <- 1L
      repeat {
        query <- list(
          short_name = collection_name,
          temporal = paste(iso_utc(range[1]), iso_utc(range[2], TRUE), sep = ","),
          page_size = page_size,
          page_num = page
        )
        if (!is.na(pattern) && nzchar(pattern)) {
          query$producer_granule_id <- pattern
          query[["options[producer_granule_id][pattern]"]] <- "true"
        }
        if (!is.null(bounding_box)) {
          query$bounding_box <- paste(as.numeric(bounding_box), collapse = ",")
        }

        parsed <- cmr_get(query)
        entries <- parsed$feed$entry %||% list()
        if (!length(entries)) break
        output <- c(output, entries)
        if (length(entries) < page_size) break
        page <- page + 1L
      }
    }
  }
  swanr_cache_set("swot_search", cache_key, output)
  output
}

extract_download_link <- function(entry, datatype) {
  links <- entry$links %||% list()
  if (!length(links)) return(NA_character_)
  extension <- if (toupper(datatype) %in% c("RIVERSP", "LAKESP")) "zip" else "nc"

  hrefs <- vapply(links, function(link) as.character(link$href %||% ""), character(1))
  inherited <- vapply(links, function(link) isTRUE(link$inherited), logical(1))
  candidates <- hrefs[
    !inherited &
      grepl(paste0("\\.", extension, "($|\\?)"), hrefs, ignore.case = TRUE) &
      grepl("^https://", hrefs, ignore.case = TRUE)
  ]
  if (!length(candidates)) NA_character_ else candidates[1]
}

suffix_score <- function(suffix) {
  fidelity <- substr(suffix, 2, 2)
  major <- substr(suffix, 3, 3)
  minor <- substr(suffix, 4, 4)
  version <- suppressWarnings(as.numeric(substr(suffix, nchar(suffix) - 1, nchar(suffix))))
  fidelity_rank <- c(G = 4, I = 3, O = 2)[fidelity]
  if (is.na(fidelity_rank)) fidelity_rank <- 1
  major_rank <- match(major, LETTERS)
  if (is.na(major_rank)) major_rank <- 0
  minor_rank <- if (grepl("^[0-9]$", minor)) as.integer(minor) else 9L + (match(minor, LETTERS) %||% 0L)
  version <- ifelse(is.na(version), 0, version)
  fidelity_rank * 1e5 + major_rank * 1e3 + minor_rank * 10 + version
}

select_best_versions <- function(results) {
  if (!nrow(results)) return(results)
  parts <- strsplit(results$filename, "_", fixed = TRUE)
  enough <- lengths(parts) >= 3L
  prefix <- vapply(seq_along(parts), function(i) {
    if (!enough[i]) return(results$filename[i])
    paste(head(parts[[i]], -2L), collapse = "_")
  }, character(1))
  suffix <- vapply(seq_along(parts), function(i) {
    if (!enough[i]) return("")
    paste(tail(parts[[i]], 2L), collapse = "_")
  }, character(1))
  score <- vapply(suffix, suffix_score, numeric(1))
  score[!is.finite(score)] <- 0
  keep <- !duplicated(prefix[order(prefix, -score)])
  chosen_indices <- order(prefix, -score)[keep]
  results[sort(chosen_indices), , drop = FALSE]
}

entries_to_results <- function(entries, datatype) {
  if (!length(entries)) {
    return(data.frame(filename = character(), size = numeric(), download_link = character()))
  }
  rows <- lapply(entries, function(entry) {
    link <- extract_download_link(entry, datatype)
    if (is.na(link)) return(NULL)
    filename <- as.character(
      entry$producer_granule_id %||%
        entry$title %||%
        safe_filename(sub("\\?.*$", "", link))
    )
    size <- suppressWarnings(as.numeric(entry$granule_size %||% 0))
    data.frame(
      filename = filename,
      size = ifelse(is.finite(size), size, 0),
      download_link = link,
      stringsAsFactors = FALSE
    )
  })
  rows <- Filter(Negate(is.null), rows)
  if (!length(rows)) {
    return(data.frame(filename = character(), size = numeric(), download_link = character()))
  }
  output <- unique(do.call(rbind, rows))
  select_best_versions(output)
}

product_configuration <- function(product, subproduct = "", resolution = "") {
  switch(
    product,
    RiverSP = list(short_name = "SWOT_L2_HR_RIVERSP_D", sub = subproduct, datatype = "RIVERSP"),
    LakeSP = list(short_name = "SWOT_L2_HR_LAKESP_D", sub = subproduct, datatype = "LAKESP"),
    PIXC = list(short_name = "SWOT_L2_HR_PIXC_D", sub = "", datatype = "PIXC"),
    Raster = list(short_name = "SWOT_L2_HR_RASTER_D", sub = resolution, datatype = "RASTER"),
    stop("Produto inválido.")
  )
}

smart_filter_tiles <- function(base_dir, mask, product) {
  path <- file.path(base_dir, "camadas", "SWOT_tiles_BR.gpkg")
  if (is.null(mask) || !file.exists(path)) return(list(passes = character(), tiles = data.frame()))

  bbox <- sf::st_bbox(mask)
  tiles <- suppressWarnings(sf::st_read(path, wkt_filter = sf::st_as_text(sf::st_as_sfc(bbox)), quiet = TRUE))
  if (!nrow(tiles)) return(list(passes = character(), tiles = data.frame()))
  if (is.na(sf::st_crs(tiles))) sf::st_crs(tiles) <- 4326
  mask <- sf::st_transform(mask, sf::st_crs(tiles))
  selected <- lengths(sf::st_intersects(tiles, sf::st_union(mask))) > 0L
  tiles <- tiles[selected, , drop = FALSE]
  if (!nrow(tiles)) return(list(passes = character(), tiles = data.frame()))

  pass_col <- names(tiles)[tolower(names(tiles)) == "pass"][1] %||% ""
  tile_col <- names(tiles)[tolower(names(tiles)) %in% c("tile", "scene")][1] %||% ""
  passes <- if (nzchar(pass_col)) sprintf("%03d", as.integer(tiles[[pass_col]])) else character()
  tile_table <- data.frame()
  if (nzchar(pass_col) && nzchar(tile_col)) {
    tile_table <- unique(data.frame(
      pass = sprintf("%03d", as.integer(tiles[[pass_col]])),
      tile = as.character(tiles[[tile_col]]),
      stringsAsFactors = FALSE
    ))
  }
  list(passes = unique(passes[!is.na(passes)]), tiles = tile_table)
}

build_granule_patterns <- function(product, sub, cycle = "", pass = "", tile = "",
                                   continent = "SA", smart = NULL) {
  cycle <- if (nzchar(trimws(cycle))) sprintf("%03d", as.integer(cycle)) else "*"
  pass <- if (nzchar(trimws(pass))) sprintf("%03d", as.integer(pass)) else "*"
  tile <- if (nzchar(trimws(tile))) trimws(tile) else "*"
  sub <- sub %||% "*"
  if (!nzchar(sub)) sub <- "*"

  patterns <- character()
  if (!is.null(smart)) {
    if (product %in% c("RiverSP", "LakeSP") && length(smart$passes)) {
      patterns <- sprintf("*_%s_%s_%s_%s_*", sub, cycle, smart$passes, continent)
    } else if (product %in% c("PIXC", "Raster") && nrow(smart$tiles)) {
      if (product == "Raster") {
        patterns <- sprintf("*_%s_%s_%s_%s_*", sub, cycle, smart$tiles$pass, smart$tiles$tile)
      } else {
        patterns <- sprintf("*_%s_%s_%s_*", cycle, smart$tiles$pass, smart$tiles$tile)
      }
    }
  }

  if (!length(patterns)) {
    patterns <- switch(
      product,
      RiverSP = sprintf("*_%s_%s_%s_%s_*", sub, cycle, pass, continent),
      LakeSP = sprintf("*_%s_%s_%s_%s_*", sub, cycle, pass, continent),
      Raster = sprintf("*_%s_%s_%s_%s_*", sub, cycle, pass, tile),
      PIXC = sprintf("*_%s_%s_%s_*", cycle, pass, tile)
    )
  }
  unique(gsub("\\*+", "*", patterns))
}

validate_download_url <- function(url) {
  parsed <- httr::parse_url(url)
  host <- tolower(parsed$hostname %||% "")
  isTRUE(parsed$scheme == "https") &&
    (grepl("(^|\\.)nasa\\.gov$", host) || grepl("(^|\\.)earthdata\\.nasa\\.gov$", host))
}

download_earthdata_file <- function(url, destination) {
  if (!validate_download_url(url)) stop("URL de download não autorizada.")
  args <- list(
    url = url,
    httr::user_agent("SWANr-Shiny/1.0"),
    httr::timeout(300),
    httr::write_disk(destination, overwrite = TRUE),
    httr::progress()
  )
  auth <- swotr_authenticate(NULL)
  if (!is.null(auth)) args <- append(args, list(auth))
  response <- do.call(httr::RETRY, c(list(verb = "GET", times = 4, pause_base = 2), args))
  if (httr::http_error(response)) {
    stop(sprintf("Download recusado pela NASA (HTTP %s).", httr::status_code(response)))
  }
  destination
}

clip_vector_zip <- function(source_zip, mask, output_zip) {
  extraction <- tempfile("swotr_vector_")
  output_dir <- tempfile("swotr_shape_")
  on.exit(unlink(c(extraction, output_dir), recursive = TRUE, force = TRUE), add = TRUE)
  safe_unzip(source_zip, extraction)
  shapefiles <- list.files(extraction, pattern = "\\.shp$", recursive = TRUE, full.names = TRUE, ignore.case = TRUE)
  if (!length(shapefiles)) stop("ZIP sem Shapefile.")

  data <- suppressWarnings(sf::st_read(shapefiles[1], quiet = TRUE))
  if (is.na(sf::st_crs(data))) sf::st_crs(data) <- 4326
  local_mask <- sf::st_transform(mask, sf::st_crs(data))
  data <- suppressWarnings(sf::st_make_valid(data))
  local_mask <- suppressWarnings(sf::st_make_valid(sf::st_union(local_mask)))
  clipped <- suppressWarnings(sf::st_intersection(data, local_mask))
  if (!nrow(clipped)) return(FALSE)

  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  suppressWarnings(sf::st_write(clipped, file.path(output_dir, "data.shp"), quiet = TRUE))
  zip::zipr(output_zip, list.files(output_dir, full.names = TRUE), root = output_dir)
  TRUE
}

clip_netcdf <- function(source_nc, mask, output_nc) {
  if (!requireNamespace("ncdf4", quietly = TRUE)) {
    stop("O pacote 'ncdf4' é necessário para salvar o recorte NetCDF.")
  }
  raster <- terra::rast(source_nc)
  if (!nzchar(terra::crs(raster))) terra::crs(raster) <- "EPSG:4326"
  vector_mask <- terra::vect(sf::st_transform(mask, terra::crs(raster)))
  clipped <- terra::crop(raster, vector_mask, snap = "out")
  clipped <- terra::mask(clipped, vector_mask)
  if (terra::ncell(clipped) == 0L) return(FALSE)
  terra::writeCDF(clipped, output_nc, overwrite = TRUE)
  TRUE
}

clip_other_vector <- function(source, mask, output) {
  data <- suppressWarnings(sf::st_read(source, quiet = TRUE))
  if (is.na(sf::st_crs(data))) sf::st_crs(data) <- 4326
  local_mask <- sf::st_transform(mask, sf::st_crs(data))
  clipped <- suppressWarnings(sf::st_intersection(
    sf::st_make_valid(data),
    sf::st_make_valid(sf::st_union(local_mask))
  ))
  if (!nrow(clipped)) return(FALSE)
  driver <- switch(tolower(tools::file_ext(output)), gpkg = "GPKG", kml = "KML", "GeoJSON")
  suppressWarnings(sf::st_write(clipped, output, driver = driver, quiet = TRUE))
  TRUE
}

ana_service_url <- function(endpoint, query) {
  values <- vapply(query, function(value) {
    value <- as.character(value %||% "")
    utils::URLencode(value, reserved = TRUE)
  }, character(1))
  paste0(
    "http://telemetriaws1.ana.gov.br/ServiceANA.asmx/",
    endpoint,
    "?",
    paste(paste(names(values), values, sep = "="), collapse = "&")
  )
}

ana_xml_table <- function(url, node_name) {
  parsed <- XML::xmlParse(url, encoding = "UTF-8")
  nodes <- XML::getNodeSet(parsed, paste0("//", node_name))
  if (!length(nodes)) return(data.frame())
  XML::xmlToDataFrame(nodes = nodes, stringsAsFactors = FALSE)
}

ANA.hidroinventario <- function(codEstDE = "", codEstATE = "", tpEst = 1,
                                nmEst = "", nmRio = "",
                                codSubBacia = "", codBacia = "",
                                nmMunicipio = "", nmEstado = "",
                                sgResp = "", sgOper = "",
                                telemetrica = "",
                                colunas = c("Codigo", "AreaDrenagem",
                                            "Operando", "ResponsavelSigla",
                                            "OperadoraSigla",
                                            "Latitude", "Longitude"),
                                exportar.hidroinventario = NULL,
                                show.progress = TRUE,
                                ...) {
  url <- ana_service_url("HidroInventario", list(
    codEstDE = codEstDE,
    codEstATE = codEstATE,
    tpEst = tpEst,
    nmEst = nmEst,
    nmRio = nmRio,
    codSubBacia = codSubBacia,
    codBacia = codBacia,
    nmMunicipio = nmMunicipio,
    nmEstado = nmEstado,
    sgResp = sgResp,
    sgOper = sgOper,
    telemetrica = telemetrica
  ))

  dados.estacao <- ana_xml_table(url, "Table")
  if (!nrow(dados.estacao)) {
    warning(
      paste0("ANA.hidroinventario não encontrou informação para a estação '", codEstDE, "'."),
      call. = FALSE
    )
    return(NULL)
  }

  if (!is.null(colunas)) {
    colunas_existentes <- intersect(colunas, names(dados.estacao))
    dados.estacao <- dados.estacao[, colunas_existentes, drop = FALSE]
  }

  if (!is.null(exportar.hidroinventario)) {
    write.table(
      x = dados.estacao,
      file = exportar.hidroinventario,
      quote = FALSE,
      dec = ".",
      sep = "\t",
      row.names = FALSE,
      col.names = TRUE,
      append = FALSE,
      fileEncoding = "UTF-8"
    )
  }

  if (isTRUE(show.progress)) {
    message("ANA.hidroinventario: OK")
  }
  dados.estacao
}

ana_daily_columns <- function(tipo.dados) {
  prefix <- switch(
    as.character(tipo.dados),
    `1` = "Cota",
    `2` = "Chuva",
    `3` = "Vazao",
    stop("Tipo de dado ANA inválido.")
  )
  paste0(prefix, sprintf("%02d", 1:31))
}

ana_daily_name <- function(tipo.dados) {
  switch(as.character(tipo.dados), `1` = "Cota", `2` = "Chuva", `3` = "Vazao")
}

ana_numeric <- function(x) {
  suppressWarnings(as.numeric(gsub(",", ".", as.character(x), fixed = TRUE)))
}

serie.historica.ANA.proxy <- function(cod.estacao,
                                      data.inicio = "1800-01-01",
                                      data.fim = Sys.Date(),
                                      tipo.dados = 3,
                                      nivel.consist = 1,
                                      avisos = FALSE) {
  url <- ana_service_url("HidroSerieHistorica", list(
    codEstacao = cod.estacao,
    dataInicio = as.character(data.inicio),
    dataFim = as.character(data.fim),
    tipoDados = tipo.dados,
    nivelConsistencia = nivel.consist
  ))

  dados.estacao <- ana_xml_table(url, "SerieHistorica")
  if (!nrow(dados.estacao)) {
    if (isTRUE(avisos)) {
      warning(
        paste0("serie.historica.ANA não encontrou dados para a estação '", cod.estacao, "'."),
        call. = FALSE
      )
    }
    return(NULL)
  }

  colunas_dados <- intersect(ana_daily_columns(tipo.dados), names(dados.estacao))
  if (!length(colunas_dados)) return(NULL)

  if ("DataHora" %in% names(dados.estacao)) {
    dados.estacao$DataHora <- as.character(dados.estacao$DataHora)
  } else {
    return(NULL)
  }

  if ("NivelConsistencia" %in% names(dados.estacao) && any(duplicated(dados.estacao$DataHora))) {
    dados.estacao <- dados.estacao[order(
      suppressWarnings(as.integer(dados.estacao$NivelConsistencia)),
      decreasing = TRUE
    ), , drop = FALSE]
    dados.estacao <- dados.estacao[!duplicated(dados.estacao$DataHora), , drop = FALSE]
  }

  rows <- lapply(seq_len(nrow(dados.estacao)), function(index) {
    data_mes <- suppressWarnings(as.Date(substr(dados.estacao$DataHora[index], 1, 10)))
    if (is.na(data_mes)) return(NULL)
    datas <- suppressWarnings(as.Date(paste0(format(data_mes, "%Y-%m-"), sprintf("%02d", 1:31))))
    valores <- ana_numeric(unlist(dados.estacao[index, colunas_dados, drop = TRUE], use.names = FALSE))
    n <- min(length(datas), length(valores))
    if (!n) return(NULL)
    data.frame(
      Cod.estacao = as.character(dados.estacao$EstacaoCodigo[index] %||% cod.estacao),
      NivelConsistencia = as.character(dados.estacao$NivelConsistencia[index] %||% nivel.consist),
      Data = datas[seq_len(n)],
      Hora = substr(as.character(dados.estacao$DataHora[index]), 12, 19),
      Dados = valores[seq_len(n)],
      stringsAsFactors = FALSE
    )
  })
  rows <- Filter(Negate(is.null), rows)
  if (!length(rows)) return(NULL)

  tabela.final <- do.call(rbind, rows)
  tabela.final <- tabela.final[!is.na(tabela.final$Data), , drop = FALSE]
  if (!nrow(tabela.final) || all(is.na(tabela.final$Dados))) return(NULL)

  tabela.final$Hora[!nzchar(tabela.final$Hora) | is.na(tabela.final$Hora)] <- "00:00:00"
  tabela.final$NivelConsistencia <- suppressWarnings(as.integer(tabela.final$NivelConsistencia))
  tabela.final$NivelConsistencia[is.na(tabela.final$NivelConsistencia)] <- as.integer(nivel.consist)
  tabela.final <- tabela.final[order(tabela.final$Data), , drop = FALSE]

  primeiro_valido <- which(!is.na(tabela.final$Dados))[1]
  ultimo_valido <- tail(which(!is.na(tabela.final$Dados)), 1)
  tabela.final <- tabela.final[primeiro_valido:ultimo_valido, , drop = FALSE]

  datas.completas <- seq.Date(min(tabela.final$Data), max(tabela.final$Data), by = "day")
  if (length(datas.completas) > nrow(tabela.final)) {
    faltantes <- datas.completas[!datas.completas %in% tabela.final$Data]
    if (length(faltantes)) {
      tabela.final <- rbind(
        tabela.final,
        data.frame(
          Cod.estacao = as.character(cod.estacao),
          NivelConsistencia = as.integer(nivel.consist),
          Data = faltantes,
          Hora = "00:00:00",
          Dados = NA_real_,
          stringsAsFactors = FALSE
        )
      )
      tabela.final <- tabela.final[order(tabela.final$Data), , drop = FALSE]
    }
  }

  names(tabela.final)[names(tabela.final) == "Dados"] <- ana_daily_name(tipo.dados)
  data.inicio <- as.Date(data.inicio)
  data.fim <- as.Date(data.fim)
  tabela.final <- tabela.final[
    tabela.final$Data >= data.inicio & tabela.final$Data <= data.fim,
    ,
    drop = FALSE
  ]
  if (!nrow(tabela.final)) return(NULL)
  rownames(tabela.final) <- NULL
  tabela.final
}

serie.historica.ANA <- function(cod.estacao,
                                data.inicio = "1800-01-01",
                                data.fim = Sys.Date(),
                                tipo.dados = 3,
                                nivel.consist = 1,
                                exportar.serie.historica = NULL,
                                show.progress = TRUE,
                                avisos = FALSE,
                                ...) {
  cod.estacao <- unique(trimws(as.character(cod.estacao)))
  cod.estacao <- cod.estacao[nzchar(cod.estacao)]
  if (!length(cod.estacao)) return(NULL)

  series <- lapply(cod.estacao, function(codigo) {
    serie.historica.ANA.proxy(
      cod.estacao = codigo,
      data.inicio = data.inicio,
      data.fim = data.fim,
      tipo.dados = tipo.dados,
      nivel.consist = nivel.consist,
      avisos = avisos
    )
  })
  series <- Filter(Negate(is.null), series)
  if (!length(series)) return(NULL)

  serie.historica <- do.call(rbind, series)
  serie.historica$Cod.estacao <- as.integer(serie.historica$Cod.estacao)
  serie.historica$NivelConsistencia <- as.integer(serie.historica$NivelConsistencia)
  rownames(serie.historica) <- NULL

  if (!is.null(exportar.serie.historica)) {
    write.table(
      x = serie.historica,
      file = exportar.serie.historica,
      quote = FALSE,
      dec = ".",
      sep = "\t",
      row.names = FALSE,
      col.names = TRUE,
      append = FALSE,
      fileEncoding = "UTF-8"
    )
  }

  if (isTRUE(show.progress)) {
    message("serie.historica.ANA: OK")
  }
  serie.historica
}

parse_station_codes <- function(x) {
  x <- trimws(as.character(x %||% ""))
  if (!nzchar(x)) return(character())
  unique(trimws(unlist(strsplit(x, "[,;[:space:]]+"))))
}

ana_subproduct_info <- function(subproduct) {
  switch(
    subproduct,
    vazao_diaria = list(label = "Vazão (série histórica diária)", suffix = "vazao_diaria", tipo = 3L),
    cota_diaria = list(label = "Cota (série histórica diária)", suffix = "cota_diaria", tipo = 1L),
    hidroinventario = list(label = "Hidroinventário", suffix = "hidroinventario", tipo = NA_integer_),
    stop("Subproduto ANA inválido.")
  )
}

station_code_vector <- function(stations) {
  codigo <- as.character(stations$CodigoEstacao %||% "")
  codigo[is.na(codigo)] <- ""
  trimws(codigo)
}

select_ana_stations <- function(base_dir, mask = NULL, station_codes = character()) {
  stations <- load_reference_layer(base_dir, "Estacoes_hidrometeorologicas_ANA")
  type_text <- normalize_search_text(stations$TipoEstacao %||% "")
  stations <- stations[grepl("fluvi", type_text), , drop = FALSE]

  station_codes <- parse_station_codes(station_codes)
  if (!is.null(mask)) {
    mask <- sf::st_transform(mask, sf::st_crs(stations))
    mask <- suppressWarnings(sf::st_make_valid(sf::st_union(mask)))
    bbox <- sf::st_bbox(mask)
    coords <- sf::st_coordinates(stations)
    in_bbox <- coords[, 1] >= bbox["xmin"] & coords[, 1] <= bbox["xmax"] &
      coords[, 2] >= bbox["ymin"] & coords[, 2] <= bbox["ymax"]
    stations <- stations[in_bbox, , drop = FALSE]
    if (!nrow(stations)) return(stations)
    intersects <- lengths(sf::st_intersects(stations, mask)) > 0L
    stations <- stations[intersects, , drop = FALSE]
  }

  if (length(station_codes)) {
    stations <- stations[station_code_vector(stations) %in% station_codes, , drop = FALSE]
  } else if (is.null(mask)) {
    stop("Defina uma área de interesse ou informe um código de estação.")
  }

  stations
}

ana_inventory_from_station <- function(station) {
  row <- sf::st_drop_geometry(station)
  row <- as.data.frame(row, stringsAsFactors = FALSE)
  if ("CodigoEstacao" %in% names(row) && !"Codigo" %in% names(row)) {
    row <- cbind(Codigo = as.character(row$CodigoEstacao), row)
  }
  row
}

prepare_ana_results <- function(base_dir, request, mask = NULL, progress = NULL) {
  subproduct <- as.character(request$ana_subproduto %||% "vazao_diaria")
  sub_info <- ana_subproduct_info(subproduct)
  nivel.consist <- suppressWarnings(as.integer(request$ana_consistency %||% 1L))
  if (!nivel.consist %in% c(1L, 2L)) nivel.consist <- 1L
  data.inicio <- as.Date(request$start_date %||% NA)
  data.fim <- as.Date(request$end_date %||% NA)
  if (is.na(data.inicio) || is.na(data.fim)) stop("Selecione o período.")
  if (data.inicio > data.fim) stop("A data inicial deve ser anterior à data final.")

  station_filter <- as.character(request$ana_station_code %||% "")
  stations <- select_ana_stations(base_dir, mask, station_filter)
  if (!nrow(stations)) stop("Nenhuma estação fluviométrica da ANA foi encontrada nessa seleção.")

  codigos <- station_code_vector(stations)
  nomes <- as.character(stations$Nome %||% "")
  nomes[is.na(nomes)] <- ""

  workspace <- tempfile("swanr_ana_")
  output_dir <- file.path(workspace, "arquivos")
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

  files <- list()
  failures <- character()
  total <- length(codigos)

  if (is.function(progress)) {
    progress(0, total, "", sprintf("%d estação(ões) selecionada(s)", total))
  }

  if (identical(subproduct, "hidroinventario")) {
    inventory <- sf::st_drop_geometry(stations)
    inventory <- as.data.frame(inventory, stringsAsFactors = FALSE)
    if ("CodigoEstacao" %in% names(inventory) && !"Codigo" %in% names(inventory)) {
      inventory <- cbind(Codigo = as.character(inventory$CodigoEstacao), inventory)
    }

    output_names <- paste0(
      "ANA_RHN_",
      safe_filename(codigos),
      "_",
      sub_info$suffix,
      ".txt"
    )
    files <- data.frame(
      token = codigos,
      station_code = codigos,
      station_name = nomes,
      filename = codigos,
      output_name = output_names,
      file_path = NA_character_,
      size = 0.001,
      stringsAsFactors = FALSE
    )
    if (is.function(progress)) {
      progress(total, total, "", "Inventário local pronto para download")
    }

    return(list(
      workspace = workspace,
      files = files,
      subproduct = subproduct,
      subproduct_label = sub_info$label,
      consistency = if (nivel.consist == 1L) "Bruto" else "Consistido",
      failures = failures,
      lazy_inventory = TRUE,
      inventory = inventory
    ))
  }

  for (index in seq_along(codigos)) {
    codigo <- codigos[index]
    if (is.function(progress)) {
      progress(index, total, codigo, sprintf("Estação %s (%d/%d)", codigo, index, total))
    }

    output <- tryCatch({
      cache_key <- swanr_hash_text(
        "ana-series",
        codigo,
        as.character(data.inicio),
        as.character(data.fim),
        sub_info$tipo,
        nivel.consist
      )
      if (swanr_cache_has("ana_series", cache_key)) {
        swanr_cache_get("ana_series", cache_key)
      } else {
        series <- serie.historica.ANA(
          cod.estacao = codigo,
          data.inicio = data.inicio,
          data.fim = data.fim,
          tipo.dados = sub_info$tipo,
          nivel.consist = nivel.consist,
          show.progress = FALSE,
          avisos = FALSE
        )
        swanr_cache_set("ana_series", cache_key, series)
        series
      }
    }, error = function(error) {
      failures <<- c(failures, paste0(codigo, ": ", conditionMessage(error)))
      NULL
    })

    if (is.null(output) || !nrow(output)) next

    output_name <- paste0(
      "ANA_RHN_",
      safe_filename(codigo),
      "_",
      sub_info$suffix,
      ".txt"
    )
    output_path <- file.path(output_dir, output_name)
    write.table(
      x = output,
      file = output_path,
      quote = FALSE,
      dec = ".",
      sep = "\t",
      row.names = FALSE,
      col.names = TRUE,
      append = FALSE,
      fileEncoding = "UTF-8"
    )

    files[[length(files) + 1L]] <- data.frame(
      token = codigo,
      station_code = codigo,
      station_name = nomes[index],
      filename = codigo,
      output_name = output_name,
      file_path = output_path,
      size = round(file.info(output_path)$size / 1024^2, 4),
      stringsAsFactors = FALSE
    )
  }

  if (!length(files)) {
    unlink(workspace, recursive = TRUE, force = TRUE)
    stop("As estações selecionadas não retornaram dados no Hidroweb para esse período/produto.")
  }

  list(
    workspace = workspace,
    files = do.call(rbind, files),
    subproduct = subproduct,
    subproduct_label = sub_info$label,
    consistency = if (nivel.consist == 1L) "Bruto" else "Consistido",
    failures = failures
  )
}

create_ana_download_bundle <- function(cache, selected_tokens, destination) {
  if (is.null(cache) || is.null(cache$files) || !nrow(cache$files)) {
    stop("A consulta ANA não está mais disponível. Rode a consulta novamente.")
  }
  selected_tokens <- unique(as.character(selected_tokens))
  selected <- cache$files[cache$files$token %in% selected_tokens, , drop = FALSE]
  if (!nrow(selected)) stop("Nenhuma estação selecionada foi encontrada na consulta atual.")

  workspace <- tempfile("swanr_ana_zip_")
  output_dir <- file.path(workspace, "arquivos")
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(workspace, recursive = TRUE, force = TRUE), add = TRUE)

  if (isTRUE(cache$lazy_inventory)) {
    if (is.null(cache$inventory) || !nrow(cache$inventory)) {
      stop("O inventário ANA não está mais disponível. Rode a consulta novamente.")
    }
    selected_indices <- match(selected$token, cache$files$token)
    for (index in seq_len(nrow(selected))) {
      write.table(
        x = cache$inventory[selected_indices[index], , drop = FALSE],
        file = file.path(output_dir, selected$output_name[index]),
        quote = FALSE,
        dec = ".",
        sep = "\t",
        row.names = FALSE,
        col.names = TRUE,
        append = FALSE,
        fileEncoding = "UTF-8"
      )
    }
  } else {
    for (index in seq_len(nrow(selected))) {
      file.copy(
        selected$file_path[index],
        file.path(output_dir, selected$output_name[index]),
        overwrite = TRUE
      )
    }
  }

  report <- c(
    "========================================",
    "RELATÓRIO DE DOWNLOAD - ANA HIDROWEB",
    "========================================",
    paste("Data:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
    paste("Subproduto:", cache$subproduct_label %||% cache$subproduct),
    paste("Nível de consistência:", cache$consistency %||% "Não informado"),
    paste("Total de estações:", nrow(selected)),
    "",
    paste0("> ", selected$station_code, ifelse(nzchar(selected$station_name), paste0(" — ", selected$station_name), "")),
    ""
  )
  if (length(cache$failures)) {
    report <- c(report, "Avisos/falhas durante a consulta:", cache$failures, "")
  }
  writeLines(report, file.path(output_dir, "Relatorio_ANA_Hidroweb.txt"), useBytes = TRUE)
  zip::zipr(destination, list.files(output_dir, full.names = TRUE), root = output_dir)
  invisible(nrow(selected))
}

opera_product_configuration <- function(product, subproduct) {
  product <- toupper(gsub("_", "-", as.character(product %||% "DSWx-HLS")))
  subproduct <- toupper(gsub("-", "", as.character(subproduct %||% "WTR")))
  products <- c("DSWX-HLS", "DSWX-S1")
  subproducts <- c("WTR", "BWTR", "CONF", "DIAG", "WTR2")
  if (!product %in% products) stop("Produto OPERA inválido.")
  if (!subproduct %in% subproducts) stop("Subproduto OPERA inválido.")
  list(
    product = product,
    subproduct = subproduct,
    label = paste(product, subproduct)
  )
}

swanr_python <- function() {
  candidates <- c(
    Sys.getenv("SWANR_PYTHON", unset = ""),
    Sys.getenv("RETICULATE_PYTHON", unset = ""),
    Sys.which("python3"),
    Sys.which("python")
  )
  candidates <- unique(candidates[nzchar(candidates)])
  candidates <- candidates[file.exists(candidates)]
  if (!length(candidates)) {
    stop("Python não encontrado. Configure SWANR_PYTHON apontando para o ambiente com geopandas, scipy e earthaccess.")
  }
  candidates[1]
}

run_python_script <- function(script, args, step_label = basename(script)) {
  if (!file.exists(script)) stop("Script Python não encontrado: ", script)
  script <- normalizePath(script, winslash = "/", mustWork = TRUE)
  quoted_args <- shQuote(c(script, as.character(args)))
  output <- system2(
    swanr_python(),
    args = quoted_args,
    stdout = TRUE,
    stderr = TRUE
  )
  status <- attr(output, "status")
  if (!is.null(status) && !identical(status, 0L)) {
    details <- paste(utils::tail(output, 20), collapse = "\n")
    stop(sprintf("%s falhou no Python.\n%s", step_label, details))
  }
  output
}

sword_node_columns <- function(path) {
  if (!file.exists(path)) return(character())
  file_info <- file.info(path)
  cache_key <- swanr_hash_text(
    "sword-columns",
    normalizePath(path, winslash = "/", mustWork = TRUE),
    file_info$size,
    file_info$mtime
  )
  if (swanr_cache_has("sword_columns", cache_key)) {
    return(swanr_cache_get("sword_columns", cache_key))
  }
  sample <- tryCatch(
    suppressWarnings(sf::st_read(
      path,
      query = "SELECT * FROM nodes LIMIT 1",
      quiet = TRUE
    )),
    error = function(error) NULL
  )
  columns <- names(sample %||% data.frame())
  swanr_cache_set("sword_columns", cache_key, columns)
  columns
}

sword_nodes_source <- function(base_dir) {
  configured <- Sys.getenv("SWANR_SWORD_NODES_V17B", unset = "")
  source_key <- swanr_hash_text("sword-source", normalizePath(base_dir, winslash = "/", mustWork = FALSE), configured)
  if (swanr_cache_has("sword_source", source_key)) {
    return(swanr_cache_get("sword_source", source_key))
  }
  candidates <- c(
    configured,
    file.path(base_dir, "camadas", "sa_sword_nodes_v17b_full.gpkg"),
    file.path(base_dir, "camadas", "sa_sword_nodes_v17b.gpkg"),
    "/Users/lappicy/Desktop/JPL/SWORD/sa_sword_nodes_v17b.gpkg"
  )
  candidates <- unique(candidates[nzchar(candidates) & file.exists(candidates)])
  required <- c("node_id", "reach_id", "node_len", "width")
  for (candidate in candidates) {
    columns <- sword_node_columns(candidate)
    if (all(required %in% columns)) {
      swanr_cache_set("sword_source", source_key, candidate)
      return(candidate)
    }
  }
  stop(
    "Arquivo SWORD v17b completo não encontrado. Configure SWANR_SWORD_NODES_V17B ",
    "apontando para sa_sword_nodes_v17b.gpkg com node_len e width."
  )
}

utm_epsg_for_sf <- function(object) {
  object_4326 <- sf::st_transform(object, 4326)
  centroid <- suppressWarnings(sf::st_coordinates(sf::st_centroid(sf::st_union(object_4326)))[1, ])
  lon <- centroid[1]
  lat <- centroid[2]
  zone <- floor((lon + 180) / 6) + 1
  if (is.na(zone) || zone < 1 || zone > 60) zone <- 23
  if (is.na(lat) || lat < 0) 32700 + zone else 32600 + zone
}

prepare_opera_sword_nodes <- function(base_dir, mask, output_path, nodes_path = NULL) {
  if (is.null(mask)) stop("Defina uma área de interesse para a consulta OPERA.")
  nodes_path <- nodes_path %||% sword_nodes_source(base_dir)

  mask <- suppressWarnings(sf::st_make_valid(mask))
  mask_4326 <- sf::st_transform(mask, 4326)
  bbox_wkt <- sf::st_as_text(sf::st_as_sfc(sf::st_bbox(mask_4326)))
  nodes <- suppressWarnings(sf::st_read(
    nodes_path,
    layer = "nodes",
    wkt_filter = bbox_wkt,
    quiet = TRUE
  ))
  if (!nrow(nodes)) stop("Nenhum node SWORD v17b foi encontrado na área selecionada.")

  if (is.na(sf::st_crs(nodes))) sf::st_crs(nodes) <- 4326
  local_mask <- sf::st_transform(sf::st_union(mask_4326), sf::st_crs(nodes))
  selected <- lengths(sf::st_intersects(nodes, local_mask)) > 0L
  nodes <- nodes[selected, , drop = FALSE]
  if (!nrow(nodes)) stop("Nenhum node SWORD v17b intersecta a área selecionada.")
  if (nrow(nodes) < 3L) stop("A área selecionada precisa conter pelo menos 3 nodes SWORD para criar polígonos de Thiessen.")

  if (!"ext_dist_c" %in% names(nodes)) {
    nodes$ext_dist_c <- 5
  }
  required <- c(attr(nodes, "sf_column"), "reach_id", "node_id", "node_len", "width", "ext_dist_c")
  missing <- setdiff(required, names(nodes))
  if (length(missing)) {
    stop("O arquivo SWORD não contém as colunas necessárias: ", paste(missing, collapse = ", "))
  }

  nodes <- sf::st_transform(nodes, utm_epsg_for_sf(mask_4326))
  nodes$node_id <- as.character(nodes$node_id)
  nodes$reach_id <- as.character(nodes$reach_id)
  dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
  if (file.exists(output_path)) unlink(output_path, force = TRUE)
  suppressWarnings(sf::st_write(nodes, output_path, driver = "GPKG", quiet = TRUE))
  nodes
}

swanr_output_dir <- function(base_dir) {
  configured <- Sys.getenv("SWANR_OUTPUT_DIR", unset = "")
  candidates <- c(
    configured,
    file.path(base_dir, "OPERA_runs"),
    file.path(tempdir(), "SWANr_OPERA_runs")
  )
  candidates <- unique(candidates[nzchar(candidates)])
  for (candidate in candidates) {
    ok <- dir.create(candidate, recursive = TRUE, showWarnings = FALSE)
    if (dir.exists(candidate) && file.access(candidate, 2) == 0) return(candidate)
  }
  stop("Não foi possível criar uma pasta de saída para OPERA.")
}

opera_aoi_cache_key <- function(base_dir, mask, nodes_source = NULL) {
  if (is.null(mask)) stop("Defina uma área de interesse para a consulta OPERA.")
  nodes_source <- nodes_source %||% sword_nodes_source(base_dir)
  source_info <- file.info(nodes_source)
  mask_wkt <- sf::st_as_text(sf::st_geometry(
    sf::st_transform(suppressWarnings(sf::st_make_valid(sf::st_union(mask))), 4326)
  ))
  swanr_hash_text(
    "opera-aoi",
    mask_wkt,
    normalizePath(nodes_source, winslash = "/", mustWork = TRUE),
    source_info$size,
    source_info$mtime
  )
}

opera_cache_paths <- function(base_dir, aoi_key, configuration, start_date, end_date) {
  cache_root <- file.path(swanr_output_dir(base_dir), "_cache")
  preprocess_dir <- file.path(cache_root, "aoi", aoi_key)
  download_key <- swanr_hash_text(
    "opera-download",
    aoi_key,
    configuration$product,
    configuration$subproduct,
    as.character(start_date),
    as.character(end_date)
  )
  download_dir <- file.path(
    cache_root,
    "downloads",
    paste0(configuration$product, "_", configuration$subproduct, "_", download_key)
  )
  list(
    preprocess_dir = preprocess_dir,
    nodes = file.path(preprocess_dir, "Chosen_nodes.gpkg"),
    buffers = file.path(preprocess_dir, "sword_buffers.gpkg"),
    thiessen = file.path(preprocess_dir, "thiessen_polygons.gpkg"),
    download_dir = download_dir,
    complete_marker = file.path(download_dir, ".complete")
  )
}

opera_file_table <- function(opera_out) {
  if (!dir.exists(opera_out)) {
    return(data.frame(
      token = character(),
      filename = character(),
      file_path = character(),
      size = numeric(),
      stringsAsFactors = FALSE
    ))
  }
  files <- list.files(opera_out, full.names = TRUE, recursive = TRUE, all.files = FALSE)
  files <- files[file.exists(files) & !dir.exists(files)]
  if (!length(files)) {
    return(data.frame(
      token = character(),
      filename = character(),
      file_path = character(),
      size = numeric(),
      stringsAsFactors = FALSE
    ))
  }
  root <- normalizePath(opera_out, winslash = "/", mustWork = TRUE)
  file_paths <- normalizePath(files, winslash = "/", mustWork = TRUE)
  relative_names <- sub(paste0("^", gsub("([][{}()+*^$|\\\\?.])", "\\\\\\1", root), "/?"), "", file_paths)
  data.frame(
    token = sprintf("opera_%04d", seq_along(files)),
    filename = relative_names,
    file_path = file_paths,
    size = round(file.info(files)$size / 1024^2, 4),
    stringsAsFactors = FALSE
  )
}

prepare_opera_results <- function(base_dir, request, mask = NULL, progress = NULL) {
  configuration <- opera_product_configuration(
    request$opera_produto %||% "DSWx-HLS",
    request$opera_subproduto %||% "WTR"
  )
  start_date <- as.Date(request$start_date %||% NA)
  end_date <- as.Date(request$end_date %||% NA)
  if (is.na(start_date) || is.na(end_date)) stop("Selecione o período.")
  if (start_date > end_date) stop("A data inicial deve ser anterior à data final.")

  nodes_source <- sword_nodes_source(base_dir)
  aoi_key <- opera_aoi_cache_key(base_dir, mask, nodes_source)
  cache_paths <- opera_cache_paths(base_dir, aoi_key, configuration, start_date, end_date)
  run_id <- paste0("opera_", format(Sys.time(), "%Y%m%d_%H%M%S"))
  run_dir <- file.path(swanr_output_dir(base_dir), run_id)
  dir.create(run_dir, recursive = TRUE, showWarnings = FALSE)
  dir.create(cache_paths$preprocess_dir, recursive = TRUE, showWarnings = FALSE)
  dir.create(cache_paths$download_dir, recursive = TRUE, showWarnings = FALSE)

  scripts_dir <- file.path(base_dir, "Python codes")
  nodes_path <- cache_paths$nodes
  buffers_path <- cache_paths$buffers
  thiessen_path <- cache_paths$thiessen
  opera_out <- cache_paths$download_dir
  tile_out <- file.path(base_dir, "camadas", "OPERA_tile_boundaries_polygons.gpkg")

  if (file.exists(nodes_path)) {
    if (is.function(progress)) progress(1, 4, "Usando nodes SWORD em cache")
    nodes <- suppressWarnings(sf::st_read(nodes_path, quiet = TRUE))
  } else {
    if (is.function(progress)) progress(1, 4, "Recortando nodes SWORD v17b")
    nodes <- prepare_opera_sword_nodes(base_dir, mask, nodes_path, nodes_path = nodes_source)
  }

  if (file.exists(buffers_path)) {
    if (is.function(progress)) progress(2, 4, "Usando buffers SWORD em cache")
  } else {
    if (is.function(progress)) progress(2, 4, "Criando buffers SWORD")
    run_python_script(
      file.path(scripts_dir, "CreateSWORDBuffers.py"),
      c(nodes_path, buffers_path),
      "CreateSWORDBuffers.py"
    )
  }

  if (file.exists(thiessen_path)) {
    if (is.function(progress)) progress(3, 4, "Usando polígonos de Thiessen em cache")
  } else {
    if (is.function(progress)) progress(3, 4, "Criando polígonos de Thiessen")
    run_python_script(
      file.path(scripts_dir, "CreateThiessenPolygons.py"),
      c(nodes_path, buffers_path, thiessen_path),
      "CreateThiessenPolygons.py"
    )
  }

  cached_files <- if (file.exists(cache_paths$complete_marker)) {
    opera_file_table(opera_out)
  } else {
    data.frame(token = character(), filename = character(), file_path = character(), size = numeric())
  }
  if (nrow(cached_files)) {
    if (is.function(progress)) progress(4, 4, "Usando arquivos OPERA em cache")
  } else {
    if (dir.exists(opera_out)) {
      unlink(opera_out, recursive = TRUE, force = TRUE)
    }
    dir.create(opera_out, recursive = TRUE, showWarnings = FALSE)
    if (is.function(progress)) progress(4, 4, "Baixando arquivos OPERA")
    run_python_script(
      file.path(scripts_dir, "OPERA_Dwnl.py"),
      c(
        thiessen_path,
        nodes_path,
        as.character(start_date),
        as.character(end_date),
        opera_out,
        tile_out,
        configuration$product,
        configuration$subproduct
      ),
      "OPERA_Dwnl.py"
    )
    writeLines(
      paste("complete", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
      cache_paths$complete_marker,
      useBytes = TRUE
    )
  }

  files <- opera_file_table(opera_out)
  if (!nrow(files)) stop("A consulta OPERA terminou, mas nenhum arquivo foi salvo.")
  list(
    workspace = run_dir,
    files = files,
    nodes = nrow(nodes),
    product = configuration$product,
    subproduct = configuration$subproduct,
    label = configuration$label,
    start_date = start_date,
    end_date = end_date,
    opera_out = opera_out,
    thiessen_path = thiessen_path
  )
}

create_opera_download_bundle <- function(cache, selected_tokens, destination) {
  if (is.null(cache) || is.null(cache$files) || !nrow(cache$files)) {
    stop("A consulta OPERA não está mais disponível. Rode a consulta novamente.")
  }
  selected_tokens <- unique(as.character(selected_tokens))
  selected <- cache$files[cache$files$token %in% selected_tokens, , drop = FALSE]
  if (!nrow(selected)) stop("Nenhum arquivo OPERA selecionado foi encontrado na consulta atual.")

  workspace <- tempfile("swanr_opera_zip_")
  output_dir <- file.path(workspace, "arquivos")
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(workspace, recursive = TRUE, force = TRUE), add = TRUE)

  for (index in seq_len(nrow(selected))) {
    target_path <- file.path(output_dir, selected$filename[index])
    dir.create(dirname(target_path), recursive = TRUE, showWarnings = FALSE)
    file.copy(
      selected$file_path[index],
      target_path,
      overwrite = TRUE
    )
  }

  report <- c(
    "========================================",
    "RELATÓRIO DE DOWNLOAD - OPERA NASA",
    "========================================",
    paste("Data:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
    paste("Produto:", cache$product %||% ""),
    paste("Subproduto:", cache$subproduct %||% ""),
    paste("Período:", paste(cache$start_date, cache$end_date, sep = " a ")),
    paste("Nodes SWORD selecionados:", cache$nodes %||% ""),
    paste("Total de arquivos:", nrow(selected)),
    "",
    paste0("> ", selected$filename),
    ""
  )
  writeLines(report, file.path(output_dir, "Relatorio_OPERA.txt"), useBytes = TRUE)
  zip::zipr(destination, list.files(output_dir, full.names = TRUE), root = output_dir)
  invisible(nrow(selected))
}

create_download_bundle <- function(urls, destination, mask = NULL, progress = NULL) {
  if (!swotr_has_credentials()) {
    stop("Configure NASA_EARTHDATA_TOKEN ou EARTHDATA_USERNAME/EARTHDATA_PASSWORD antes de baixar.")
  }
  urls <- unique(as.character(urls))
  if (!length(urls)) stop("Nenhum arquivo foi selecionado.")

  workspace <- tempfile("swotr_bundle_")
  output_dir <- file.path(workspace, "arquivos")
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(workspace, recursive = TRUE, force = TRUE), add = TRUE)

  report <- c(
    "========================================",
    "RELATÓRIO DE DOWNLOAD - SWOT NASA",
    "========================================",
    paste("Data:", format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z")),
    paste("Total de arquivos:", length(urls)),
    ""
  )
  counts <- c(saved = 0L, empty = 0L, failed = 0L)

  for (index in seq_along(urls)) {
    if (is.function(progress)) progress(index, length(urls), basename(sub("\\?.*$", "", urls[index])))
    url <- urls[index]
    original_name <- safe_filename(basename(sub("\\?.*$", "", url)))
    extension <- tolower(tools::file_ext(original_name))
    local_source <- file.path(workspace, paste0("source_", index, ".", extension))
    status <- "Falha desconhecida."

    try_result <- tryCatch({
      download_earthdata_file(url, local_source)
      if (is.null(mask)) {
        file.copy(local_source, file.path(output_dir, original_name), overwrite = TRUE)
        status <- "Baixado sem recorte."
        counts["saved"] <- counts["saved"] + 1L
      } else {
        output_name <- paste0("recorte_", original_name)
        output_path <- file.path(output_dir, output_name)
        has_data <- switch(
          extension,
          zip = clip_vector_zip(local_source, mask, output_path),
          nc = clip_netcdf(local_source, mask, output_path),
          clip_other_vector(local_source, mask, output_path)
        )
        if (isTRUE(has_data)) {
          status <- "Recorte efetuado com sucesso."
          counts["saved"] <- counts["saved"] + 1L
        } else {
          status <- "Sem sobreposição na área de interesse."
          counts["empty"] <- counts["empty"] + 1L
        }
      }
      TRUE
    }, error = function(error) {
      status <<- paste("Falha:", conditionMessage(error))
      counts["failed"] <<- counts["failed"] + 1L
      FALSE
    })

    report <- c(report, paste0("> ", original_name), paste("  Status:", status), "")
    invisible(try_result)
  }

  report <- c(
    report,
    "========================================",
    "RESUMO:",
    paste("- Baixados:", counts["saved"]),
    paste("- Sem sobreposição:", counts["empty"]),
    paste("- Falhas:", counts["failed"])
  )
  writeLines(report, file.path(output_dir, "Relatorio_SWOT.txt"), useBytes = TRUE)
  zip::zipr(destination, list.files(output_dir, full.names = TRUE), root = output_dir)
  invisible(counts)
}
