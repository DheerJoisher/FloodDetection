import { getHydrologyNetworkContext } from '@/services/hydrology-graph';
import { withApiErrors, errorResponse } from '@/lib/api-errors';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const featureDate = new URL(request.url).searchParams.get('feature_date');
    if (featureDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(featureDate)) {
      return errorResponse('feature_date must use YYYY-MM-DD format.', 400);
    }
    return Response.json(await getHydrologyNetworkContext(featureDate ?? undefined));
  });
}
