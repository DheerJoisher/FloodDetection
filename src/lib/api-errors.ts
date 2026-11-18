export async function withApiErrors(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { message: 'Request body must contain valid JSON.' },
        { status: 400 },
      );
    }

    console.error('API request failed:', error);
    return Response.json(
      { message: 'An unexpected server error occurred.' },
      { status: 500 },
    );
  }
}

export function errorResponse(message: string, status: number): Response {
  return Response.json({ message }, { status });
}
