import { verifyBearerToken } from '@/lib/auth';
import { errorResponse, withApiErrors } from '@/lib/api-errors';
import { runFloodMonitorAutomatically } from '@/services/flood-monitor-orchestrator';

export const runtime = 'nodejs';

function authorizedByInternalSecret(request: Request): boolean {
  const secret = process.env.AUTOMATIC_RUN_SECRET;
  if (!secret) return false;
  return request.headers.get('x-automatic-run-secret') === secret;
}

export async function POST(request: Request): Promise<Response> {
  if (authorizedByInternalSecret(request)) {
    return withApiErrors(async () => Response.json(
      await runFloodMonitorAutomatically(),
    ));
  }
  const claims = verifyBearerToken(request);
  if (claims instanceof Response) return claims;
  if (claims.role.toLowerCase() !== 'admin') {
    return errorResponse('Administrator authorization is required.', 403);
  }
  return withApiErrors(async () => Response.json(
    await runFloodMonitorAutomatically(),
  ));
}
