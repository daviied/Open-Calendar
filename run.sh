#!/usr/bin/env sh
# Start the calendar on Linux / macOS. First run creates a virtual environment and installs dependencies.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/python -m server.app
