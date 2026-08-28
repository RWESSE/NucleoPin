$ErrorActionPreference="Stop"
$key="$env:USERPROFILE\.tauri\nucleopin.key"
if(-not(Test-Path $key)){throw "Updater signing key not found: $key"}
$env:TAURI_SIGNING_PRIVATE_KEY=$key
$secure=Read-Host "Enter updater signing-key password" -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{
 $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 npm install
 npm run tauri build
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
 Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
}
Write-Host "`nInstaller:"
Get-ChildItem ".\src-tauri\target\release\bundle\nsis\*-setup.exe" -ErrorAction SilentlyContinue
Write-Host "`nUpdater signature:"
Get-ChildItem ".\src-tauri\target\release\bundle\nsis\*.sig" -ErrorAction SilentlyContinue
