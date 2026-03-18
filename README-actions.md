# GitHub Actions release setup

Put these files in your repository:

- `.github/workflows/release-files.yml`
- `electron-builder.release.yml`

Then commit and push them.

## Trigger a release

Create and push a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Expected release files

### macOS
- Batida do Sado-{version}-universal.dmg
- Batida do Sado-{version}-arm64.dmg

### Windows
- Batida do Sado-Setup-{version}-x64.exe
- Batida do Sado-Setup-{version}-arm64.exe
- Batida do Sado-Portable-{version}-x64.exe
- Batida do Sado-Portable-{version}-arm64.exe

### Linux
- Batida do Sado-{version}.AppImage
- Batida do Sado-{version}-arm64.AppImage
- deemix-app_{version}_amd64.deb
- deemix-app_{version}_arm64.deb

## Notes
- The workflow uses standard GitHub-hosted runners for x64 and arm64 on Linux, Windows and macOS.
- For private repositories, Actions minutes are billed according to your plan.
- macOS universal and arm64 builds run on the standard arm64 macOS runner.
- If you later want signed/notarized macOS or signed Windows installers, add the relevant secrets and signing config.
