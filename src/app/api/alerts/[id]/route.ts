import { verifyBearerToken } from '@/lib/auth';
import { errorResponse, withApiErrors } from '@/lib/api-errors';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const claims = verifyBearerToken(request);
  if (claims instanceof Response) return claims;

  return withApiErrors(async () => {
    const { id: rawId } = await context.params;
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
      return errorResponse('id must be a positive safe integer.', 400);
    }

    const [result] = await pool.execute('DELETE FROM alerts WHERE id = ?', [Number(rawId)]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      return errorResponse('Alert not found.', 404);
    }
    return Response.json({ message: 'Alert deleted.' });
  });
}
