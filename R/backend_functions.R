# The dashboard backend is kept with the bundled application so it can also be
# run directly during development.  Source it while the package is installed so
# the same functions are compiled into the SWANr namespace and are available
# through SWANr::.
.swanr_backend_source <- file.path("inst", "app", "R", "swot_functions.R")
if (!file.exists(.swanr_backend_source)) {
  .swanr_backend_source <- system.file(
    "app", "R", "swot_functions.R",
    package = "SWANr",
    mustWork = FALSE
  )
}
if (!nzchar(.swanr_backend_source) || !file.exists(.swanr_backend_source)) {
  stop("The bundled SWANr backend module could not be found.", call. = FALSE)
}
sys.source(.swanr_backend_source, envir = environment())
rm(.swanr_backend_source)
