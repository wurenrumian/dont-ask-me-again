param(
  [string]$BaseUrl = "http://127.0.0.1:8787"
)

$payload = @{
  request_id = "smoke-" + [guid]::NewGuid().ToString("N")
  session_id = $null
  input = @{
    active_file_path = "smoke-note.md"
    active_file_content = "# Smoke`n`nWhat is entropy?"
    selection_text = "What is entropy?"
    instruction = "Explain this clearly in markdown."
  }
  client = @{
    name = "dont-ask-me-again"
    version = "0.1.0"
  }
}

$json = $payload | ConvertTo-Json -Depth 8

Write-Host "[smoke] POST $BaseUrl/api/v1/invoke"

try {
  $response = Invoke-RestMethod -Uri "$BaseUrl/api/v1/invoke" -Method Post -ContentType "application/json" -Body $json
  $response | ConvertTo-Json -Depth 8
} catch {
  Write-Host "[smoke] request failed"
  if ($_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
  } else {
    Write-Host $_.Exception.Message
  }
  exit 1
}
