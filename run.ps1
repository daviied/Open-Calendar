# Start the calendar on Windows. First run creates a virtual environment and installs dependencies.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".venv")) {
    py -m venv .venv
    .\.venv\Scripts\python -m pip install -r requirements.txt
}
.\.venv\Scripts\python -m server.app
