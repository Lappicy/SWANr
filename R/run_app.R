#' Run the SWANr Shiny dashboard
#'
#' Starts the SWANr dashboard bundled with the package.
#'
#' @param ... Arguments passed to [shiny::runApp()], such as `host`, `port`
#'   and `launch.browser`.
#'
#' @return The result of [shiny::runApp()].
#' @export
#'
#' @examples
#' if (interactive()) {
#'   run_app()
#' }
run_app <- function(...) {
  app_dir <- system.file("app", package = "SWANr", mustWork = TRUE)
  old_options <- options(SWANr.app_dir = app_dir)
  on.exit(options(old_options), add = TRUE)
  shiny::runApp(appDir = app_dir, ...)
}

#' @rdname run_app
#' @export
run_swanr <- run_app
