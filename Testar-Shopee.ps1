param([switch]$Importar)
$ErrorActionPreference = 'Stop'
$segredo = Read-Host 'Cole o INTEGRATION_ADMIN_TOKEN do Railway' -AsSecureString
$credencial = New-Object System.Net.NetworkCredential('', $segredo)
try {
    $dados = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'examples/shopee-preview.json') | ConvertFrom-Json
    $dados.dryRun = -not $Importar.IsPresent
    $json = $dados | ConvertTo-Json -Depth 10
    $parametros = @{
        Method = 'Post'
        Uri = 'https://comercio-popular-backend-production.up.railway.app/api/integrations/shopee/import-feed'
        Headers = @{ Authorization = 'Bearer ' + $credencial.Password }
        ContentType = 'application/json; charset=utf-8'
        Body = [System.Text.Encoding]::UTF8.GetBytes($json)
        TimeoutSec = 60
    }
    Invoke-RestMethod @parametros | ConvertTo-Json -Depth 10
} catch {
    if ($_.ErrorDetails.Message) { Write-Output $_.ErrorDetails.Message }
    else { Write-Output $_.Exception.Message }
} finally {
    Remove-Variable segredo, credencial, parametros -ErrorAction SilentlyContinue
}
