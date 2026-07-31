\name{SWANr_app}
\alias{SWANr_app}
\title{Run the SWANr Shiny dashboard}
\usage{
SWANr_app(...)
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
  SWANr_app()
}
}
