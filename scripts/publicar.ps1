<#
  Sube la carpeta publicacion/ al hosting con Web Deploy (o FTP) usando un archivo .PublishSettings.
  Uso (desde la carpeta del proyecto):
     powershell -ExecutionPolicy Bypass -File scripts\publicar.ps1 -PublishSettings D:\Desarrollos\RestaurantTinpu\site14.PublishSettings

  Antes de ejecutarlo:
     1) npm --prefix client run build
     2) node scripts\prepare-publicacion.cjs        (reutiliza el .env ya publicado; no necesita la clave de MySQL)
     3) Ejecutar en el administrador MySQL del hosting los archivos nuevos de publicacion\migrations\ (una sola vez; son repetibles).

  - La contrasena NO esta en el .PublishSettings: se pide por consola y no se guarda ni se muestra (o variable WEBDEPLOY_PASSWORD).
  - Web Deploy usa DoNotDeleteRule: no borra nada del sitio (por si la aplicacion guarda archivos propios). Los archivos obsoletos
    (p. ej. nubefact.js) quedan sin uso.
  - Al terminar, reinicie la aplicacion Node.js desde el panel del hosting.
#>
param(
    [Parameter(Mandatory = $true)] [string] $PublishSettings,
    [ValidateSet('MSDeploy', 'FTP')] [string] $Metodo = 'MSDeploy',
    [switch] $FtpSinSsl   # solo si el hosting no admite FTPS; la contrasena viajaria sin cifrar
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$origen = Join-Path $raiz 'publicacion'

foreach ($f in 'index.js', 'facturacion.js', '.env', 'node_modules\mysql2\promise.js', 'public\index.html') {
    if (-not (Test-Path (Join-Path $origen $f))) { throw "La carpeta publicacion no esta lista (falta $f). Ejecute scripts\prepare-publicacion.cjs." }
}
if (Test-Path (Join-Path $origen 'nubefact.js')) { throw 'publicacion\nubefact.js no deberia existir: vuelva a preparar el paquete.' }

[xml]$x = Get-Content $PublishSettings
$p = $x.publishData.publishProfile | Where-Object { $_.publishMethod -eq $Metodo } | Select-Object -First 1
if (-not $p) { throw "El archivo no tiene un perfil $Metodo." }

$clave = $p.userPWD
if (-not $clave) { $clave = $env:WEBDEPLOY_PASSWORD }
if (-not $clave) {
    $seguro = Read-Host "Contrasena de $Metodo para $($p.userName)" -AsSecureString
    $clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
}

Write-Host "Destino: $($p.destinationAppUrl)  (sitio $($p.msdeploySite))"

if ($Metodo -eq 'MSDeploy') {
    $msdeploy = 'C:\Program Files\IIS\Microsoft Web Deploy V3\msdeploy.exe'
    $dest = "contentPath=$($p.msdeploySite),computerName=$($p.publishUrl),userName=$($p.userName),password=$clave,authType=Basic"
    & $msdeploy -verb:sync "-source:contentPath=$origen" "-dest:$dest" -allowUntrusted -enableRule:DoNotDeleteRule -disableRule:BackupRule -retryAttempts:6 -retryInterval:4000
    if ($LASTEXITCODE -ne 0) { throw 'Fallo Web Deploy (revise usuario/contrasena y que Web Deploy este habilitado). Puede reintentar con -Metodo FTP.' }
}
else {
    $baseUrl = $p.publishUrl.TrimEnd('/')
    $cred = New-Object System.Net.NetworkCredential($p.userName, $clave)
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

    function Invoke-Ftp([string]$ruta, [string]$accion, [byte[]]$datos = $null) {
        $req = [System.Net.FtpWebRequest]::Create("$baseUrl/$ruta")
        $req.Method = $accion
        $req.Credentials = $cred
        $req.UsePassive = $true
        $req.EnableSsl = -not $FtpSinSsl
        $req.KeepAlive = $false
        if ($null -ne $datos) {
            $req.ContentLength = $datos.Length
            $st = $req.GetRequestStream(); $st.Write($datos, 0, $datos.Length); $st.Close()
        }
        $res = $req.GetResponse(); $res.Close()
    }

    $archivos = Get-ChildItem $origen -Recurse -File
    $dirs = $archivos | ForEach-Object { Split-Path ($_.FullName.Substring($origen.Length + 1)) -Parent } | Where-Object { $_ } | Sort-Object -Unique
    foreach ($d in $dirs) {
        $acum = ''
        foreach ($parte in ($d -split '\\')) {
            $acum = if ($acum) { "$acum/$parte" } else { $parte }
            try { Invoke-Ftp $acum ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) } catch { }
        }
    }
    $i = 0
    foreach ($f in $archivos) {
        $rel = $f.FullName.Substring($origen.Length + 1).Replace('\', '/')
        Invoke-Ftp $rel ([System.Net.WebRequestMethods+Ftp]::UploadFile) ([IO.File]::ReadAllBytes($f.FullName))
        $i++; if ($i % 50 -eq 0) { Write-Host "  $i / $($archivos.Count) archivos" }
    }
}

Write-Host "`nListo. Reinicie la aplicacion Node.js desde el panel del hosting y abra: $($p.destinationAppUrl)"
