.swanr_dependency_anchor <- function() {
  list(
    httr = httr::GET,
    jsonlite = jsonlite::toJSON,
    XML = XML::xmlParse,
    sf = sf::st_read,
    terra = terra::rast,
    zip = zip::zipr
  )
}
