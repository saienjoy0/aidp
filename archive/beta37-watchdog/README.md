# AIDP ↔ ChatGPT Bridge beta37

Current runtime snapshot for `0.7.9-beta.37`.

This build fixes the case where the mutation journal has already reached a terminal rollback state but the Side Panel still spins because the Port result/error was lost or delayed.

Runtime ZIP is stored as ordered Base64 parts under `runtime_zip_b64/`. Rebuild with PowerShell:

```powershell
$parts = Get-ChildItem .\runtime_zip_b64\part_*.b64 | Sort-Object Name
$b64 = ($parts | ForEach-Object { Get-Content $_.FullName -Raw }) -join ''
[IO.File]::WriteAllBytes('AIDP_ChatGPT_Bridge_v0.7.9_beta37_runtime_only.zip', [Convert]::FromBase64String(($b64 -replace '\s','')))
```

Expected ZIP SHA256: `09fe404ab97757eb8ca75faa00e5673a237e028194b71727ca04ac7d8b4225d6`.

Safety invariants: dry-run before apply, per-tab isolation, automatic compensation on failed apply, and no automatic AIDP staging/submission.
