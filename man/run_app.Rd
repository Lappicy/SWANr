\name{run_app}
\alias{run_app}
\alias{run_swanr}
\title{Run the SWANr Shiny dashboard}
\usage{
run_app(...)

run_swanr(...)
}
\arguments{
\item{...}{Arguments passed to \code{\link[shiny:runApp]{shiny::runApp()}}, such as \code{host}, \code{port} and \code{launch.browser}.}
}
\value{
The result of \code{\link[shiny:runApp]{shiny::runApp()}}.
}
\description{
Starts the SWANr dashboard bundled with the package.
}
\examples{
if (interactive()) {
  run_app()
}
}
