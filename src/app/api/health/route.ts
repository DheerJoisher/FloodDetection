export function GET(): Response {
  return Response.json({
    status: 'ok',
    message: 'Godavari Flood API is running.',
  });
}
