# Baixa o modelo generativo local (LCM Dreamshaper v7 ONNX, ~2,2GB) para
# public/models/generative/. O diretório está no .gitignore: cada ambiente
# de desenvolvimento/deploy roda este script uma vez.
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/download-generative-model.ps1

$ErrorActionPreference = 'Stop'
$base = 'https://huggingface.co/aislamov/lcm-dreamshaper-v7-onnx/resolve/main'
$dest = Join-Path $PSScriptRoot '..\public\models\generative'

$files = @(
  'model_index.json'
  'scheduler/scheduler_config.json'
  'text_encoder/model.onnx'
  'tokenizer/merges.txt'
  'tokenizer/special_tokens_map.json'
  'tokenizer/tokenizer_config.json'
  'tokenizer/vocab.json'
  'unet/config.json'
  'unet/model.onnx'
  'unet/model.onnx_data'
  'vae_decoder/config.json'
  'vae_decoder/model.onnx'
  'vae_decoder/model.onnx_data'
  'vae_encoder/model.onnx'
)

foreach ($file in $files) {
  $out = Join-Path $dest ($file -replace '/', '\')
  New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  Write-Host "Baixando $file..."
  curl.exe -sSL --retry 5 --retry-delay 3 --retry-all-errors -o $out "$base/$file"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $file" }
}

Write-Host 'Modelo generativo pronto em public/models/generative.'
