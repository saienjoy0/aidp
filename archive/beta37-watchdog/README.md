# AIDP ↔ ChatGPT Bridge beta37

Current runtime snapshot for `0.7.9-beta.37`.

This build fixes the case where the mutation journal has already reached a terminal rollback state but the Side Panel still spins because the Port result/error was lost or delayed.

Runtime ZIP is stored as ordered Base64 parts under `runtime_zip_b64/`. Rebuild with PowerShell:

```powershell
$parts = Get-ChildItem .\runtime_zip_b64\part_*.b64 | Sort-Object Name
$b64 = ($parts | ForEach-Object { Get-Content $_.FullName -Raw }) -join ''
[IO.File]::WriteAllBytes('AIDP_ChatGPT_Bridge_v0.7.9_beta37_runtime_only.zip', [Convert]::FromBase64String(($b64 -replace '\s','')))
```

Expected ZIP SHA256: `c0b1761aa1ff9dc068c37d33442b2d6f79b542289820532bc2a1d19a51826f75`.

Safety invariants: dry-run before apply, per-tab isolation, automatic compensation on failed apply, and no automatic AIDP staging/submission.
