import { verifyBearerToken } from '@/lib/auth';
import { withApiErrors, errorResponse } from '@/lib/api-errors';
import { runStationPredictionOrchestration } from '@/services/prediction-orchestrator';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const claims = verifyBearerToken(request);
  if (claims instanceof Response) return claims;
  if (claims.role.toLowerCase() !== 'admin') {
    return errorResponse('Administrator authorization is required.', 403);
  }
  return withApiErrors(async () => {
    const summary = await runStationPredictionOrchestration();
    return Response.json(summary);
  });
}
