# Unified v2 premium

This build uses **Batida do Sado** as the shell app and adds **Arrábida Grooves** as a fullscreen module.

## Entry points
- `#/launcher` – app launcher
- `#/analyzer` – Batida do Sado
- `#/arrabida` – Arrábida Grooves

## GitHub Actions
The existing workflow `.github/workflows/release-files.yml` remains the main release pipeline for the unified app. It already targets macOS, Windows and Linux builds from the Batida project shell.
