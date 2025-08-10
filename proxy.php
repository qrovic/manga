<?php
// Simple domain-restricted proxy for GoManga API
// Usage: /anime/proxy.php?url=https%3A%2F%2Fgomanga-api.vercel.app%2Fapi%2Fmanga-list%2F1

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$url = isset($_GET['url']) ? $_GET['url'] : '';
if (!$url) {
  http_response_code(400);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'Missing url parameter']);
  exit;
}

// Allow only GoManga API host
$parsed = parse_url($url);
$host = $parsed['host'] ?? '';
if (!in_array($host, ['gomanga-api.vercel.app'])) {
  http_response_code(403);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'Forbidden host']);
  exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_HEADER => true,
  CURLOPT_HTTPHEADER => [
    'User-Agent: GoManga-Reader/1.0 (+http://qrovic.github.io/manga)'
  ],
  CURLOPT_TIMEOUT => 30,
]);

$response = curl_exec($ch);
if ($response === false) {
  http_response_code(502);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'Upstream error', 'details' => curl_error($ch)]);
  curl_close($ch);
  exit;
}

$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$headers = substr($response, 0, $header_size);
$body = substr($response, $header_size);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = 'application/json';

foreach (explode("\r\n", $headers) as $headerLine) {
  if (stripos($headerLine, 'Content-Type:') === 0) {
    $contentType = trim(substr($headerLine, strlen('Content-Type:')));
  }
}

curl_close($ch);

http_response_code($code ?: 200);
header('Content-Type: ' . $contentType);

echo $body;
