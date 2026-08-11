# AIDP ChatGPT Bridge Beta16 archive

Original upload: `AIDP_ChatGPT_Bridge_v0.7.9_beta16_one_click (1).zip`

The ZIP is stored as Base64 text parts because the GitHub connector used for this upload accepts text files rather than binary archives. Concatenating `part00` through `part08` in filename order and Base64-decoding them recreates the original ZIP byte-for-byte.

## Linux / macOS

```sh
cat AIDP_ChatGPT_Bridge_v0.7.9_beta16_one_click.zip.b64.part* \
  | base64 -d \
  > AIDP_ChatGPT_Bridge_v0.7.9_beta16_one_click.zip
```

## PowerShell

```powershell
$parts = Get-ChildItem 'AIDP_ChatGPT_Bridge_v0.7.9_beta16_one_click.zip.b64.part*' | Sort-Object Name
$base64 = ($parts | ForEach-Object { Get-Content $_.FullName -Raw }) -join ''
[IO.File]::WriteAllBytes(
  'AIDP_ChatGPT_Bridge_v0.7.9_beta16_one_click.zip',
  [Convert]::FromBase64String($base64)
)
```

## Integrity

- Original size: `96570` bytes
- SHA-256: `093f2267dde0b8b923ea4ec9e0b79bfc7eace049da047da4e82d514f91788887`
- Git blob SHA-1 of original ZIP bytes: `fd65a3a1b14c606f00e150f662a329cc508e067d`
- Local reconstruction check at upload time: `cmp` exact match (`exit 0`)

Branch used for this archive: `beta16-one-click`.
Main branch was not modified by this archive upload.
